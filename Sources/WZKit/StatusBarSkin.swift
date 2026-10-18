import Foundation

/// 빅뱅 전 StatusBar.img로 상태바 아래쪽(LV·이름·HP/MP/EXP) 부분을 합성.
/// 결과 크기 570×38: 원본 800×71 바탕에서 아래 38줄, EXP 칸 끝(570)까지.
public struct StatusBarSkin {
    public static let size = (width: 570, height: 38)
    static let cropY = 33
    static let gaugeOrigin = (x: 216, y: 37 - 33)
    /// HP·MP·EXP 막대의 안쪽 채움 영역 (gauge/bar 기준 x 범위, y 15...28)
    static let segments = [(2, 106), (110, 214), (223, 337)]
    static let valueX = [20, 131, 248]

    /// 이름 칸·LV 칸 위치 (합성 결과 좌표) — 글자는 앱에서 겹쳐 그림
    public static let nameOrigin = (x: 82, y: 5)
    /// LV 숫자 시작 위치 ("LV." 바로 오른쪽, 높이 맞춤)
    public static let levelOrigin = (x: 41, y: 14)
    /// 이름 칸 오른쪽 끝 (글자가 넘치면 여기서 자름)
    public static let nameMaxX = 205

    let background: Bitmap
    let background2: Bitmap
    let bar: Bitmap
    let graduation: Bitmap
    let emptyColor: (r: UInt8, g: UInt8, b: UInt8)
    let glyphs: [Character: Bitmap]
    /// LV 숫자 이미지 (Basic.img의 LevelNo). 없으면 앱이 글자로 그림.
    public private(set) var levelDigits: [Character: Bitmap] = [:]
    public var hasLevelDigits: Bool { levelDigits.count == 10 }

    /// StatusBar.img에서 필요한 조각 읽기
    public init(statusBar root: WZNode) throws {
        func bitmap(_ path: String) throws -> Bitmap {
            guard let canvas = root[path]?.canvas else { throw WZError.badFormat("\(path) 없음") }
            return try canvas.bitmap()
        }
        var glyphs: [Character: Bitmap] = [:]
        for digit in 0...9 { glyphs[Character(String(digit))] = try bitmap("number/\(digit)") }
        glyphs["/"] = try bitmap("number/slash")
        glyphs["%"] = try bitmap("number/percent")
        glyphs["["] = try bitmap("number/Lbracket")
        glyphs["]"] = try bitmap("number/Rbracket")
        let gray = try bitmap("gauge/gray").pixel(x: 0, y: 0)
        try self.init(
            background: bitmap("base/backgrnd"),
            background2: bitmap("base/backgrnd2"),
            bar: bitmap("gauge/bar"),
            graduation: bitmap("gauge/graduation"),
            emptyColor: (gray.r, gray.g, gray.b),
            glyphs: glyphs
        )
    }

    init(background: Bitmap, background2: Bitmap, bar: Bitmap, graduation: Bitmap,
         emptyColor: (r: UInt8, g: UInt8, b: UInt8), glyphs: [Character: Bitmap]) throws {
        self.background = background
        self.background2 = background2
        self.bar = bar
        self.graduation = graduation
        self.emptyColor = emptyColor
        var glyphs = glyphs
        // 원본 숫자 글꼴에 없는 `:`와 `.`은 같은 흰 점으로 만듦
        var colon = Bitmap(width: 1, height: 7)
        colon.fill(x: 0, y: 2, w: 1, h: 1, r: 255, g: 255, b: 255)
        colon.fill(x: 0, y: 5, w: 1, h: 1, r: 255, g: 255, b: 255)
        var dot = Bitmap(width: 1, height: 7)
        dot.fill(x: 0, y: 6, w: 1, h: 1, r: 255, g: 255, b: 255)
        glyphs[":"] = colon
        glyphs["."] = dot
        self.glyphs = glyphs
    }

    /// Basic.img에서 LV 숫자 0~9 읽기. 성공하면 true.
    @discardableResult
    public mutating func loadLevelDigits(basic root: WZNode) -> Bool {
        for path in ["LevelNo", "levelNo", "LvNo"] {
            var digits: [Character: Bitmap] = [:]
            for d in 0...9 {
                if let bitmap = try? root["\(path)/\(d)"]?.canvas?.bitmap() {
                    digits[Character(String(d))] = bitmap
                }
            }
            if digits.count == 10 {
                levelDigits = digits
                return true
            }
        }
        return false
    }

    /// 게이지 비율(0...1)과 각 값 문자열로 한 장 합성
    public func compose(level: Int = 0, hp: Double, mp: Double, exp: Double,
                        hpText: String, mpText: String, expText: String) -> Bitmap {
        var out = Bitmap(width: Self.size.width, height: Self.size.height)
        out.draw(background, x: 0, y: 0, sx: 0, sy: Self.cropY, w: Self.size.width, h: Self.size.height)
        out.draw(background2, x: 0, y: 0, sx: 0, sy: Self.cropY, w: background2.width, h: Self.size.height)

        var gauge = bar
        for ((x0, x1), fraction) in zip(Self.segments, [hp, mp, exp]) {
            let clamped = min(1, max(0, fraction.isFinite ? fraction : 0))
            let end = x0 + Int((Double(x1 - x0 + 1) * clamped).rounded())
            if end <= x1 {
                gauge.fill(x: end, y: 15, w: x1 - end + 1, h: 14,
                           r: emptyColor.r, g: emptyColor.g, b: emptyColor.b)
            }
        }
        let origin = Self.gaugeOrigin
        out.draw(gauge, x: origin.x, y: origin.y)
        out.draw(graduation, x: origin.x, y: origin.y)

        for (valueX, text) in zip(Self.valueX, [hpText, mpText, expText]) {
            var x = origin.x + valueX
            for ch in text {
                guard let glyph = glyphs[ch] else { x += 4; continue }
                out.draw(glyph, x: x, y: origin.y + (ch == "[" || ch == "]" ? 2 : 3))
                x += glyph.width + 1
            }
        }

        do {
            // Basic.img 숫자가 없으면 주황 블록 + 흰 숫자로 대신 그림
            let chars = Array(String(max(0, level)))
            let images = chars.compactMap { hasLevelDigits ? levelDigits[$0] : orangeTile($0) }
            var x = Self.levelOrigin.x
            for image in images {
                out.draw(image, x: x, y: Self.levelOrigin.y)
                x += image.width + 1
            }
        }
        return out
    }

    /// 대체 LV 숫자: 11×15 주황 블록(위가 밝은 그라데이션, 진한 테두리) 가운데 흰 숫자 (2배)
    private func orangeTile(_ ch: Character) -> Bitmap? {
        guard let glyph = glyphs[ch] else { return nil }
        var tile = Bitmap(width: 13, height: 17)
        tile.fill(x: 1, y: 0, w: 11, h: 17, r: 0x5a, g: 0x1c, b: 0x00)
        tile.fill(x: 0, y: 1, w: 13, h: 15, r: 0x5a, g: 0x1c, b: 0x00)
        for row in 1..<16 {
            let t = Double(row - 1) / 14
            let r = UInt8(0xf2 - (0xf2 - 0xb8) * t)
            let g = UInt8(0x9a - (0x9a - 0x52) * t)
            let b = UInt8(0x4c - (0x4c - 0x14) * t)
            tile.fill(x: 1, y: row, w: 11, h: 1, r: r, g: g, b: b)
        }
        tile.fill(x: 2, y: 1, w: 9, h: 1, r: 0xff, g: 0xc8, b: 0x8a)   // 윗변 하이라이트
        // 숫자 2배 확대 (그림자 1px 먼저)
        for y in 0..<glyph.height {
            for x in 0..<glyph.width where glyph.pixel(x: x, y: y).a > 128 {
                tile.fill(x: 2 + x * 2 + 1, y: 2 + y * 2 + 1, w: 2, h: 2, r: 0x6a, g: 0x24, b: 0x00)
            }
        }
        for y in 0..<glyph.height {
            for x in 0..<glyph.width where glyph.pixel(x: x, y: y).a > 128 {
                tile.fill(x: 2 + x * 2, y: 2 + y * 2, w: 2, h: 2, r: 0xff, g: 0xf4, b: 0xe0)
            }
        }
        return tile
    }
}

/// Game.img(Sound.wz)에서 효과음 꺼내기
public struct SoundBank {
    public let sounds: [String: WZSound]

    public init(gameImage root: WZNode) {
        var sounds: [String: WZSound] = [:]
        for name in root.childNames {
            if let sound = root[name]?.sound { sounds[name] = sound }
        }
        self.sounds = sounds
    }

    public var names: [String] { sounds.keys.sorted() }
}
