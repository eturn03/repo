import Foundation

/// 블록이 끝날 때 나오는 몬스터·보스·전직관 (Mob.wz / Npc.wz 파일 번호).
/// 빅뱅 전 레벨대별 사냥터 기준. 블록 하나 = 10레벨이라 10레벨 구간마다 하루 한 번 싸움.
public enum Bestiary {
    public struct Encounter: Equatable {
        /// 이름 (설정 창 미리보기용)
        public let name: String
        /// 그릴 조각들, 뒤에서 앞 순서 (자쿰·혼테일처럼 여러 몬스터 파일로 된 보스). 모두 같은 기준점에 겹침.
        public let mobIDs: [String]
        /// 소리를 찾을 번호 (Sound.wz Mob.img)
        public let soundID: String
        public let isBoss: Bool

        init(_ name: String, _ id: String, boss: Bool = false) {
            self.init(name, [id], sound: id, boss: boss)
        }

        init(_ name: String, _ ids: [String], sound: String, boss: Bool) {
            self.name = name
            mobIDs = ids
            soundID = sound
            isBoss = boss
        }
    }

    static let blueSnail = Encounter("파란 달팽이", "0100101")
    static let slime = Encounter("슬라임", "0210100")
    static let pig = Encounter("돼지", "1210100")
    static let zakum = Encounter("자쿰", ["8800003", "8800004", "8800005", "8800006", "8800007",
                                         "8800008", "8800009", "8800010", "8800000"], sound: "8800000", boss: true)
    static let horntail = Encounter("혼테일", ["8810007", "8810009", "8810008", "8810003", "8810004",
                                            "8810002", "8810005", "8810006"], sound: "8810018", boss: true)
    static let pinkBean = Encounter("핑크빈", "8820001", boss: true)

    /// 첫 블록 (LV 1 → 10)
    static let firstBlock = [blueSnail, slime, pig]

    /// 전직 블록의 보스 (도착 레벨 → 보스). 첫 블록(→10)은 firstBlock.
    static let jobBosses: [Int: Encounter] = [
        30: Encounter("마노", "2220000", boss: true),
        70: Encounter("머쉬맘", "6130101", boss: true),
        120: Encounter("피아누스", "8510000", boss: true),
        200: pinkBean,
    ]

    /// 10레벨 구간(시작 레벨) → 후보 (보스 포함, 무작위로 하나)
    static let brackets: [Int: [Encounter]] = {
        let oblivion = [Encounter("망각의 수호병", "8200011"), Encounter("망각의 수호대장", "8200012"),
                        Encounter("스켈로스", "8190004")]
        return [
            10: [slime, Encounter("주황버섯", "1210102"), Encounter("초록버섯", "1110100")],
            30: [Encounter("와일드보어", "2230102"), Encounter("이블아이", "2230100"), Encounter("레츠", "3210208"),
                 Encounter("스텀피", "3220000", boss: true)],
            40: [Encounter("주니어 페페", "5400000"), Encounter("파이어보어", "3210100"), Encounter("좀비루팡", "4230101")],
            50: [Encounter("헥터", "5130104"), Encounter("스톤골렘", "5130101"), Encounter("믹스골렘", "5150000"),
                 Encounter("쿨리 좀비", "5130107"), Encounter("파우스트", "5220002", boss: true),
                 Encounter("알리샤르", "9300012", boss: true)],
            70: [Encounter("크루", "6130208"), Encounter("호문쿨루", "7110301"), Encounter("사이티", "6110301")],
            80: [Encounter("하프", "8140001"), Encounter("블러드 하프", "8140002"), Encounter("라이칸스로프", "8140000"),
                 Encounter("푸른 켄타우로스", "8140103"), Encounter("주니어 발록", "8130100", boss: true)],
            90: [Encounter("듀얼 파이렛", "7160000"), Encounter("바이킹", "8141000"), Encounter("레드 와이번", "8150300"),
                 Encounter("블루 머쉬맘", "9400205", boss: true)],
            100: [Encounter("블루 와이번", "8150301"), Encounter("샤크", "8150100"), Encounter("콜드샤크", "8150101"),
                  Encounter("그린 코니언", "8150200"), Encounter("크림슨 발록", "8150000", boss: true)],
            120: [Encounter("스켈레곤", "8190003"), Encounter("스켈로스", "8190004"), Encounter("망각의 사제", "8200009"),
                  Encounter("망각의 신관", "8200010"), Encounter("파풀라투스", "8500002", boss: true)],
            130: oblivion,
            140: oblivion + [zakum],
            150: oblivion,
            160: oblivion + [horntail],
            170: oblivion,
            180: oblivion,   // 핑크빈은 200 전직 블록 전용
        ]
    }()

    /// fromLevel → toLevel 로 오르는 블록에서 나올 수 있는 상대들
    public static func candidates(fromLevel: Int, toLevel: Int) -> [Encounter] {
        if fromLevel < JobTitle.levelPerBlock { return firstBlock }
        if let boss = jobBosses[toLevel] { return [boss] }
        return brackets[min(180, fromLevel / 10 * 10)] ?? []
    }

    /// fromLevel → toLevel 로 오르는 블록에서 싸울 상대. roll은 무작위 수 (같은 값이면 같은 결과).
    public static func encounter(fromLevel: Int, toLevel: Int, roll: Int) -> Encounter? {
        let list = candidates(fromLevel: fromLevel, toLevel: toLevel)
        return list.isEmpty ? nil : list[abs(roll) % list.count]
    }

    /// 전직 레벨인지 (10/30/70/120/200)
    public static func isJobLevel(_ level: Int) -> Bool {
        [10, 30, 70, 120, 200].contains(level)
    }

    /// 전직관 NPC (Npc.wz 번호). 200은 원래 전직이 없어서 4차 전직관이 한 번 더.
    public static func jobInstructor(forLevel level: Int) -> String {
        switch level {
        case ..<30: return "1022000"    // 주먹펴고 일어서 (1·2차)
        case ..<70: return "1022000"
        case ..<120: return "2020008"   // 타일러스 (3차)
        default: return "2081100"       // 하르모니아 (4차)
        }
    }

    /// 전직관 말풍선 (나중에 사용자가 바꿀 예정)
    public static func jobLine(forLevel level: Int) -> String {
        switch level {
        case 10: return "1차 전직을 축하하네!"
        case 30: return "2차 전직을 축하하네!"
        case 70: return "3차 전직을 축하하네!"
        case 120: return "4차 전직을 축하하네!"
        default: return "모든 수련을 마쳤군. 축하하네!"
        }
    }

    /// 화면에 띄울 데미지 숫자 (레벨이 오를수록 큼)
    public static func damage(level: Int, roll: Int) -> Int {
        let base = 15 + level * level / 3 + level * 12
        return base + abs(roll) % max(1, base / 4)
    }
}
