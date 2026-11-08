// Renders the Askk app icon (design/icon.png, 1024²): the accent gradient, an "A" in the brand face.
// Usage: swift scripts/icon.swift && bunx tauri icon design/icon.png
import AppKit
let n: CGFloat = 1024
let img = NSImage(size: NSSize(width: n, height: n))
img.lockFocus()
let tile = NSBezierPath(roundedRect: NSRect(x: 100, y: 100, width: n - 200, height: n - 200), xRadius: 185, yRadius: 185)
NSGradient(starting: NSColor(srgbRed: 0xb7/255, green: 0x94/255, blue: 1, alpha: 1),
           ending: NSColor(srgbRed: 0x6d/255, green: 0x28/255, blue: 0xd9/255, alpha: 1))!.draw(in: tile, angle: -60)
let face = NSFont(name: "Amarante", size: 600) ?? NSFont.systemFont(ofSize: 600, weight: .bold)
let s = NSAttributedString(string: "A", attributes: [.font: face, .foregroundColor: NSColor.white])
let sz = s.size()
s.draw(at: NSPoint(x: (n - sz.width) / 2, y: (n - sz.height) / 2))
img.unlockFocus()
let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "design/icon.png"))
