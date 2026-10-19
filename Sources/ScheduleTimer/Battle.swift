import AppKit
import ScheduleCore
import SwiftUI
import WZKit

/// 블록이 끝날 때의 레벨업 정보
struct LevelUpEvent {
    let fromLevel: Int
    let toLevel: Int
    let jobChanged: Bool
    /// 이 레벨업을 만든 블록 (미리보기면 nil)
    let blockID: UUID?
    /// 몬스터·스킬·데미지 고르기용 무작위 수
    let roll: Int
}

/// 블록 끝 장면에 쓰는 게임 파일 (Skin/Character·Mob·Npc·Skill 폴더, SoundMob/SoundSkill.img).
/// 파일이 커서 백그라운드에서 읽고, 최근에 읽은 것은 보관.
final class GameAssets: @unchecked Sendable {
    private let lock = NSLock()
    private var cache: [URL: WZNode] = [:]
    private var cacheOrder: [URL] = []
    private var equipIndex: [EquipInfo]?
    private static let cacheLimit = 24

    /// 캐릭터 장면을 만들 수 있는지 (몸·머리·zmap 파일이 있는지)
    var hasCharacter: Bool {
        let fm = FileManager.default
        return fm.fileExists(atPath: AppFolder.character.appendingPathComponent("00002000.img").path)
            && fm.fileExists(atPath: AppFolder.character.appendingPathComponent("00012000.img").path)
            && AppFolder.skinFile(named: "zmap.img") != nil
    }

    /// 설정 창에 보여줄 상태
    func summary() -> String {
        let fm = FileManager.default
        func count(_ folder: URL) -> Int {
            ((try? fm.contentsOfDirectory(atPath: folder.path)) ?? []).filter { $0.lowercased().hasSuffix(".img") }.count
        }
        var lines: [String] = []
        lines.append(hasCharacter ? "캐릭터: 있음 (장비 파일 \(count(AppFolder.character))개)"
                                  : "캐릭터: 없음 — Character의 00002000.img, 00012000.img와 Base의 zmap.img 필요")
        lines.append("몬스터 \(count(AppFolder.mob))개 · NPC \(count(AppFolder.npc))개 · 스킬 \(count(AppFolder.skill))개")
        let sounds = ["SoundMob.img", "SoundSkill.img"].filter { AppFolder.skinFile(named: $0) != nil }
        lines.append(sounds.isEmpty ? "몬스터·스킬 소리: 없음" : "소리: " + sounds.joined(separator: ", "))
        return lines.joined(separator: "\n")
    }

    func root(_ url: URL?) -> WZNode? {
        guard let url else { return nil }
        lock.lock()
        if let hit = cache[url] {
            lock.unlock()
            return hit
        }
        lock.unlock()
        guard let loaded = try? WZImage.load(contentsOf: url) else { return nil }
        lock.lock()
        cache[url] = loaded
        cacheOrder.append(url)
        while cacheOrder.count > Self.cacheLimit { cache[cacheOrder.removeFirst()] = nil }
        lock.unlock()
        return loaded
    }

    func file(_ folder: URL, _ id: String) -> URL? {
        let url = folder.appendingPathComponent("\(id).img")
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    func mob(_ id: String) -> WZNode? { root(file(AppFolder.mob, id)) }
    func npc(_ id: String) -> WZNode? { root(file(AppFolder.npc, id)) }
    func skill(_ job: String) -> WZNode? { root(file(AppFolder.skill, job)) }
    func skinRoot(_ name: String) -> WZNode? { root(AppFolder.skinFile(named: name)) }

    func mobSound(_ id: String, _ kind: String) -> Data? {
        skinRoot("SoundMob.img")?.node(at: "\(id)/\(kind)")?.sound?.data
    }

    func skillSound(_ id: String, _ kind: String) -> Data? {
        skinRoot("SoundSkill.img")?.node(at: "\(id)/\(kind)")?.sound?.data
    }

    // MARK: - 캐릭터

    /// 얼굴·헤어: 설정에 저장한 번호, 없으면 가장 작은 번호
    private func lookFile(prefix: String, key: String) -> URL? {
        if let id = UserDefaults.standard.string(forKey: key), let url = file(AppFolder.character, id) { return url }
        let files = (try? FileManager.default.contentsOfDirectory(atPath: AppFolder.character.path)) ?? []
        return files.filter { $0.hasPrefix(prefix) && $0.hasSuffix(".img") }.sorted().first
            .map { AppFolder.character.appendingPathComponent($0) }
    }

    /// 이 레벨의 전사 캐릭터 (장비 자동). 파일이 없으면 nil.
    func character(level: Int) -> CharacterRenderer? {
        guard hasCharacter,
              let body = root(file(AppFolder.character, "00002000")),
              let head = root(file(AppFolder.character, "00012000")),
              let zmap = AppFolder.skinFile(named: "zmap.img"),
              let zOrder = try? WZImage.rootNames([UInt8](Data(contentsOf: zmap)))
        else { return nil }
        let outfit = EquipInfo.warriorOutfit(from: equipment(), level: level)
        let equips = outfit.compactMap { root(file(AppFolder.character, $0.id)) }
        return CharacterRenderer(body: body, head: head,
                                 face: root(lookFile(prefix: "0002", key: "characterFace")),
                                 hair: root(lookFile(prefix: "0003", key: "characterHair")),
                                 equips: equips, zOrder: zOrder)
    }

    /// Character 폴더의 장비 목록 (처음 한 번 읽고 파일 크기·날짜가 같으면 저장해둔 것 재사용)
    func equipment() -> [EquipInfo] {
        lock.lock()
        if let equipIndex {
            lock.unlock()
            return equipIndex
        }
        lock.unlock()

        typealias Cached = EquipIndexEntry
        let indexURL = AppFolder.root.appendingPathComponent("equipIndex.json")
        var saved = (try? JSONDecoder().decode([String: Cached].self, from: Data(contentsOf: indexURL))) ?? [:]
        let fm = FileManager.default
        let names = ((try? fm.contentsOfDirectory(atPath: AppFolder.character.path)) ?? []).filter { $0.hasSuffix(".img") }
        var result: [EquipInfo] = []
        var fresh: [String: Cached] = [:]
        for name in names {
            let id = String(name.dropLast(4))
            // 히어로가 입을 부위만 (모자·방패·한손무기 등은 안 읽음)
            guard let slot = EquipInfo.slot(forID: id), [.coat, .longcoat, .pants, .shoes, .glove].contains(slot)
                    || id.hasPrefix("01402") else { continue }
            let url = AppFolder.character.appendingPathComponent(name)
            let attrs = try? fm.attributesOfItem(atPath: url.path)
            let size = (attrs?[.size] as? NSNumber)?.intValue ?? 0
            let modified = (attrs?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
            let entry: Cached
            if let old = saved[name], old.size == size, old.modified == modified {
                entry = old
            } else {
                entry = Cached(size: size, modified: modified,
                               info: (try? WZImage.load(contentsOf: url)).flatMap { EquipInfo(id: id, root: $0) })
            }
            fresh[name] = entry
            if let info = entry.info { result.append(info) }
        }
        saved = fresh
        if let data = try? JSONEncoder().encode(saved) { try? data.write(to: indexURL, options: .atomic) }
        lock.lock()
        equipIndex = result
        lock.unlock()
        return result
    }

    /// 파일을 새로 가져왔을 때 다시 읽게
    func invalidate() {
        lock.lock()
        cache = [:]
        cacheOrder = []
        equipIndex = nil
        lock.unlock()
    }
}

/// 장비 목록 저장용 (파일 크기·날짜가 같으면 다시 안 읽음)
private struct EquipIndexEntry: Codable {
    let size: Int
    let modified: Double
    let info: EquipInfo?
}

/// 히어로 계열 스킬 (Skill.wz 번호와 그림 경로)
struct SkillMove {
    let job: String
    let id: String
    /// 캐릭터 동작 (몸 파일의 동작 이름)
    let action: String
    /// 캐릭터 쪽 이펙트 경로 (skill/번호/ 아래)
    let effect: String?
    /// 몬스터 쪽 맞는 이펙트 경로
    let hit: String?

    static let powerStrike = SkillMove(job: "100", id: "1001004", action: "swingT1", effect: "effect", hit: "hit/0")
    static let slashBlast = SkillMove(job: "100", id: "1001005", action: "swingT3", effect: "effect", hit: "hit/0")
    static let rage = SkillMove(job: "110", id: "1101006", action: "alert2", effect: "effect", hit: nil)
    static let coma = SkillMove(job: "111", id: "1111005", action: "swingT3", effect: "finish/5", hit: "hit/0")
    static let panic = SkillMove(job: "111", id: "1111003", action: "swingT1", effect: "finish/5", hit: "hit/0")
    static let shout = SkillMove(job: "111", id: "1111008", action: "alert3", effect: "effect", hit: "hit/0")
    static let brandish = SkillMove(job: "112", id: "1121008", action: "brandish1", effect: "effect/0", hit: "hit/0")

    /// 레벨에 맞는 (버프, 공격). 1~9는 스킬 없이 그냥 베기 (nil).
    static func moves(level: Int, roll: Int) -> (buff: SkillMove?, attack: SkillMove?) {
        func pick(_ list: [SkillMove]) -> SkillMove { list[abs(roll) % list.count] }
        switch level {
        case ..<10: return (nil, nil)
        case ..<30: return (nil, pick([powerStrike, slashBlast]))
        case ..<70: return (rage, pick([powerStrike, slashBlast]))   // 2차 파이터는 공격 스킬이 없어서 분노 + 1차 스킬
        case ..<120: return (nil, pick([coma, panic, shout]))
        default: return (nil, brandish)
        }
    }
}

/// 장면의 한 층: 애니메이션을 어디에, 언제부터 언제까지
struct SceneLayer: Identifiable {
    let id = UUID()
    let anim: PreparedAnimation
    /// 기준점(발밑) 위치, 장면 좌표 (확대 전 픽셀)
    let x: CGFloat
    let y: CGFloat
    var scale: CGFloat = 1
    let start: Double
    var end: Double?
    var loop = false
    /// 다 재생한 뒤 마지막 프레임 유지
    var hold = false
    /// 이 시각부터 end까지 서서히 사라짐
    var fadeOutFrom: Double?
    /// start에서 end까지 위로 떠오르는 거리
    var rise: CGFloat = 0

    /// t초에 그릴 프레임 번호, 불투명도, 위로 뜬 거리 (안 보이면 nil)
    func state(at t: Double) -> (index: Int, alpha: Double, dy: CGFloat)? {
        guard t >= start, end.map({ t < $0 }) ?? true else { return nil }
        let local = t - start
        let a = self.anim.animation
        let ms = Int(local * 1000)
        var index: Int?
        if loop, a.durationMs > 0 {
            index = a.frameIndex(atMs: ms % a.durationMs)
        } else {
            index = a.frameIndex(atMs: ms) ?? (hold ? a.frames.count - 1 : nil)
        }
        guard let index else { return nil }
        var alpha = 1.0
        if let from = fadeOutFrom, let end, t > from, end > from { alpha = max(0, (end - t) / (end - from)) }
        var dy: CGFloat = 0
        if rise != 0, let end, end > start { dy = rise * CGFloat(min(1, local / (end - start))) }
        return (index, alpha, dy)
    }
}

/// 블록 끝 장면 (캐릭터가 스킬로 몬스터를 잡고 레벨업, 전직이면 전직관 등장)
struct BattleScene {
    static let size = CGSize(width: 420, height: 210)
    static let ground: CGFloat = 195
    static let mobX: CGFloat = 300

    let layers: [SceneLayer]
    let duration: Double
    /// 레벨업 순간 (장면 시작 후 초)
    let climax: Double
    let sounds: [(at: Double, data: Data)]
}

enum BattleSceneBuilder {
    /// 장면 만들기 (무거워서 백그라운드에서). 캐릭터 파일이 없으면 nil.
    static func build(event: LevelUpEvent, assets: GameAssets, levelUp: FrameAnimation?, jobChange: FrameAnimation?,
                      font: BitmapFont?, fontName: String?) -> BattleScene? {
        guard let renderer = assets.character(level: event.fromLevel) else { return nil }
        let twoHanded = renderer.equips.contains { $0.node(at: "stand2/0") != nil && $0.node(at: "stand1/0") == nil }
        let standAction = twoHanded ? "stand2" : "stand1"
        func prepared(_ a: FrameAnimation?, flip: Bool = false) -> PreparedAnimation? {
            a.flatMap { PreparedAnimation(flip ? $0.flipped() : $0) }
        }
        guard let stand = prepared(renderer.animation(action: standAction), flip: true) else { return nil }
        let smile = prepared(renderer.animation(action: standAction, expression: "smile"), flip: true) ?? stand

        let (buff, attack) = SkillMove.moves(level: event.fromLevel, roll: event.roll)
        let attackAction = attack?.action ?? (twoHanded ? "swingT1" : "swingO1")
        let attackAnim = prepared(renderer.animation(action: attackAction), flip: true)
            ?? prepared(renderer.animation(action: twoHanded ? "swingT1" : "swingO1"), flip: true)
        let buffAnim = buff.flatMap { b in prepared(renderer.animation(action: b.action), flip: true) }
        func skillAnim(_ move: SkillMove?, _ path: String?) -> PreparedAnimation? {
            guard let move, let path, let root = assets.skill(move.job) else { return nil }
            return prepared(FrameAnimation(root: root, path: "skill/\(move.id)/\(path)"), flip: true)
        }

        let jobBlock = event.jobChanged || Bestiary.isJobLevel(event.toLevel)
        let climax = 3.0
        let duration = jobBlock ? 5.6 : 5.0
        let mx = BattleScene.mobX, ground = BattleScene.ground

        var layers: [SceneLayer] = []
        var sounds: [(at: Double, data: Data)] = []

        // 시간표
        let tBuff = 0.3
        let tAttack = buff != nil ? 1.0 : 0.6
        let attackDur = min(1.4, Double(attackAnim?.animation.durationMs ?? 600) / 1000)
        let tHit = tAttack + min(0.4, attackDur * 0.5)
        let tDie = tHit + 0.45

        // 몬스터
        let encounter = Bestiary.encounter(fromLevel: event.fromLevel, toLevel: event.toLevel, roll: event.roll)
        var mobLayersStand: [(PreparedAnimation, PreparedAnimation?, PreparedAnimation?)] = []
        for id in encounter?.mobIDs ?? [] {
            guard let root = assets.mob(id) else { continue }
            guard let standAnim = prepared(FrameAnimation(root: root, path: "stand"))
                    ?? prepared(FrameAnimation(root: root, path: "move")) else { continue }
            mobLayersStand.append((standAnim, prepared(FrameAnimation(root: root, path: "hit1")),
                                   prepared(FrameAnimation(root: root, path: "die1"))))
        }
        var mobScale: CGFloat = 1
        var mobHeight: CGFloat = 60
        var mobLeft = mx - 20   // 몬스터 왼쪽 끝
        if !mobLayersStand.isEmpty {
            let bounds = mobLayersStand.map { $0.0.animation.bounds }
            let w = CGFloat((bounds.map { $0.maxX }.max() ?? 0) - (bounds.map { $0.minX }.min() ?? 0))
            let h = CGFloat((bounds.map { $0.maxY }.max() ?? 0) - (bounds.map { $0.minY }.min() ?? 0))
            mobScale = min(1, 150 / max(1, h), 200 / max(1, w))
            mobHeight = h * mobScale
            mobLeft = mx + CGFloat(bounds.map { $0.minX }.min() ?? 0) * mobScale
        }
        // 캐릭터는 몬스터 바로 앞에 (몬스터 크기와 상관없이 왼쪽 끝에서 45px, 게임에서 붙어서 때리는 거리)
        let attackEffect = skillAnim(attack, attack?.effect)
        let cx = max(40, mobLeft - 45)
        // 전직 블록은 몬스터가 다 사라진 뒤 전직관이 나오도록 조금 빨리 사라짐
        let dieEnd = jobBlock ? min(tDie + 1.0, climax - 0.6) : tDie + 1.3
        for (standAnim, hitAnim, dieAnim) in mobLayersStand {
            let s = mobScale
            layers.append(SceneLayer(anim: standAnim, x: mx, y: ground, scale: s, start: 0, end: tHit, loop: true))
            layers.append(SceneLayer(anim: hitAnim ?? standAnim, x: mx, y: ground, scale: s, start: tHit, end: tDie, hold: true))
            layers.append(SceneLayer(anim: dieAnim ?? hitAnim ?? standAnim, x: mx, y: ground, scale: s,
                                     start: tDie, end: dieEnd, hold: true, fadeOutFrom: dieEnd - 0.5))
        }
        if let encounter, !mobLayersStand.isEmpty {
            if let d = assets.mobSound(encounter.soundID, "Damage") { sounds.append((at: tHit, data: d)) }
            if let d = assets.mobSound(encounter.soundID, "Die") { sounds.append((at: tDie, data: d)) }
        }

        // 캐릭터
        let attackEnd = tAttack + attackDur
        if let buffAnim, let buff {
            let buffEnd = tBuff + Double(buffAnim.animation.durationMs) / 1000
            layers.append(SceneLayer(anim: stand, x: cx, y: ground, start: 0, end: tBuff, loop: true))
            layers.append(SceneLayer(anim: buffAnim, x: cx, y: ground, start: tBuff, end: min(buffEnd, tAttack), hold: true))
            if buffEnd < tAttack {
                layers.append(SceneLayer(anim: stand, x: cx, y: ground, start: buffEnd, end: tAttack, loop: true))
            }
            if let e = skillAnim(buff, buff.effect) {
                layers.append(SceneLayer(anim: e, x: cx, y: ground, start: tBuff,
                                         end: tBuff + Double(e.animation.durationMs) / 1000))
            }
            if let d = assets.skillSound(buff.id, "Use") { sounds.append((at: tBuff, data: d)) }
        } else {
            layers.append(SceneLayer(anim: stand, x: cx, y: ground, start: 0, end: tAttack, loop: true))
        }
        if let attackAnim {
            layers.append(SceneLayer(anim: attackAnim, x: cx, y: ground, start: tAttack, end: attackEnd, hold: true))
        }
        layers.append(SceneLayer(anim: stand, x: cx, y: ground, start: attackEnd, end: climax, loop: true))
        layers.append(SceneLayer(anim: smile, x: cx, y: ground, start: climax, end: duration, loop: true))
        if let attack {
            if let e = attackEffect {
                layers.append(SceneLayer(anim: e, x: cx, y: ground, start: tAttack,
                                         end: tAttack + Double(e.animation.durationMs) / 1000))
            }
            if let d = assets.skillSound(attack.id, "Use") { sounds.append((at: tAttack, data: d)) }
            if let d = assets.skillSound(attack.id, "Hit") { sounds.append((at: tHit, data: d)) }
        }

        // 몬스터 쪽: 맞는 이펙트, 데미지 숫자
        if !mobLayersStand.isEmpty {
            let hitY = ground - mobHeight / 2
            if let h = skillAnim(attack, attack?.hit) {
                layers.append(SceneLayer(anim: h, x: mx, y: hitY, start: tHit,
                                         end: tHit + Double(h.animation.durationMs) / 1000))
            }
            if let digits = assets.skinRoot("BasicEff.img")?.node(at: "NoRed1"),
               let number = damageNumber(Bestiary.damage(level: event.fromLevel, roll: event.roll), digits: digits) {
                layers.append(SceneLayer(anim: number, x: mx, y: ground - mobHeight - 4, start: tHit, end: tHit + 1.2,
                                         fadeOutFrom: tHit + 0.8, rise: 28))
            }
        }

        // 전직: 몬스터가 사라진 자리에 전직관 + 말풍선
        if jobBlock, let npcRoot = assets.npc(Bestiary.jobInstructor(forLevel: event.toLevel)),
           let npc = prepared(FrameAnimation(root: npcRoot, path: "stand")) {
            let tNpc = dieEnd - 0.1
            layers.append(SceneLayer(anim: npc, x: mx, y: ground, start: tNpc, end: duration, loop: true))
            let npcTop = CGFloat(-npc.animation.bounds.minY)
            if let balloon = balloon(Bestiary.jobLine(forLevel: event.toLevel), assets: assets, font: font, fontName: fontName) {
                layers.append(SceneLayer(anim: balloon, x: mx, y: ground - npcTop - 2, start: tNpc + 0.3, end: duration - 0.3))
            }
        }

        // 레벨업 순간: 캐릭터 발밑에서 레벨업(+전직) 이펙트
        if let levelUp = prepared(levelUp) {
            layers.append(SceneLayer(anim: levelUp, x: cx, y: ground, start: climax))
        }
        if event.jobChanged, let job = prepared(jobChange) {
            layers.append(SceneLayer(anim: job, x: cx, y: ground, start: climax))
        }
        return BattleScene(layers: layers, duration: duration, climax: climax, sounds: sounds)
    }

    /// 데미지 숫자 (BasicEff.img NoRed1의 0~9를 겹쳐서 이어 붙임). 기준점은 아래 가운데.
    static func damageNumber(_ value: Int, digits: WZNode) -> PreparedAnimation? {
        var glyphs: [(Bitmap, Int)] = []   // 그림, 기준점 x
        for ch in String(value) {
            guard let canvas = digits.node(at: String(ch))?.canvas, let b = try? canvas.bitmap() else { return nil }
            glyphs.append((b, canvas.children["origin"]?.vectorValue?.x ?? b.width / 2))
        }
        guard !glyphs.isEmpty else { return nil }
        let advance = { (b: Bitmap) in max(1, b.width * 3 / 5) }
        let width = glyphs.dropLast().map { advance($0.0) }.reduce(0, +) + (glyphs.last?.0.width ?? 0)
        let height = glyphs.map { $0.0.height }.max() ?? 0
        var out = Bitmap(width: width, height: height)
        var x = 0
        for (b, _) in glyphs {
            out.draw(b, x: x, y: height - b.height)
            x += advance(b)
        }
        return PreparedAnimation(FrameAnimation(frames: [.init(image: out, originX: width / 2, originY: height, delayMs: 1000)]))
    }

    /// 말풍선 (UI.wz ChatBalloon.img 0번 모양 + 글자). 기준점은 꼬리 끝.
    static func balloon(_ text: String, assets: GameAssets, font: BitmapFont?, fontName: String?) -> PreparedAnimation? {
        let textBitmap = font?.render(text, maxWidth: 220, color: { _ in (0, 0, 0) })
            ?? PixelText.render(text, fontName: fontName, color: (0, 0, 0), maxWidth: 220)
        guard let style = assets.skinRoot("ChatBalloon.img")?["0"] else {
            // 그림이 없으면 흰 상자
            var out = Bitmap(width: textBitmap.width + 12, height: textBitmap.height + 10)
            out.fill(x: 0, y: 0, w: out.width, h: out.height, r: 255, g: 255, b: 255)
            out.draw(textBitmap, x: 6, y: 5)
            return PreparedAnimation(FrameAnimation(frames: [.init(image: out, originX: out.width / 2,
                                                                   originY: out.height + 2, delayMs: 1000)]))
        }
        func piece(_ name: String) -> Bitmap? { style[name]?.canvas.flatMap { try? $0.bitmap() } }
        guard let nw = piece("nw"), let ne = piece("ne"), let sw = piece("sw"), let se = piece("se"),
              let n = piece("n"), let s = piece("s"), let w = piece("w"), let e = piece("e"), let c = piece("c")
        else { return nil }
        let arrow = piece("arrow")
        let innerW = max(textBitmap.width + 4, n.width), innerH = max(textBitmap.height + 2, w.height)
        let width = nw.width + innerW + ne.width
        let bodyH = nw.height + innerH + sw.height
        let height = bodyH + (arrow.map { max(0, $0.height - sw.height / 2) } ?? 0)
        var out = Bitmap(width: width, height: height)
        // 가운데·가장자리는 타일처럼 반복
        func tile(_ b: Bitmap, x: Int, y: Int, w tw: Int, h th: Int) {
            var yy = 0
            while yy < th {
                var xx = 0
                while xx < tw {
                    out.draw(b, x: x + xx, y: y + yy, sx: 0, sy: 0, w: min(b.width, tw - xx), h: min(b.height, th - yy))
                    xx += max(1, b.width)
                }
                yy += max(1, b.height)
            }
        }
        tile(c, x: nw.width, y: nw.height, w: innerW, h: innerH)
        tile(n, x: nw.width, y: 0, w: innerW, h: n.height)
        tile(s, x: sw.width, y: nw.height + innerH, w: innerW, h: s.height)
        tile(w, x: 0, y: nw.height, w: w.width, h: innerH)
        tile(e, x: nw.width + innerW, y: nw.height, w: e.width, h: innerH)
        out.draw(nw, x: 0, y: 0)
        out.draw(ne, x: nw.width + innerW, y: 0)
        out.draw(sw, x: 0, y: nw.height + innerH)
        out.draw(se, x: nw.width + innerW, y: nw.height + innerH)
        if let arrow { out.draw(arrow, x: width / 2 - arrow.width / 2, y: bodyH - sw.height / 2) }
        out.draw(textBitmap, x: nw.width + (innerW - textBitmap.width) / 2, y: nw.height + (innerH - textBitmap.height) / 2)
        return PreparedAnimation(FrameAnimation(frames: [.init(image: out, originX: width / 2, originY: height, delayMs: 1000)]))
    }
}

/// 장면 그리기
struct BattleSceneView: View {
    let scene: BattleScene
    let scale: CGFloat
    let startDate: Date

    var body: some View {
        TimelineView(.animation) { context in
            let t = context.date.timeIntervalSince(startDate)
            ZStack(alignment: .topLeading) {
                ForEach(scene.layers) { layer in
                    layerView(layer, t: t)
                }
            }
            .frame(width: BattleScene.size.width * scale, height: BattleScene.size.height * scale, alignment: .topLeading)
            .opacity(fade(t))
        }
    }

    /// 처음 0.3초 나타나고 마지막 0.4초 사라짐
    private func fade(_ t: Double) -> Double {
        if t < 0.3 { return max(0, t / 0.3) }
        if t > scene.duration - 0.4 { return max(0, (scene.duration - t) / 0.4) }
        return 1
    }

    @ViewBuilder
    private func layerView(_ layer: SceneLayer, t: Double) -> some View {
        if let state = layer.state(at: t) {
            let frame = layer.anim.animation.frames[state.index]
            let s = scale * layer.scale
            Image(decorative: layer.anim.images[state.index], scale: 1)
                .interpolation(layer.scale < 1 ? .high : .none)
                .resizable()
                .frame(width: CGFloat(frame.image.width) * s, height: CGFloat(frame.image.height) * s)
                .offset(x: layer.x * scale - CGFloat(frame.originX) * s,
                        y: (layer.y - state.dy) * scale - CGFloat(frame.originY) * s)
                .opacity(state.alpha)
        }
    }
}

/// 포기했을 때 상태바 위에 떨어지는 묘비 (Effect.wz Tomb.img: fall → land)
struct TombView: View {
    let fall: PreparedAnimation?
    let land: PreparedAnimation
    let scale: CGFloat
    /// nil이면 이미 떨어진 상태로
    let startDate: Date?
    static let size = CGSize(width: 80, height: 120)

    var body: some View {
        TimelineView(.animation) { context in
            let ms = startDate.map { Int(context.date.timeIntervalSince($0) * 1000) } ?? Int.max
            let (anim, index): (PreparedAnimation, Int) = {
                if let fall, let i = fall.animation.frameIndex(atMs: ms) { return (fall, i) }
                let landMs = ms == Int.max ? 0 : ms - (fall?.animation.durationMs ?? 0)
                return (land, land.animation.frameIndex(atMs: landMs) ?? land.animation.frames.count - 1)
            }()
            let frame = anim.animation.frames[index]
            ZStack(alignment: .topLeading) {
                Image(decorative: anim.images[index], scale: 1)
                    .interpolation(.none)
                    .resizable()
                    .frame(width: CGFloat(frame.image.width) * scale, height: CGFloat(frame.image.height) * scale)
                    .offset(x: (Self.size.width / 2 - CGFloat(frame.originX)) * scale,
                            y: (Self.size.height - CGFloat(frame.originY)) * scale)
            }
            .frame(width: Self.size.width * scale, height: Self.size.height * scale, alignment: .topLeading)
        }
    }
}
