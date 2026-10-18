import Foundation

/// 글꼴 파일 안의 흑백 비트맵 글자(EBLC/EBDT)로 글자를 그림.
/// 윈도우 굴림·돋움은 12px 등에서 이 비트맵을 써서 옛날 게임 화면처럼 각진 글자가 나옴.
public final class BitmapFont {
    public struct Face {
        public let offset: Int
        public let family: String
        public let postScriptName: String
    }

    struct Glyph {
        let width: Int, height: Int
        let bearingX: Int, bearingY: Int, advance: Int
        let bits: [Bool]
    }

    public let family: String
    public let ascender: Int
    public let descender: Int
    public var lineHeight: Int { ascender - descender }

    private let d: [UInt8]
    private let ebdt: Int
    private let subtables: [(first: Int, last: Int, offset: Int)]
    private let cmap4: Int
    private var cache: [Int: Glyph?] = [:]

    // MARK: - 읽기 도우미 (big-endian, 범위 밖은 0)

    private func u8(_ o: Int) -> Int { o >= 0 && o < d.count ? Int(d[o]) : 0 }
    private func i8(_ o: Int) -> Int { Int(Int8(bitPattern: UInt8(u8(o)))) }
    private func u16(_ o: Int) -> Int { u8(o) << 8 | u8(o + 1) }
    private func i16(_ o: Int) -> Int { Int(Int16(bitPattern: UInt16(u16(o)))) }
    private func u32(_ o: Int) -> Int { u16(o) << 16 | u16(o + 2) }

    // MARK: - 글꼴 파일 안의 글꼴 목록 (ttc는 여러 개)

    public static func faces(in data: [UInt8]) -> [Face] {
        func u16(_ o: Int) -> Int { o + 1 < data.count ? Int(data[o]) << 8 | Int(data[o + 1]) : 0 }
        func u32(_ o: Int) -> Int { u16(o) << 16 | u16(o + 2) }
        guard data.count > 12 else { return [] }
        var offsets = [0]
        if data[0] == 0x74, data[1] == 0x74, data[2] == 0x63, data[3] == 0x66 {   // "ttcf"
            offsets = (0..<min(u32(8), 64)).map { u32(12 + 4 * $0) }
        }
        return offsets.compactMap { off in
            guard let name = table(data, off, "name") else { return nil }
            func string(_ id: Int) -> String {
                let count = u16(name + 2), store = name + u16(name + 4)
                for i in 0..<count {
                    let r = name + 6 + 12 * i
                    guard u16(r + 6) == id else { continue }
                    let platform = u16(r), length = u16(r + 8), start = store + u16(r + 10)
                    guard start + length <= data.count else { continue }
                    let raw = Array(data[start..<(start + length)])
                    if platform == 3 || platform == 0 {
                        let units = stride(from: 0, to: raw.count - 1, by: 2).map { UInt16(raw[$0]) << 8 | UInt16(raw[$0 + 1]) }
                        return String(decoding: units, as: UTF16.self)
                    }
                    return String(bytes: raw, encoding: .isoLatin1) ?? ""
                }
                return ""
            }
            return Face(offset: off, family: string(1), postScriptName: string(6))
        }
    }

    static func table(_ data: [UInt8], _ faceOffset: Int, _ tag: String) -> Int? {
        func u16(_ o: Int) -> Int { o + 1 < data.count ? Int(data[o]) << 8 | Int(data[o + 1]) : 0 }
        func u32(_ o: Int) -> Int { u16(o) << 16 | u16(o + 2) }
        let tagBytes = Array(tag.utf8)
        for i in 0..<u16(faceOffset + 4) {
            let r = faceOffset + 12 + 16 * i
            guard r + 16 <= data.count else { break }
            if Array(data[r..<(r + 4)]) == tagBytes { return u32(r + 8) }
        }
        return nil
    }

    /// ppem 크기의 비트맵 글자가 있으면 만들어짐
    public init?(data: [UInt8], face: Face, ppem: Int = 12) {
        d = data
        family = face.family
        guard let eblc = Self.table(data, face.offset, "EBLC"),
              let ebdtOffset = Self.table(data, face.offset, "EBDT"),
              let cmap = Self.table(data, face.offset, "cmap")
        else { return nil }
        ebdt = ebdtOffset

        // 유니코드 cmap 형식 4 찾기
        func r16(_ o: Int) -> Int { o + 1 < data.count ? Int(data[o]) << 8 | Int(data[o + 1]) : 0 }
        func r32(_ o: Int) -> Int { r16(o) << 16 | r16(o + 2) }
        var format4: Int?
        for i in 0..<r16(cmap + 2) {
            let r = cmap + 4 + 8 * i
            let platform = r16(r), encoding = r16(r + 2), sub = cmap + r32(r + 4)
            if r16(sub) == 4, (platform == 3 && encoding == 1) || platform == 0 { format4 = sub }
        }
        guard let format4 else { return nil }
        cmap4 = format4

        // 원하는 크기의 strike
        var found: (subs: [(Int, Int, Int)], asc: Int, desc: Int)?
        for i in 0..<r32(eblc + 4) {
            let rec = eblc + 8 + 48 * i
            guard rec + 48 <= data.count, Int(data[rec + 45]) == ppem else { continue }
            let arrayOffset = eblc + r32(rec), count = r32(rec + 8)
            var subs: [(Int, Int, Int)] = []
            for k in 0..<count {
                let a = arrayOffset + 8 * k
                subs.append((r16(a), r16(a + 2), arrayOffset + r32(a + 4)))
            }
            found = (subs, Int(Int8(bitPattern: data[rec + 16])), Int(Int8(bitPattern: data[rec + 17])))
            break
        }
        guard let found else { return nil }
        subtables = found.subs.map { (first: $0.0, last: $0.1, offset: $0.2) }
        ascender = found.asc
        descender = found.desc
    }

    // MARK: - 글자 찾기

    func glyphID(_ scalar: Unicode.Scalar) -> Int {
        let c = Int(scalar.value)
        guard c <= 0xFFFF else { return 0 }
        let segX2 = u16(cmap4 + 6), seg = segX2 / 2
        let ends = cmap4 + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2
        // 구간 이분 탐색
        var lo = 0, hi = seg - 1
        while lo < hi {
            let mid = (lo + hi) / 2
            if u16(ends + 2 * mid) < c { lo = mid + 1 } else { hi = mid }
        }
        guard seg > 0, c <= u16(ends + 2 * lo), c >= u16(starts + 2 * lo) else { return 0 }
        let delta = i16(deltas + 2 * lo), rangeOffset = u16(ranges + 2 * lo)
        if rangeOffset == 0 { return (c + delta) & 0xFFFF }
        let g = u16(ranges + 2 * lo + rangeOffset + 2 * (c - u16(starts + 2 * lo)))
        return g == 0 ? 0 : (g + delta) & 0xFFFF
    }

    func glyph(_ gid: Int, depth: Int = 0) -> Glyph? {
        if let cached = cache[gid] { return cached }
        let result = loadGlyph(gid, depth: depth)
        cache[gid] = result
        return result
    }

    private func loadGlyph(_ gid: Int, depth: Int) -> Glyph? {
        guard depth < 4, let sub = subtables.first(where: { $0.first <= gid && gid <= $0.last }) else { return nil }
        let h = sub.offset
        let indexFormat = u16(h), imageFormat = u16(h + 2), imageOffset = ebdt + u32(h + 4)
        let body = h + 8, index = gid - sub.first
        var start = 0
        var indexMetrics: Int?   // 크기 고정 형식은 지표가 EBLC에 있음
        switch indexFormat {
        case 1: start = u32(body + 4 * index)
        case 3: start = u16(body + 2 * index)
        case 2:
            start = u32(body) * index
            indexMetrics = body + 4
        case 4:
            let count = u32(body)
            guard let k = (0..<count).first(where: { u16(body + 4 + 4 * $0) == gid }) else { return nil }
            start = u16(body + 4 + 4 * k + 2)
        case 5:
            let count = u32(body + 12)
            guard let k = (0..<count).first(where: { u16(body + 16 + 2 * $0) == gid }) else { return nil }
            start = u32(body) * k
            indexMetrics = body + 4
        default:
            return nil
        }
        var p = imageOffset + start

        // 지표: 높이, 너비, x 여백, y 위치(기준선 위), 전진 폭
        func metrics(_ o: Int) -> (Int, Int, Int, Int, Int) { (u8(o), u8(o + 1), i8(o + 2), i8(o + 3), u8(o + 4)) }
        let m: (Int, Int, Int, Int, Int)
        switch imageFormat {
        case 1, 2, 8: m = metrics(p); p += imageFormat == 8 ? 6 : 5
        case 6, 7, 9: m = metrics(p); p += 8
        case 5:
            guard let indexMetrics else { return nil }
            m = metrics(indexMetrics)
        default: return nil
        }
        let (height, width, bx, by, advance) = m
        var bits = [Bool](repeating: false, count: width * height)

        switch imageFormat {
        case 1, 6:   // 줄마다 바이트 정렬
            let stride = (width + 7) / 8
            for y in 0..<height {
                for x in 0..<width where (u8(p + y * stride + x / 8) >> (7 - x % 8)) & 1 == 1 {
                    bits[y * width + x] = true
                }
            }
        case 2, 5, 7:   // 비트 연속
            for i in 0..<(width * height) where (u8(p + i / 8) >> (7 - i % 8)) & 1 == 1 {
                bits[i] = true
            }
        case 8, 9:   // 합성: 다른 글자 조각을 (x, y)에 겹침 (한글 대부분)
            let count = u16(p)
            for k in 0..<count {
                let c = p + 2 + 4 * k
                guard let part = glyph(u16(c), depth: depth + 1) else { continue }
                let ox = i8(c + 2), oy = i8(c + 3)
                for y in 0..<part.height {
                    for x in 0..<part.width where part.bits[y * part.width + x] {
                        let tx = ox + x, ty = oy + y
                        if tx >= 0, tx < width, ty >= 0, ty < height { bits[ty * width + tx] = true }
                    }
                }
            }
        default:
            return nil
        }
        return Glyph(width: width, height: height, bearingX: bx, bearingY: by, advance: advance, bits: bits)
    }

    /// 이 글자를 비트맵으로 그릴 수 있는지 (글자가 비어 있지 않은지)
    public func canDraw(_ text: String) -> Bool {
        text.unicodeScalars.allSatisfy { glyph(glyphID($0))?.bits.contains(true) ?? false }
    }

    // MARK: - 그리기

    /// 한 줄을 비트맵으로. maxWidth를 넘으면 뒤를 자르고 `…`. color(ch)로 글자마다 색.
    public func render(_ text: String, maxWidth: Int,
                       color: (Character) -> (r: UInt8, g: UInt8, b: UInt8)) -> Bitmap {
        func advance(_ ch: Character) -> Int {
            ch.unicodeScalars.first.flatMap { glyph(glyphID($0))?.advance } ?? lineHeight / 2
        }
        var chars = Array(text)
        if chars.map(advance).reduce(0, +) > maxWidth {
            let ellipsis = advance("…")
            while !chars.isEmpty, chars.map(advance).reduce(0, +) + ellipsis > maxWidth { chars.removeLast() }
            chars.append("…")
        }
        let width = max(1, chars.map(advance).reduce(0, +))
        var out = Bitmap(width: width, height: lineHeight)
        var x = 0
        for ch in chars {
            if let scalar = ch.unicodeScalars.first, let g = glyph(glyphID(scalar)) {
                let c = color(ch)
                let top = ascender - g.bearingY
                for gy in 0..<g.height {
                    for gx in 0..<g.width where g.bits[gy * g.width + gx] {
                        out.fill(x: x + g.bearingX + gx, y: top + gy, w: 1, h: 1, r: c.r, g: c.g, b: c.b)
                    }
                }
            }
            x += advance(ch)
        }
        return out
    }
}
