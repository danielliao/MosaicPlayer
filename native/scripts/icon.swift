import AppKit
let destination = CommandLine.arguments[1]
let image = NSImage(size: NSSize(width: 1024, height: 1024))
image.lockFocus()
NSColor(red: 0.95, green: 0.94, blue: 1, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 32, y: 32, width: 960, height: 960), xRadius: 210, yRadius: 210).fill()
for row in 0..<2 { for col in 0..<2 {
    NSColor(red: 0.42, green: 0.34, blue: 0.91, alpha: row == 0 && col == 1 ? 0.5 : 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: 230 + col * 300, y: 230 + row * 300, width: 260, height: 260), xRadius: 48, yRadius: 48).fill()
}}
image.unlockFocus()
let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: destination))
