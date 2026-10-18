import Foundation

/// 빅뱅 전 StatusBar.img로 상태바 아래쪽(LV·이름·HP/MP/EXP) 부분을 합성.
/// 결과 크기 600×38: 원본 800×71 바탕에서 아래 38줄, 왼쪽 600칸(오른쪽 30칸은 돋보기 자리).
public struct StatusBarSkin {
    public static let size = (width: 600, height: 38)
    static let cropY = 33
    static let gaugeOrigin = (x: 216, y: 37 - 33)
    /// HP·MP·EXP 막대의 안쪽 채움 영역 (gauge/bar 기준 x 범위, y 15...28)
    static let segments = [(2, 106), (110, 214), (223, 337)]
    static let valueX = [20, 131, 248]

    /// 이름 칸·LV 칸 위치 (합성 결과 좌표) — 글자는 앱에서 겹쳐 그림
    public static let nameOrigin = (x: 82, y: 5)
    public static let levelSlot = (x: 39, y: 14, width: 38, height: 21)
    public static let buttonSlot = (x: 571, y: 6, width: 27, height: 27)

    let background: Bitmap
    let background2: Bitmap
    let bar: Bitmap
    let graduation: Bitmap
    let emptyColor: (r: UInt8, g: UInt8, b: UInt8)
    let glyphs: [Character: Bitmap]

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

    /// 게이지 비율(0...1)과 각 값 문자열로 한 장 합성
    public func compose(hp: Double, mp: Double, exp: Double,
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
        return out
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
