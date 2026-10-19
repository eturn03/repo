import Foundation

/// 메이플 캐릭터 합성: 몸·머리·얼굴·헤어·장비 조각을 map 기준점(목·배꼽·손·눈썹)으로 이어 붙이고
/// zmap 순서(앞 층이 위)로 겹침. 결과 기준점은 몸의 origin(발밑).
public struct CharacterRenderer {
    /// 조각 하나: 이미지, 이미지 안의 기준점, 기준점에서 본 연결점들, 층 이름
    public struct Part {
        public let image: Bitmap
        public let origin: (x: Int, y: Int)
        public let map: [String: (x: Int, y: Int)]
        public let z: String

        public init(image: Bitmap, origin: (x: Int, y: Int), map: [String: (x: Int, y: Int)], z: String) {
            self.image = image
            self.origin = origin
            self.map = map
            self.z = z
        }
    }

    public let body: WZNode
    public let head: WZNode
    public let face: WZNode?
    public let hair: WZNode?
    /// 장비 (상의·하의·신발·장갑·무기 등). 그릴 동작이 없으면 비슷한 동작으로 대신함.
    public let equips: [WZNode]
    /// 층 이름 → 순위 (작을수록 앞)
    public let zRank: [String: Int]

    public init(body: WZNode, head: WZNode, face: WZNode?, hair: WZNode?, equips: [WZNode], zOrder: [String]) {
        self.body = body
        self.head = head
        self.face = face
        self.hair = hair
        self.equips = equips
        var rank: [String: Int] = [:]
        for (i, name) in zOrder.enumerated() where rank[name] == nil { rank[name] = i }
        zRank = rank
    }

    /// 동작의 프레임 수 (몸 기준)
    public func frameCount(action: String) -> Int {
        var n = 0
        while body.node(at: "\(action)/\(n)") != nil { n += 1 }
        return n
    }

    /// 한 프레임 합성. expression: "default", "smile" 등 (얼굴 표정)
    public func frame(action: String, index: Int, expression: String = "default") -> FrameAnimation.Frame? {
        // 스킬 동작은 다른 동작의 프레임을 가리킴 (action/frame), 시간이 음수면 절댓값
        var drawAction = action, drawIndex = index
        guard let bodyFrame = body.node(at: "\(action)/\(index)") else { return nil }
        if let ref = bodyFrame.children["action"]?.stringValue {
            drawAction = ref
            drawIndex = bodyFrame.children["frame"]?.intValue ?? 0
        }
        let delay = abs(bodyFrame.children["delay"]?.intValue ?? 100)

        var layers: [(WZNode, String)] = [(body, "\(drawAction)/\(drawIndex)"), (head, "\(drawAction)/\(drawIndex)")]
        let showFace = (body.node(at: "\(drawAction)/\(drawIndex)")?.children["face"]?.intValue ?? 1) != 0
        if let face, showFace {
            layers.append((face, expression == "default" ? "default" : "\(expression)/0"))
        }
        if let hair { layers.append((hair, "\(drawAction)/\(drawIndex)")) }
        for item in equips {
            for candidate in Self.fallbackActions(drawAction) where item.node(at: "\(candidate)/\(drawIndex)") != nil
                || item.node(at: "\(candidate)/0") != nil {
                let idx = item.node(at: "\(candidate)/\(drawIndex)") != nil ? drawIndex : 0
                layers.append((item, "\(candidate)/\(idx)"))
                break
            }
        }

        var parts: [Part] = []
        for (root, path) in layers {
            guard let frameNode = root.node(at: path) else { continue }
            // 몸(body)이 맨 처음이어야 결과 기준점이 발밑이 됨
            for name in frameNode.children.keys.sorted(by: { ($0 == "body" ? 0 : 1, $0) < ($1 == "body" ? 0 : 1, $1) }) {
                guard let canvas = root.node(at: "\(path)/\(name)")?.canvas,
                      let image = try? canvas.bitmap() else { continue }
                let origin = canvas.children["origin"]?.vectorValue ?? (0, 0)
                var map: [String: (x: Int, y: Int)] = [:]
                for (k, v) in canvas.children["map"]?.children ?? [:] {
                    if let p = v.vectorValue { map[k] = p }
                }
                let z = canvas.children["z"]?.stringValue ?? name
                parts.append(Part(image: image, origin: origin, map: map, z: z))
            }
        }
        guard let (image, ox, oy) = Self.assemble(parts, zRank: zRank) else { return nil }
        return FrameAnimation.Frame(image: image, originX: ox, originY: oy, delayMs: delay)
    }

    /// 동작 전체를 애니메이션으로
    public func animation(action: String, expression: String = "default") -> FrameAnimation? {
        let frames = (0..<frameCount(action: action)).compactMap { frame(action: action, index: $0, expression: expression) }
        return frames.isEmpty ? nil : FrameAnimation(frames: frames)
    }

    /// 장비에 그 동작이 없을 때 대신 쓸 동작 (한손 동작 → 두손 동작 등)
    static func fallbackActions(_ action: String) -> [String] {
        var list = [action]
        if action.hasPrefix("swingO") { list.append("swingT" + action.dropFirst(6)) }
        if action.hasPrefix("stabO") { list.append("stabT" + action.dropFirst(5)) }
        if action.hasPrefix("swingT") { list.append("swingO" + action.dropFirst(6)) }
        if action == "stand1" { list.append("stand2") }
        if action == "stand2" { list.append("stand1") }
        return list
    }

    /// 조각들을 기준점으로 이어 붙임. 첫 조각(몸)의 origin이 결과의 기준점.
    /// 반환: (그림, 그림 안 기준점 x, y)
    public static func assemble(_ parts: [Part], zRank: [String: Int]) -> (Bitmap, Int, Int)? {
        guard !parts.isEmpty else { return nil }
        var anchors: [String: (x: Int, y: Int)] = [:]
        var placed: [(rank: Int, order: Int, x: Int, y: Int, image: Bitmap)] = []
        var pending = parts
        for pass in 0..<4 {
            var rest: [Part] = []
            for part in pending {
                var pos = (x: 0, y: 0)
                if !anchors.isEmpty || !placed.isEmpty {
                    if let key = part.map.keys.sorted().first(where: { anchors[$0] != nil }) {
                        let a = anchors[key]!, m = part.map[key]!
                        pos = (a.x - m.x, a.y - m.y)
                    } else if !part.map.isEmpty && pass < 3 {
                        rest.append(part)   // 이을 기준점이 아직 없음 → 다음 바퀴
                        continue
                    }
                }
                for (k, m) in part.map where anchors[k] == nil { anchors[k] = (pos.x + m.x, pos.y + m.y) }
                placed.append((zRank[part.z] ?? 0, placed.count, pos.x - part.origin.x, pos.y - part.origin.y, part.image))
            }
            pending = rest
            if pending.isEmpty { break }
        }
        let minX = placed.map(\.x).min()!, minY = placed.map(\.y).min()!
        let maxX = placed.map { $0.x + $0.image.width }.max()!, maxY = placed.map { $0.y + $0.image.height }.max()!
        var out = Bitmap(width: maxX - minX, height: maxY - minY)
        // 뒤 층(순위 큰 것)부터 그림. 같은 층이면 먼저 넣은 것 먼저.
        for p in placed.sorted(by: { $0.rank != $1.rank ? $0.rank > $1.rank : $0.order < $1.order }) {
            out.draw(p.image, x: p.x - minX, y: p.y - minY)
        }
        return (out, -minX, -minY)
    }
}

/// 장비 정보 (Character.wz 장비 .img의 info)
public struct EquipInfo: Codable, Equatable {
    public enum Slot: String, Codable, CaseIterable {
        case cap, coat, longcoat, pants, shoes, glove, shield, weapon
    }

    public let id: String
    public let slot: Slot
    public let reqLevel: Int
    /// 직업 제한 비트 (0 = 모두, 1 = 전사)
    public let reqJob: Int
    public let cash: Bool

    public init(id: String, slot: Slot, reqLevel: Int, reqJob: Int, cash: Bool) {
        self.id = id
        self.slot = slot
        self.reqLevel = reqLevel
        self.reqJob = reqJob
        self.cash = cash
    }

    /// 파일 이름 번호로 부위 판별 (01040009 → 상의)
    public static func slot(forID id: String) -> Slot? {
        guard id.count == 8, id.hasPrefix("01") else { return nil }
        switch id.prefix(4) {
        case "0100": return .cap
        case "0104": return .coat
        case "0105": return .longcoat
        case "0106": return .pants
        case "0107": return .shoes
        case "0108": return .glove
        case "0109": return .shield
        case "0130", "0131", "0132", "0140", "0141", "0142", "0143", "0144", "0145", "0146", "0147": return .weapon
        default: return nil
        }
    }

    public init?(id: String, root: WZNode) {
        guard let slot = Self.slot(forID: id), let info = root["info"] else { return nil }
        self.init(id: id, slot: slot,
                  reqLevel: info["reqLevel"]?.intValue ?? 0,
                  reqJob: info["reqJob"]?.intValue ?? 0,
                  cash: (info["cash"]?.intValue ?? 0) != 0)
    }

    /// 전사가 이 레벨에 입을 장비 고르기: 부위마다 착용 가능한 것 중 레벨이 가장 높은 것.
    /// 무기는 두손검(01402…)만 (히어로 동작에 맞춤). 한벌옷이 상·하의보다 높으면 한벌옷.
    public static func warriorOutfit(from items: [EquipInfo], level: Int) -> [EquipInfo] {
        func usable(_ item: EquipInfo) -> Bool {
            !item.cash && item.reqLevel <= level && (item.reqJob == 0 || item.reqJob & 1 != 0)
        }
        func best(_ slot: Slot, warriorOnly: Bool = true, prefix: String? = nil) -> EquipInfo? {
            items.filter {
                $0.slot == slot && usable($0) && (!warriorOnly || $0.reqJob & 1 != 0)
                    && (prefix.map { p in $0.id.hasPrefix(p) } ?? true)
            }
            .max { ($0.reqLevel, $1.id) < ($1.reqLevel, $0.id) }
        }
        var outfit: [EquipInfo] = []
        let coat = best(.coat), pants = best(.pants), longcoat = best(.longcoat)
        if let longcoat, longcoat.reqLevel > max(coat?.reqLevel ?? -1, pants?.reqLevel ?? -1) {
            outfit.append(longcoat)
        } else {
            if let coat { outfit.append(coat) }
            if let pants { outfit.append(pants) }
        }
        if let shoes = best(.shoes) { outfit.append(shoes) }
        if let glove = best(.glove) { outfit.append(glove) }
        if let weapon = best(.weapon, warriorOnly: false, prefix: "01402") { outfit.append(weapon) }
        return outfit
    }
}
