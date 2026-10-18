import XCTest
@testable import WZKit

final class BitmapFontTests: XCTestCase {
    /// 직접 만든 가짜 글꼴 (글자 2개): 'A' = 3x3 X 모양(바이트 정렬),
    /// '가' = 합성 글자(2x2 조각을 (1,1)에), 12px strike, ascender 10 / descender -2
    private let fixture = "AAEAAAAFAAAAAAAARUJEVAAAAAAAAABcAAAAHkVCTEMAAAAAAAAAfAAAAIBjbWFwAAAAAAAAAPwAAAA0bWF4cAAAAAAAAAEwAAAABm5hbWUAAAAAAAABOAAAAE4AAgAAAwMACQSgQKACAgAJA/AEBAAJBQAAAQADAQEAAAACAAAAAAABAAAAOAAAAEgAAAADAAAAAAr+DAAAAAAAAAAAAAr+DAAAAAAAAAAAAAABAAMMDAEBAAEAAQAAABgAAgACAAAAJAADAAMAAAA4AAMAAQAAAAAABAAMAAIACAAAABIAAAAMBAQACQUAAAQAAQACAAAAAAAAAAwAAAASAAAAAQADAAEAAAAMAAQAKAAAAAYAAAAAAAAAQawA//8AAABBrAD////AVAIAAQAAAAAAAAAAUAAABAAAAAAAAgAeAAMAAQQJAAEAEAAAAAMAAQQJAAYAIAAQAFQAZQBzAHQARgBvAG4AdABUAGUAcwB0AEYAbwBuAHQALQBSAGUAZwB1AGwAYQByAAA="

    private func font() throws -> BitmapFont {
        let data = [UInt8](Data(base64Encoded: fixture)!)
        let face = try XCTUnwrap(BitmapFont.faces(in: data).first)
        XCTAssertEqual(face.family, "TestFont")
        XCTAssertEqual(face.postScriptName, "TestFont-Regular")
        return try XCTUnwrap(BitmapFont(data: data, face: face, ppem: 12))
    }

    func testRendersSimpleAndCompositeGlyphs() throws {
        let f = try font()
        XCTAssertEqual(f.lineHeight, 12)
        XCTAssertTrue(f.canDraw("A가"))
        let out = f.render("A가", maxWidth: 100) { _ in (255, 255, 255) }
        XCTAssertEqual(out.width, 9)
        XCTAssertEqual(out.height, 12)
        var on: [String] = []
        for y in 0..<out.height {
            for x in 0..<out.width where out.pixel(x: x, y: y).a > 0 { on.append("\(x),\(y)") }
        }
        XCTAssertEqual(on, ["0,1", "2,1", "1,2", "5,2", "6,2", "0,3", "2,3", "5,3", "6,3"])
    }

    func testMissingStrikeOrGlyph() throws {
        let data = [UInt8](Data(base64Encoded: fixture)!)
        let face = try XCTUnwrap(BitmapFont.faces(in: data).first)
        XCTAssertNil(BitmapFont(data: data, face: face, ppem: 13))
        XCTAssertFalse(try font().canDraw("B"))
    }

    func testPerCharacterColor() throws {
        let out = try font().render("A", maxWidth: 100) { _ in (153, 204, 51) }
        XCTAssertTrue(out.pixel(x: 0, y: 1) == (153, 204, 51, 255))
    }
}
