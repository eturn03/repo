import Foundation
import CommonCrypto
import Compression

/// 메이플스토리 WZ `.img` 파일 읽기 (속성·캔버스만). 게임 파일은 사용자가 직접 넣음.
public enum WZError: Error, CustomStringConvertible {
    case truncated
    case badFormat(String)
    case unknownEncryption
    case unsupportedPixelFormat(Int)
    case decompressFailed

    public var description: String {
        switch self {
        case .truncated: return "파일이 중간에 끊김"
        case .badFormat(let s): return "형식 오류: \(s)"
        case .unknownEncryption: return "암호화 방식을 알 수 없음 (KMS/GMS/구버전 아님)"
        case .unsupportedPixelFormat(let f): return "지원하지 않는 이미지 형식 \(f)"
        case .decompressFailed: return "이미지 압축 해제 실패"
        }
    }
}

public indirect enum WZNode {
    case null
    case int(Int)
    case double(Double)
    case string(String)
    case property([String: WZNode])
    case canvas(WZCanvas)
    case vector(Int, Int)
    case uol(String)
    case sound(WZSound)
    case other(String)

    public subscript(path: String) -> WZNode? {
        var node: WZNode? = self
        for part in path.split(separator: "/") {
            switch node {
            case .property(let children)?: node = children[String(part)]
            case .canvas(let c)?: node = c.children[String(part)]
            default: return nil
            }
        }
        return node
    }

    public var canvas: WZCanvas? {
        if case .canvas(let c) = self { return c }
        return nil
    }

    public var sound: WZSound? {
        if case .sound(let s) = self { return s }
        return nil
    }

    /// 이 노드 아래 모든 소리의 경로 (예: "SleepyWood", "Sub/Henesys")
    public var soundPaths: [String] {
        var result: [String] = []
        func walk(_ node: WZNode, _ prefix: String) {
            if case .sound = node { result.append(prefix); return }
            guard case .property(let children) = node else { return }
            for name in children.keys.sorted() {
                walk(children[name]!, prefix.isEmpty ? name : "\(prefix)/\(name)")
            }
        }
        walk(self, "")
        return result
    }

    /// 하위 항목 이름들 (속성 노드일 때)
    public var childNames: [String] {
        if case .property(let children) = self { return children.keys.sorted() }
        return []
    }
}

/// 효과음 (Sound.wz). data는 보통 MP3 스트림 그대로.
public struct WZSound {
    public let durationMs: Int
    public let data: Data
}

public struct WZCanvas {
    public let width: Int
    public let height: Int
    public let format: Int
    public let children: [String: WZNode]
    let data: [UInt8]
    let key: [UInt8]

    /// 픽셀 데이터를 풀어서 RGBA 비트맵으로
    public func bitmap() throws -> Bitmap {
        let bytesPerPixel: Int
        switch format {
        case 1, 513: bytesPerPixel = 2
        case 2: bytesPerPixel = 4
        default: throw WZError.unsupportedPixelFormat(format)
        }
        let raw = try inflate(expected: width * height * bytesPerPixel)
        var out = Bitmap(width: width, height: height)
        for i in 0..<(width * height) {
            let r, g, b, a: UInt8
            switch format {
            case 1: // BGRA4444
                let lo = raw[2 * i], hi = raw[2 * i + 1]
                b = (lo & 0x0f) * 17; g = (lo >> 4) * 17; r = (hi & 0x0f) * 17; a = (hi >> 4) * 17
            case 2: // BGRA8888
                b = raw[4 * i]; g = raw[4 * i + 1]; r = raw[4 * i + 2]; a = raw[4 * i + 3]
            default: // RGB565
                let v = UInt16(raw[2 * i]) | UInt16(raw[2 * i + 1]) << 8
                r = UInt8((Int(v >> 11) & 31) * 255 / 31)
                g = UInt8((Int(v >> 5) & 63) * 255 / 63)
                b = UInt8(Int(v & 31) * 255 / 31)
                a = 255
            }
            out.pixels[4 * i] = r; out.pixels[4 * i + 1] = g; out.pixels[4 * i + 2] = b; out.pixels[4 * i + 3] = a
        }
        return out
    }

    private func inflate(expected: Int) throws -> [UInt8] {
        var zlibStream: [UInt8]
        if data.count >= 2, data[0] == 0x78 {
            zlibStream = data
        } else {
            // 암호화된 블록들: [길이(int32)][키로 XOR한 바이트]...
            zlibStream = []
            var p = 0
            while p + 4 <= data.count {
                let n = Int(Int32(bitPattern: UInt32(data[p]) | UInt32(data[p + 1]) << 8 | UInt32(data[p + 2]) << 16 | UInt32(data[p + 3]) << 24))
                p += 4
                guard n >= 0, p + n <= data.count else { throw WZError.decompressFailed }
                for i in 0..<n { zlibStream.append(data[p + i] ^ key[i % key.count]) }
                p += n
            }
        }
        // Compression의 ZLIB는 헤더 없는 deflate → 앞 2바이트(zlib 헤더) 건너뜀
        guard zlibStream.count > 2 else { throw WZError.decompressFailed }
        let body = Array(zlibStream[2...])
        var out = [UInt8](repeating: 0, count: expected)
        let written = out.withUnsafeMutableBufferPointer { dst in
            body.withUnsafeBufferPointer { src in
                compression_decode_buffer(dst.baseAddress!, expected, src.baseAddress!, body.count, nil, COMPRESSION_ZLIB)
            }
        }
        guard written == expected else { throw WZError.decompressFailed }
        return out
    }
}

public enum WZImage {
    /// `.img` 파일 전체를 읽어서 최상위 속성 노드 반환 (KMS → GMS → 구버전 순으로 키 시도)
    public static func load(_ data: [UInt8]) throws -> WZNode {
        for iv in [WZKey.kmsIV, WZKey.gmsIV, WZKey.zeroIV] {
            let key = WZKey.generate(iv: iv)
            var reader = WZReader(bytes: data, key: key)
            guard (try? reader.stringBlock()) == "Property" else { continue }
            reader.pos = 0
            return try reader.extended()
        }
        throw WZError.unknownEncryption
    }

    public static func load(contentsOf url: URL) throws -> WZNode {
        try load([UInt8](Data(contentsOf: url)))
    }
}

public enum WZKey {
    static let userKey: [UInt8] = [
        0x13, 0, 0, 0, 0x08, 0, 0, 0, 0x06, 0, 0, 0, 0xB4, 0, 0, 0,
        0x1B, 0, 0, 0, 0x0F, 0, 0, 0, 0x33, 0, 0, 0, 0x52, 0, 0, 0,
    ]
    public static let kmsIV: [UInt8] = [0xB9, 0x7D, 0x63, 0xE9]
    public static let gmsIV: [UInt8] = [0x4D, 0x23, 0xC7, 0x2B]
    public static let zeroIV: [UInt8] = [0, 0, 0, 0]

    public static func generate(iv: [UInt8], length: Int = 0x10000) -> [UInt8] {
        if iv == zeroIV { return [UInt8](repeating: 0, count: length) }
        var out: [UInt8] = []
        out.reserveCapacity(length + 16)
        var block = iv + iv + iv + iv
        while out.count < length {
            block = encryptBlock(block)
            out += block
        }
        return Array(out.prefix(length))
    }

    private static func encryptBlock(_ input: [UInt8]) -> [UInt8] {
        var output = [UInt8](repeating: 0, count: 32)
        var moved = 0
        let status = CCCrypt(
            CCOperation(kCCEncrypt), CCAlgorithm(kCCAlgorithmAES), CCOptions(kCCOptionECBMode),
            userKey, userKey.count, nil, input, input.count, &output, output.count, &moved
        )
        precondition(status == kCCSuccess, "AES 실패")
        return Array(output.prefix(16))
    }
}

struct WZReader {
    let bytes: [UInt8]
    let key: [UInt8]
    var pos = 0

    init(bytes: [UInt8], key: [UInt8]) {
        self.bytes = bytes
        self.key = key
    }

    mutating func u8() throws -> UInt8 {
        guard pos < bytes.count else { throw WZError.truncated }
        defer { pos += 1 }
        return bytes[pos]
    }

    mutating func s8() throws -> Int8 { Int8(bitPattern: try u8()) }

    mutating func u16() throws -> UInt16 {
        let lo = UInt16(try u8())
        return lo | UInt16(try u8()) << 8
    }

    mutating func i32() throws -> Int32 {
        var v: UInt32 = 0
        for i in 0..<4 { v |= UInt32(try u8()) << (8 * UInt32(i)) }
        return Int32(bitPattern: v)
    }

    mutating func i64() throws -> Int64 {
        var v: UInt64 = 0
        for i in 0..<8 { v |= UInt64(try u8()) << (8 * UInt64(i)) }
        return Int64(bitPattern: v)
    }

    mutating func compressedInt() throws -> Int {
        let b = try s8()
        return b == -128 ? Int(try i32()) : Int(b)
    }

    mutating func compressedLong() throws -> Int {
        let b = try s8()
        return b == -128 ? Int(try i64()) : Int(b)
    }

    mutating func skip(_ n: Int) throws {
        guard n >= 0, pos + n <= bytes.count else { throw WZError.truncated }
        pos += n
    }

    mutating func string() throws -> String {
        let n8 = try s8()
        if n8 == 0 { return "" }
        if n8 > 0 {
            let n = n8 == 127 ? Int(try i32()) : Int(n8)
            var units: [UInt16] = []
            var mask: UInt16 = 0xAAAA
            for i in 0..<n {
                let k = UInt16(key[(2 * i) % key.count]) | UInt16(key[(2 * i + 1) % key.count]) << 8
                units.append(try u16() ^ mask ^ k)
                mask &+= 1
            }
            return String(decoding: units, as: UTF16.self)
        }
        let n = n8 == -128 ? Int(try i32()) : -Int(n8)
        var chars: [UInt8] = []
        var mask: UInt8 = 0xAA
        for i in 0..<n {
            chars.append(try u8() ^ mask ^ key[i % key.count])
            mask &+= 1
        }
        return String(bytes: chars, encoding: .isoLatin1) ?? ""
    }

    mutating func stringBlock() throws -> String {
        let type = try u8()
        switch type {
        case 0x00, 0x73:
            return try string()
        case 0x01, 0x1B:
            let offset = Int(try i32())
            let saved = pos
            guard offset >= 0, offset < bytes.count else { throw WZError.badFormat("문자열 위치") }
            pos = offset
            defer { pos = saved }
            return try string()
        default:
            throw WZError.badFormat("문자열 블록 \(type)")
        }
    }

    mutating func properties() throws -> [String: WZNode] {
        var result: [String: WZNode] = [:]
        let count = try compressedInt()
        for _ in 0..<max(0, count) {
            let name = try stringBlock()
            let type = try u8()
            let value: WZNode
            switch type {
            case 0: value = .null
            case 2, 11: value = .int(Int(Int16(bitPattern: try u16())))
            case 3, 19: value = .int(try compressedInt())
            case 20: value = .int(try compressedLong())
            case 4:
                if try u8() == 0x80 {
                    value = .double(Double(Float(bitPattern: UInt32(bitPattern: try i32()))))
                } else {
                    value = .double(0)
                }
            case 5: value = .double(Double(bitPattern: UInt64(bitPattern: try i64())))
            case 8: value = .string(try stringBlock())
            case 9:
                let size = Int(try i32())
                let end = pos + size
                value = try extended()
                pos = end
            default:
                throw WZError.badFormat("속성 형식 \(type) (\(name))")
            }
            result[name] = value
        }
        return result
    }

    mutating func extended() throws -> WZNode {
        let kind = try stringBlock()
        switch kind {
        case "Property":
            try skip(2)
            return .property(try properties())
        case "Canvas":
            try skip(1)
            var children: [String: WZNode] = [:]
            if try u8() == 1 {
                try skip(2)
                children = try properties()
            }
            let width = try compressedInt()
            let height = try compressedInt()
            let format = try compressedInt() + Int(try u8())
            try skip(4)
            let length = Int(try i32())
            try skip(1)
            guard length >= 1, pos + length - 1 <= bytes.count else { throw WZError.truncated }
            let data = Array(bytes[pos..<(pos + length - 1)])
            pos += length - 1
            return .canvas(WZCanvas(width: width, height: height, format: format, children: children, data: data, key: key))
        case "Shape2D#Vector2D":
            return .vector(try compressedInt(), try compressedInt())
        case "UOL":
            try skip(1)
            return .uol(try stringBlock())
        case "Sound_DX8":
            try skip(1)
            let dataLength = try compressedInt()
            let durationMs = try compressedInt()
            // 51바이트 머리 + 형식 길이(1) + 형식 정보
            let headerStart = pos
            try skip(51)
            let formatLength = Int(try u8())
            pos = headerStart
            try skip(51 + 1 + formatLength)
            guard dataLength >= 0, pos + dataLength <= bytes.count else { throw WZError.truncated }
            let data = Data(bytes[pos..<(pos + dataLength)])
            pos += dataLength
            return .sound(WZSound(durationMs: durationMs, data: data))
        default:
            return .other(kind)
        }
    }
}
