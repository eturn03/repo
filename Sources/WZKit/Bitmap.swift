import CoreGraphics
import Foundation

/// 픽셀 아트 합성용 RGBA 비트맵 (알파 미리곱 안 함). 좌표는 왼쪽 위가 (0,0).
public struct Bitmap: Equatable {
    public let width: Int
    public let height: Int
    public var pixels: [UInt8]

    public init(width: Int, height: Int) {
        self.width = max(0, width)
        self.height = max(0, height)
        pixels = [UInt8](repeating: 0, count: self.width * self.height * 4)
    }

    public func pixel(x: Int, y: Int) -> (r: UInt8, g: UInt8, b: UInt8, a: UInt8) {
        guard x >= 0, y >= 0, x < width, y < height else { return (0, 0, 0, 0) }
        let i = (y * width + x) * 4
        return (pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3])
    }

    /// src의 (sx, sy, w, h) 영역을 (x, y)에 알파 합성. 범위 밖은 잘라냄.
    public mutating func draw(_ src: Bitmap, x: Int, y: Int,
                              sx: Int = 0, sy: Int = 0, w: Int? = nil, h: Int? = nil) {
        let w = w ?? src.width, h = h ?? src.height
        for row in 0..<max(0, h) {
            let srcY = sy + row, dstY = y + row
            guard srcY >= 0, srcY < src.height, dstY >= 0, dstY < height else { continue }
            for col in 0..<max(0, w) {
                let srcX = sx + col, dstX = x + col
                guard srcX >= 0, srcX < src.width, dstX >= 0, dstX < width else { continue }
                let si = (srcY * src.width + srcX) * 4
                blend(at: (dstY * width + dstX) * 4,
                      r: src.pixels[si], g: src.pixels[si + 1], b: src.pixels[si + 2], a: src.pixels[si + 3])
            }
        }
    }

    /// 사각형을 단색으로 덮음 (불투명이면 그대로 교체)
    public mutating func fill(x: Int, y: Int, w: Int, h: Int, r: UInt8, g: UInt8, b: UInt8, a: UInt8 = 255) {
        for dy in max(0, y)..<min(height, y + h) {
            for dx in max(0, x)..<min(width, x + w) {
                blend(at: (dy * width + dx) * 4, r: r, g: g, b: b, a: a)
            }
        }
    }

    private mutating func blend(at i: Int, r: UInt8, g: UInt8, b: UInt8, a: UInt8) {
        guard a > 0 else { return }
        if a == 255 {
            pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 255
            return
        }
        let sa = Double(a) / 255, da = Double(pixels[i + 3]) / 255
        let outA = sa + da * (1 - sa)
        func mix(_ s: UInt8, _ d: UInt8) -> UInt8 {
            UInt8(min(255, max(0, ((Double(s) * sa + Double(d) * da * (1 - sa)) / outA).rounded())))
        }
        pixels[i] = mix(r, pixels[i])
        pixels[i + 1] = mix(g, pixels[i + 1])
        pixels[i + 2] = mix(b, pixels[i + 2])
        pixels[i + 3] = UInt8((outA * 255).rounded())
    }

    public func cgImage() -> CGImage? {
        guard width > 0, height > 0,
              let provider = CGDataProvider(data: Data(pixels) as CFData)
        else { return nil }
        return CGImage(
            width: width, height: height,
            bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
            space: CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue),
            provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent
        )
    }
}
