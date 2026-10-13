// askk-speech: on-device speech recognition with Apple's SpeechAnalyzer
// (macOS 26+). A long-running helper: one JSON request per stdin line,
// one JSON answer per stdout line. Audio never leaves the Mac.
//
//   in:  {"id": "r1", "path": "/tmp/…/u.wav", "locale": "en-US"}
//   out: {"id": "r1", "text": "Open the morning plan."}  |  {"id": "r1", "error": "…"}
//   in:  {"id": "p", "probe": true}   →   {"id": "p", "ok": true, "locales": […]}

import AVFoundation
import Foundation
import Speech

struct Request: Decodable {
  let id: String
  let path: String?
  let locale: String?
  let probe: Bool?
}

func reply(_ object: [String: Any]) {
  if let data = try? JSONSerialization.data(withJSONObject: object), let line = String(data: data, encoding: .utf8) {
    print(line)
    fflush(stdout)
  }
}

var installed = Set<String>() // locales whose model is ready

func transcribe(path: String, localeId: String) async throws -> String {
  guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: localeId)) else {
    throw NSError(domain: "askk-speech", code: 1, userInfo: [NSLocalizedDescriptionKey: "Language \(localeId) is not supported on this Mac."])
  }
  let transcriber = SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [], attributeOptions: [])
  if !installed.contains(locale.identifier) {
    if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
      try await request.downloadAndInstall()
    }
    installed.insert(locale.identifier)
  }
  let file = try AVAudioFile(forReading: URL(fileURLWithPath: path))
  let analyzer = SpeechAnalyzer(modules: [transcriber])
  let collect = Task {
    var text = ""
    for try await result in transcriber.results where result.isFinal {
      text += String(result.text.characters)
    }
    return text
  }
  if let last = try await analyzer.analyzeSequence(from: file) {
    try await analyzer.finalizeAndFinish(through: last)
  } else {
    await analyzer.cancelAndFinishNow()
  }
  return try await collect.value.trimmingCharacters(in: .whitespacesAndNewlines)
}

@main
struct AskkSpeech {
  static func main() async {
    do {
      for try await line in FileHandle.standardInput.bytes.lines {
        guard let data = line.data(using: .utf8), let request = try? JSONDecoder().decode(Request.self, from: data) else {
          reply(["id": "", "error": "Bad request line."])
          continue
        }
        if request.probe == true {
          let locales = await SpeechTranscriber.supportedLocales.map { $0.identifier(.bcp47) }
          reply(["id": request.id, "ok": SpeechTranscriber.isAvailable, "locales": locales])
          continue
        }
        guard let path = request.path else {
          reply(["id": request.id, "error": "No audio path."])
          continue
        }
        do {
          let text = try await transcribe(path: path, localeId: request.locale ?? "en-US")
          reply(["id": request.id, "text": text])
        } catch {
          reply(["id": request.id, "error": error.localizedDescription])
        }
      }
    } catch {
      reply(["id": "", "error": "stdin closed: \(error.localizedDescription)"])
    }
  }
}
