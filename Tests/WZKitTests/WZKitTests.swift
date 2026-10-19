import XCTest
@testable import WZKit

final class WZKitTests: XCTestCase {
    /// 직접 만든 가짜 WZ 파일 (KMS 키, 게임 데이터 아님). 실제 WZ처럼 deflate 끝 표시 없음:
    /// answer=42, title="임진택", plain=4x3 캔버스(zlib), group/secret=같은 캔버스(암호화 블록, 형식 문자열은 위치 참조),
    /// Beep=소리(1234ms, "\xff\xf3TEST")
    static let fixtureBase64 = "c/hRvIrYrBCTwgAABQD6YKCW36wQAyoA+3WnkcSsCAADhQgmZha3APtxooTBpwkqAAAAc/pCr4veqBEAAAQDAQAAAAAAFAAAAAB4nGL4/+ED/4f//QxoNAAAAP//APtmvIrduQlJAAAAc/hRvIrYrBCTwgAAAQD6cquG2qwWCS8AAAAbNAAAAAAABAMBAAAAAAAcAAAAAAkAAADT+Sv9mCxU9R8KAAAAVJhFbVPNVwpnhAD8Q6uA2AlOAAAAc/dSoZDGrT2j4xIABoDSBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgEC//NURVNU"

    private func root() throws -> WZNode {
        try WZImage.load([UInt8](Data(base64Encoded: Self.fixtureBase64)!))
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
        var bank = SoundBank()
        bank.add(try root(), prefix: "Game")
        XCTAssertEqual(bank.names, ["Game/Beep"])
        XCTAssertEqual(sound.data, Data([0xff, 0xf3]) + Data("TEST".utf8))
    }

    func testRootNamesKeepFileOrder() throws {
        let names = try WZImage.rootNames([UInt8](Data(base64Encoded: Self.fixtureBase64)!))
        XCTAssertEqual(Set(names), Set(try root().children.keys))
        XCTAssertEqual(names.count, try root().children.count)
    }

    func testFollowsUOLLinks() {
        let canvas = WZNode.int(7)
        let root = WZNode.property([
            "front": .property(["head": canvas]),
            "stand1": .property(["0": .property(["head": .uol("../../front/head")])]),
            "alias": .uol("stand1"),
        ])
        XCTAssertEqual(root.node(at: "stand1/0/head")?.intValue, 7)
        XCTAssertEqual(root.node(at: "alias/0/head")?.intValue, 7)
        XCTAssertNil(root.node(at: "stand1/9"))
    }

    func testCharacterAssemblyUsesAnchors() {
        func solid(_ w: Int, _ h: Int, _ v: UInt8) -> Bitmap {
            var b = Bitmap(width: w, height: h)
            b.fill(x: 0, y: 0, w: w, h: h, r: v, g: v, b: v)
            return b
        }
        // 몸: 10x20, 기준점 발밑(5,20), 목은 기준점에서 (0,-18)
        let body = CharacterRenderer.Part(image: solid(10, 20, 100), origin: (5, 20), map: ["neck": (0, -18)], z: "body")
        // 머리: 8x8, 기준점 (4,8), 목은 기준점에서 (0,0) → 머리 아래쪽 가운데가 몸의 목에 붙음
        let head = CharacterRenderer.Part(image: solid(8, 8, 200), origin: (4, 8), map: ["neck": (0, 0)], z: "head")
        let (image, ox, oy) = CharacterRenderer.assemble([head, body].reversed(), zRank: ["head": 0, "body": 1])!
        XCTAssertEqual(image.width, 10)
        XCTAssertEqual(image.height, 26)   // 머리 위 6px + 몸 20px
        XCTAssertEqual(ox, 5)
        XCTAssertEqual(oy, 26)
        XCTAssertTrue(image.pixel(x: 5, y: 3) == (200, 200, 200, 255))   // 머리
        XCTAssertTrue(image.pixel(x: 5, y: 7) == (200, 200, 200, 255))   // 머리가 몸 위에 그려짐
        XCTAssertTrue(image.pixel(x: 5, y: 20) == (100, 100, 100, 255))  // 몸
    }

    func testWarriorOutfitPicksHighestUsable() {
        let items = [
            EquipInfo(id: "01040009", slot: .coat, reqLevel: 25, reqJob: 1, cash: false),
            EquipInfo(id: "01040012", slot: .coat, reqLevel: 40, reqJob: 1, cash: false),
            EquipInfo(id: "01040002", slot: .coat, reqLevel: 0, reqJob: 0, cash: false),
            EquipInfo(id: "01050000", slot: .longcoat, reqLevel: 35, reqJob: 1, cash: false),
            EquipInfo(id: "01060009", slot: .pants, reqLevel: 25, reqJob: 1, cash: false),
            EquipInfo(id: "01402015", slot: .weapon, reqLevel: 80, reqJob: 1, cash: false),
            EquipInfo(id: "01402001", slot: .weapon, reqLevel: 0, reqJob: 0, cash: false),
            EquipInfo(id: "01302000", slot: .weapon, reqLevel: 0, reqJob: 0, cash: false),
            EquipInfo(id: "01082005", slot: .glove, reqLevel: 30, reqJob: 1, cash: true),
        ]
        XCTAssertEqual(EquipInfo.warriorOutfit(from: items, level: 30).map(\.id), ["01040009", "01060009", "01402001"])
        XCTAssertEqual(EquipInfo.warriorOutfit(from: items, level: 36).map(\.id), ["01050000", "01402001"])
        XCTAssertEqual(EquipInfo.warriorOutfit(from: items, level: 80).map(\.id), ["01040012", "01060009", "01402015"])
        // 레벨에 맞는 무기가 없으면 가진 것 중 가장 낮은 두손검
        let onlyHighWeapon = items.filter { $0.id != "01402001" }
        XCTAssertEqual(EquipInfo.warriorOutfit(from: onlyHighWeapon, level: 20).map(\.id), ["01402015"])
        XCTAssertEqual(EquipInfo.slot(forID: "01402015"), .weapon)
        XCTAssertEqual(EquipInfo.slot(forID: "00002000"), nil)
    }

    func testFlipMirrorsImageAndOrigin() {
        var b = Bitmap(width: 3, height: 1)
        b.fill(x: 0, y: 0, w: 1, h: 1, r: 255, g: 0, b: 0)
        let anim = FrameAnimation(frames: [.init(image: b, originX: 0, originY: 1, delayMs: 100)]).flipped()
        XCTAssertTrue(anim.frames[0].image.pixel(x: 2, y: 0) == (255, 0, 0, 255))
        XCTAssertEqual(anim.frames[0].originX, 3)
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

    func testGaugeHitAreas() {
        let y = 4 + 20
        XCTAssertEqual(StatusBarSkin.gauge(atX: 216 + 50, y: y), 0)    // HP
        XCTAssertEqual(StatusBarSkin.gauge(atX: 216 + 160, y: y), 1)   // MP
        XCTAssertEqual(StatusBarSkin.gauge(atX: 216 + 300, y: y), 2)   // EXP
        XCTAssertNil(StatusBarSkin.gauge(atX: 100, y: y))              // 이름 칸
        XCTAssertNil(StatusBarSkin.gauge(atX: 216 + 219, y: y))        // MP와 EXP 사이
        XCTAssertNil(StatusBarSkin.gauge(atX: 216 + 50, y: 1))         // 막대 위쪽 밖
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
        XCTAssertEqual(out.width, 565)
        XCTAssertEqual(out.height, 38)
        // HP 막대 오른쪽 끝은 회색, 왼쪽 끝은 막대 색
        XCTAssertTrue(out.pixel(x: 216 + 100, y: 4 + 20) == (204, 204, 204, 255))
        XCTAssertTrue(out.pixel(x: 216 + 5, y: 4 + 20) == (200, 200, 200, 255))
        // EXP 0% → 전부 회색, MP 100% → 회색 없음
        XCTAssertTrue(out.pixel(x: 216 + 224, y: 4 + 20) == (204, 204, 204, 255))
        XCTAssertTrue(out.pixel(x: 216 + 213, y: 4 + 20) == (200, 200, 200, 255))
        // 오른쪽 끝은 backgrnd2 판
        XCTAssertTrue(out.pixel(x: 560, y: 20) == (20, 20, 20, 255))
    }
}

final class FrameAnimationTests: XCTestCase {
    private func frame(_ w: Int, _ h: Int, origin: (Int, Int), delay: Int) -> FrameAnimation.Frame {
        FrameAnimation.Frame(image: Bitmap(width: w, height: h), originX: origin.0, originY: origin.1, delayMs: delay)
    }

    func testBoundsAndTiming() {
        let anim = FrameAnimation(frames: [
            frame(10, 20, origin: (5, 20), delay: 100),
            frame(30, 40, origin: (10, 35), delay: 50),
        ])
        XCTAssertEqual(anim.durationMs, 150)
        let b = anim.bounds
        XCTAssertEqual(b.minX, -10)
        XCTAssertEqual(b.minY, -35)
        XCTAssertEqual(b.maxX, 20)
        XCTAssertEqual(b.maxY, 5)
        XCTAssertEqual(anim.frameIndex(atMs: 0), 0)
        XCTAssertEqual(anim.frameIndex(atMs: 99), 0)
        XCTAssertEqual(anim.frameIndex(atMs: 100), 1)
        XCTAssertNil(anim.frameIndex(atMs: 150))
    }

    func testNoFramesInNode() throws {
        let root = try WZImage.load([UInt8](Data(base64Encoded: WZKitTests.fixtureBase64)!))
        XCTAssertNil(FrameAnimation(node: root))
    }
}
