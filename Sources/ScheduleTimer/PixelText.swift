import CoreText
import Foundation
import WZKit

/// 옛 윈도우 글자처럼 안티앨리어싱 없이 12px로 글자를 비트맵에 그림 (픽셀 아트와 같이 확대됨)
enum PixelText {
    static let defaultFontName = "AppleSDGothicNeo-Regular"

    /// 글자 한 줄을 비트맵으로. maxWidth를 넘으면 뒤를 자르고 `…`.
    static func render(_ text: String, fontName: String?, size: CGFloat = 12,
                       color: (r: UInt8, g: UInt8, b: UInt8) = (255, 255, 255),
                       maxWidth: Int) -> Bitmap {
        let font = CTFontCreateWithName((fontName ?? defaultFontName) as CFString, size, nil)
        let cgColor = CGColor(srgbRed: CGFloat(color.r) / 255, green: CGFloat(color.g) / 255,
                              blue: CGFloat(color.b) / 255, alpha: 1)

        func makeLine(_ s: String) -> CTLine {
            let attributes: [NSAttributedString.Key: Any] = [
                NSAttributedString.Key(kCTFontAttributeName as String): font,
                NSAttributedString.Key(kCTForegroundColorAttributeName as String): cgColor,
            ]
            return CTLineCreateWithAttributedString(NSAttributedString(string: s, attributes: attributes))
        }
        func width(_ line: CTLine) -> Double {
            CTLineGetTypographicBounds(line, nil, nil, nil)
        }

        var line = makeLine(text)
        if width(line) > Double(maxWidth) {
            var chars = Array(text)
            while !chars.isEmpty {
                chars.removeLast()
                line = makeLine(String(chars) + "…")
                if width(line) <= Double(maxWidth) { break }
            }
        }

        var ascent: CGFloat = 0, descent: CGFloat = 0, leading: CGFloat = 0
        let lineWidth = CTLineGetTypographicBounds(line, &ascent, &descent, &leading)
        let w = max(1, Int(ceil(lineWidth)) + 1)
        let h = max(1, Int(ceil(ascent + descent)) + 1)

        guard let ctx = CGContext(
            data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
            space: CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return Bitmap(width: 0, height: 0) }
        ctx.setAllowsAntialiasing(false)
        ctx.setShouldAntialias(false)
        ctx.setAllowsFontSmoothing(false)
        ctx.setShouldSmoothFonts(false)
        ctx.setAllowsFontSubpixelPositioning(false)
        ctx.setShouldSubpixelPositionFonts(false)
        ctx.textPosition = CGPoint(x: 0, y: ceil(descent))
        CTLineDraw(line, ctx)

        // 메모리 첫 줄이 이미지 맨 위. 미리곱 알파를 풀어서 옮김.
        var out = Bitmap(width: w, height: h)
        guard let data = ctx.data else { return out }
        let src = data.bindMemory(to: UInt8.self, capacity: w * h * 4)
        for i in 0..<(w * h) {
            let a = src[4 * i + 3]
            guard a > 0 else { continue }
            func unpremultiply(_ v: UInt8) -> UInt8 { UInt8(min(255, Int(v) * 255 / Int(a))) }
            out.pixels[4 * i] = unpremultiply(src[4 * i])
            out.pixels[4 * i + 1] = unpremultiply(src[4 * i + 1])
            out.pixels[4 * i + 2] = unpremultiply(src[4 * i + 2])
            out.pixels[4 * i + 3] = a
        }
        return out
    }
}
