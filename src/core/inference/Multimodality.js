/**
 * Non-text data sent alongside a prompt.
 *
 * In a browser the source of truth is a data URL or a remote URL — there are no
 * file paths to read. `File` and `Blob` are accepted at the door and converted
 * once, so nothing downstream has to know which of the three it started as.
 */
export const Modality = Object.freeze({
  IMAGE: 'image',
  AUDIO: 'audio',
  VIDEO: 'video',
})

const MIME_DEFAULTS = {
  [Modality.IMAGE]: 'image/png',
  [Modality.AUDIO]: 'audio/wav',
  [Modality.VIDEO]: 'video/mp4',
}

const KINDS = new Set(Object.values(Modality))

export class Multimodality {
  constructor({ type, urls = [] } = {}) {
    // An unrecognised kind becomes an image, the only modality every provider
    // here accepts, and says so. Refusing would fail a whole turn over an
    // attachment the user could simply be told was mishandled.
    this.repairs = []
    if (!KINDS.has(type)) {
      this.repairs.push(
        `modality ${JSON.stringify(type)} was not recognised; treated as ${Modality.IMAGE}`,
      )
      this.type = Modality.IMAGE
    } else {
      this.type = type
    }
    this.urls = (Array.isArray(urls) ? urls : []).filter(
      (u) => typeof u === 'string' && u.length > 0,
    )
  }

  /** Infer the modality from a data URL's own mime type. Null when it is not one. */
  static of(value) {
    if (typeof value !== 'string' || !value.startsWith('data:')) return null
    const mime = value.slice(5).split(';', 1)[0]
    const kind = mime.split('/', 1)[0]
    return KINDS.has(kind) ? new Multimodality({ type: kind, urls: [value] }) : null
  }

  /**
   * Read a File or Blob into a data URL, so the caller never handles the
   * reader. Returns null when the blob cannot be read, which the caller treats
   * as "no attachment" rather than as a failed turn.
   */
  static async fromBlob(blob) {
    const buffer = await blob.arrayBuffer().catch(() => null)
    if (!buffer) return null
    let binary = ''
    const bytes = new Uint8Array(buffer)
    // Chunked because String.fromCharCode with a large spread overflows the stack.
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    const type = blob.type || MIME_DEFAULTS[Modality.IMAGE]
    return Multimodality.of(`data:${type};base64,${btoa(binary)}`)
  }

  /** `data:image/png;base64,AAA` -> `['image/png', 'AAA']` */
  static split(url) {
    const [header, payload = ''] = url.split(',', 2)
    return [header.slice(5).split(';', 1)[0], payload]
  }

  isEmpty() {
    return this.urls.length === 0
  }
}
