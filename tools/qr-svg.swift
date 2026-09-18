// Builds a QR code as SVG with macOS CoreImage (CIQRCodeGenerator) and checks it by decoding the SVG again
// with CoreImage's QR detector. Usage: swift qr-svg.swift <text> <out.svg> <dark #hex> <light #hex>
import AppKit
import CoreImage
import Foundation

let args = CommandLine.arguments
guard args.count == 5 else {
  FileHandle.standardError.write("usage: qr-svg.swift <text> <out.svg> <dark> <light>\n".data(using: .utf8)!)
  exit(2)
}
let text = args[1]
let outPath = args[2]
let dark = args[3]
let light = args[4]
let quietZone = 4

guard let filter = CIFilter(name: "CIQRCodeGenerator") else { fatalError("no CIQRCodeGenerator") }
filter.setValue(text.data(using: .utf8), forKey: "inputMessage")
filter.setValue("M", forKey: "inputCorrectionLevel")
guard let output = filter.outputImage else { fatalError("no output image") }

let context = CIContext()
guard let cgImage = context.createCGImage(output, from: output.extent) else { fatalError("no CGImage") }
let width = cgImage.width
let height = cgImage.height
var pixels = [UInt8](repeating: 0, count: width * height * 4)
let bitmap = CGContext(
  data: &pixels, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
bitmap.interpolationQuality = .none
bitmap.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

// Dark pixels are modules. CoreImage adds its own margin; crop to the dark modules and add a 4-module quiet zone.
var dark2d = [[Bool]](repeating: [Bool](repeating: false, count: width), count: height)
var minX = width, minY = height, maxX = -1, maxY = -1
for y in 0..<height {
  for x in 0..<width {
    let isDark = pixels[(y * width + x) * 4] < 128
    dark2d[y][x] = isDark
    if isDark {
      minX = min(minX, x); maxX = max(maxX, x)
      minY = min(minY, y); maxY = max(maxY, y)
    }
  }
}
let size = maxX - minX + 1
guard size == maxY - minY + 1, (size - 17) % 4 == 0 else { fatalError("unexpected QR size \(size)") }
let modules = (0..<size).map { y in (0..<size).map { x in dark2d[minY + y][minX + x] } }

// Orientation check: finder patterns top left, top right and bottom left, none bottom right.
func isFinder(_ top: Int, _ left: Int) -> Bool {
  for y in 0..<7 {
    for x in 0..<7 {
      let ring = x == 0 || y == 0 || x == 6 || y == 6
      let core = (2...4).contains(x) && (2...4).contains(y)
      if modules[top + y][left + x] != (ring || core) { return false }
    }
  }
  return true
}
guard isFinder(0, 0), isFinder(0, size - 7), isFinder(size - 7, 0), !isFinder(size - 7, size - 7) else {
  fatalError("finder patterns are not where they belong")
}

// One path, one rectangle per horizontal run of dark modules.
var path = ""
for y in 0..<size {
  var x = 0
  while x < size {
    guard modules[y][x] else { x += 1; continue }
    var run = 1
    while x + run < size && modules[y][x + run] { run += 1 }
    path += "M\(x + quietZone) \(y + quietZone)h\(run)v1h-\(run)z"
    x += run
  }
}
let total = size + 2 * quietZone
let svg = """
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 \(total) \(total)" shape-rendering="crispEdges"><rect width="\(total)" height="\(total)" fill="\(light)"/><path fill="\(dark)" d="\(path)"/></svg>

"""
try! svg.write(toFile: outPath, atomically: true, encoding: .utf8)

// Decode the written SVG again: rasterize it large and let CoreImage read it.
guard let svgImage = NSImage(contentsOfFile: outPath) else { fatalError("could not load the SVG") }
let pixelsPerSide = total * 12
let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil, pixelsWide: pixelsPerSide, pixelsHigh: pixelsPerSide, bitsPerSample: 8, samplesPerPixel: 4,
  hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
svgImage.draw(in: NSRect(x: 0, y: 0, width: pixelsPerSide, height: pixelsPerSide))
NSGraphicsContext.restoreGraphicsState()
guard let raster = CIImage(bitmapImageRep: rep) else { fatalError("could not rasterize") }
let detector = CIDetector(ofType: CIDetectorTypeQRCode, context: nil, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])!
let decoded = detector.features(in: raster).compactMap { ($0 as? CIQRCodeFeature)?.messageString }
guard decoded == [text] else { fatalError("decoded \(decoded), expected \(text)") }
print("ok \(size)x\(size) modules, decoded: \(decoded[0]) -> \(outPath)")
