import XCTest
@testable import WZKit

final class WZKitTests: XCTestCase {
    /// 직접 만든 가짜 WZ 파일 (KMS 키, 게임 데이터 아님):
    /// answer=42, title="임진택", plain=4x3 캔버스(zlib), group/secret=같은 캔버스(암호화 블록, 형식 문자열은 위치 참조),
    /// Beep=소리(1234ms, "\xff\xf3TEST")
    private let fixture = "c/hRvIrYrBCTwgAABQD6YKCW36wQAyoA+3WnkcSsCAADhQgmZha3APtxooTBpwkqAAAAc/pCr4veqBEAAAQDAQAAAAAAFAAAAAB4nGP4/+ED/4f//QxoNADG3hBFAPtmvIrduQlJAAAAc/hRvIrYrBCTwgAAAQD6cquG2qwWCS8AAAAbNAAAAAAABAMBAAAAAAAcAAAAAAkAAADT+Sr9mCxU9R8KAAAAVJhFbVPNkdSIPgD8Q6uA2AlOAAAAc/dSoZDGrT2j4xIABoDSBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgEC//NURVNU"

    private func root() throws -> WZNode {
        try WZImage.load([UInt8](Data(base64Encoded: fixture)!))
    }

    func testKeyMatchesKnownKMSBytes() {
        XCTAssertEqual(WZKey.generate(iv: WZKey.kmsIV, length: 8), [0xab, 0x65, 0x49, 0x05, 0x67, 0xcd, 0x57, 0x0a])
    }

    func testReadsProperties() throws {
        let node = try root()
        guard case .int(42)? = node["answer"] else { return XCTFail("answer") }
        guard case .string("임진택")? = node["title"] else { return XCTFail("title") }
    }

    func testDecodesPlainAndEncryptedCanvas() throws {
        let node = try root()
        for path in ["plain", "group/secret"] {
            let bitmap = try XCTUnwrap(node[path]?.canvas, path).bitmap()
            XCTAssertEqual(bitmap.width, 4)
            XCTAssertEqual(bitmap.height, 3)
            XCTAssertTrue(bitmap.pixel(x: 0, y: 0) == (255, 0, 0, 255), path)
            XCTAssertTrue(bitmap.pixel(x: 1, y: 0) == (0, 255, 0, 255), path)
            XCTAssertTrue(bitmap.pixel(x: 2, y: 0) == (0, 0, 255, 255), path)
            XCTAssertTrue(bitmap.pixel(x: 3, y: 0) == (255, 255, 255, 136), path)
            XCTAssertNotNil(bitmap.cgImage())
        }
    }

    func testReadsSound() throws {
        let sound = try XCTUnwrap(try root()["Beep"]?.sound)
        XCTAssertEqual(sound.durationMs, 1234)
        XCTAssertEqual(try root().soundPaths, ["Beep"])
        XCTAssertEqual(sound.data, Data([0xff, 0xf3]) + Data("TEST".utf8))
    }

    func testRejectsGarbage() {
        XCTAssertThrowsError(try WZImage.load([0x01, 0x02, 0x03]))
    }

    func testBitmapDrawClipsAndBlends() {
        var dst = Bitmap(width: 3, height: 2)
        dst.fill(x: 0, y: 0, w: 3, h: 2, r: 0, g: 0, b: 0)
        var src = Bitmap(width: 2, height: 2)
        src.fill(x: 0, y: 0, w: 2, h: 2, r: 255, g: 255, b: 255, a: 128)
        dst.draw(src, x: 2, y: 1)      // 오른쪽 아래 1픽셀만 겹침
        dst.draw(src, x: -5, y: -5)    // 완전히 밖 → 무시
        XCTAssertTrue(dst.pixel(x: 2, y: 1) == (128, 128, 128, 255))
        XCTAssertTrue(dst.pixel(x: 1, y: 1) == (0, 0, 0, 255))
    }

    func testSkinComposeFillsEmptyPartWithGray() throws {
        func solid(_ w: Int, _ h: Int, _ v: UInt8) -> Bitmap {
            var b = Bitmap(width: w, height: h)
            b.fill(x: 0, y: 0, w: w, h: h, r: v, g: v, b: v)
            return b
        }
        var glyphs: [Character: Bitmap] = [:]
        for ch in "0123456789/%[]" { glyphs[ch] = solid(5, 7, 255) }
        let skin = try StatusBarSkin(
            background: solid(800, 71, 10), background2: solid(570, 71, 20),
            bar: solid(340, 31, 200), graduation: Bitmap(width: 340, height: 31),
            emptyColor: (204, 204, 204), glyphs: glyphs
        )
        let out = skin.compose(hp: 0.5, mp: 1, exp: 0, hpText: "[1:00/2:00]", mpText: "[1/1]", expText: "")
        XCTAssertEqual(out.width, 570)
        XCTAssertEqual(out.height, 38)
        // HP 막대 오른쪽 끝은 회색, 왼쪽 끝은 막대 색
        XCTAssertTrue(out.pixel(x: 216 + 100, y: 4 + 20) == (204, 204, 204, 255))
        XCTAssertTrue(out.pixel(x: 216 + 5, y: 4 + 20) == (200, 200, 200, 255))
        // EXP 0% → 전부 회색, MP 100% → 회색 없음
        XCTAssertTrue(out.pixel(x: 216 + 224, y: 4 + 20) == (204, 204, 204, 255))
        XCTAssertTrue(out.pixel(x: 216 + 213, y: 4 + 20) == (200, 200, 200, 255))
        // 오른쪽 끝은 backgrnd2 판
        XCTAssertTrue(out.pixel(x: 565, y: 20) == (20, 20, 20, 255))
    }
}
