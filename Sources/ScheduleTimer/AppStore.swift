import AppKit
import Combine
import ScheduleCore
import WZKit

/// 앱 전체 상태: 일정, 현재 시각, 설정. 1초마다 갱신하고 블록 전환 시 효과음·레벨업.
@MainActor
final class AppStore: ObservableObject {
    @Published private(set) var schedule: Schedule
    @Published private(set) var now = Date()
    @Published var nickname: String {
        didSet { UserDefaults.standard.set(nickname, forKey: Keys.nickname) }
    }
    @Published var barScale: Double {
        didSet { UserDefaults.standard.set(barScale, forKey: Keys.barScale) }
    }
    @Published var showStatusBar: Bool {
        didSet { UserDefaults.standard.set(showStatusBar, forKey: Keys.showStatusBar) }
    }
    /// 상황별 효과음 배정 (SoundEvent.rawValue → "Game/LevelUp" 등, "" = 기본음, "-" = 없음)
    @Published private(set) var soundAssignments: [String: String] {
        didSet { UserDefaults.standard.set(soundAssignments, forKey: Keys.soundAssignments) }
    }
    /// 효과음 볼륨 0...1 (레벨업·블록 시작)
    @Published var effectVolume: Double {
        didSet { UserDefaults.standard.set(effectVolume, forKey: Keys.effectVolume) }
    }
    /// 작은 효과음 볼륨 0...1 (클릭·건너뛰기·저장 등)
    @Published var quietVolume: Double {
        didSet { UserDefaults.standard.set(quietVolume, forKey: Keys.quietVolume) }
    }
    /// Skin 폴더의 StatusBar.img / Game.img에서 읽은 것 (없으면 nil → 코드로 그린 모양·기본음)
    @Published private(set) var skin: StatusBarSkin?
    @Published private(set) var soundBank: SoundBank?
    /// BasicEff.img의 LevelUp 애니메이션 (있으면 코드로 그린 이펙트 대신)
    @Published private(set) var levelUpAnimation: PreparedAnimation?
    /// UIWindow.img의 메신저 창 (있으면 일정 입력을 메이플 창으로)
    @Published private(set) var messengerSkin: MessengerSkin?
    @Published private(set) var skinMessage = ""
    /// 옛 윈도우 굴림·돋움의 12px 비트맵 글자 (있으면 상태바 이름을 원본처럼 각지게)
    @Published private(set) var pixelFont: BitmapFont?
    /// Skin 폴더에 넣은 글꼴들
    @Published private(set) var fontChoices: [FontLoader.Face] = []
    /// 고른 글꼴 (PostScript 이름, "" = 시스템 글꼴, nil = 자동: 돋움 우선)
    @Published var selectedFontName: String? {
        didSet { UserDefaults.standard.set(selectedFontName, forKey: Keys.fontName) }
    }
    /// 실제로 쓸 글꼴 (상태바 이름·일정 입력창). nil이면 시스템 글꼴.
    var customFontName: String? {
        if let selected = selectedFontName {
            return fontChoices.contains { $0.postScriptName == selected } ? selected : nil
        }
        return FontLoader.preferred(in: fontChoices)?.postScriptName
    }
    @Published private(set) var launchAtLogin = LoginItem.isEnabled
    @Published private(set) var loginItemMessage: String?

    /// 레벨업 순간에 호출 (이펙트 창 띄우기)
    var onLevelUp: (() -> Void)?

    static let scaleRange: ClosedRange<Double> = 0.6...3.0

    private enum Keys {
        static let nickname = "nickname"
        static let barScale = "barScale"
        static let showStatusBar = "showStatusBar"
        static let blockStartSound = "blockStartSound"
        static let soundAssignments = "soundAssignments"
        static let effectVolume = "effectVolume"
        static let quietVolume = "quietVolume"
        static let fontName = "fontName"
        static let didSetupLoginItem = "didSetupLoginItem"
    }

    private let storage = Storage()
    private let soundPlayer = SoundPlayer()
    /// BGM 셔플 재생
    let music = MusicPlayer()
    private var timer: Timer?
    private var lastTick = Date()
    private var lastSecond = 0
    private var lastPosition: Position
    private var quietNextTransition = false
    private var activity: NSObjectProtocol?

    init() {
        let defaults = UserDefaults.standard
        nickname = defaults.string(forKey: Keys.nickname) ?? "임진택[무직백수]"
        let savedScale = defaults.double(forKey: Keys.barScale)
        barScale = savedScale > 0 ? savedScale : 1.5
        showStatusBar = defaults.object(forKey: Keys.showStatusBar) as? Bool ?? true
        var assignments = defaults.dictionary(forKey: Keys.soundAssignments) as? [String: String] ?? [:]
        // 예전 버전의 "블록 시작 소리" 설정 옮기기
        if assignments[SoundEvent.blockStart.rawValue] == nil,
           let old = defaults.string(forKey: Keys.blockStartSound), !old.isEmpty {
            assignments[SoundEvent.blockStart.rawValue] = "Game/\(old)"
        }
        soundAssignments = assignments
        effectVolume = defaults.object(forKey: Keys.effectVolume) as? Double ?? 0.5
        quietVolume = defaults.object(forKey: Keys.quietVolume) as? Double ?? 0.2
        selectedFontName = defaults.string(forKey: Keys.fontName)
        schedule = storage.load()
        lastPosition = .empty
        lastPosition = schedule.position(at: Date())

        AppFolder.prepareSkinFolder()
        reloadSkin()
        setupLoginItemOnFirstLaunch()

        // App Nap 때문에 타이머가 늦어지지 않게 함 (잠자기는 막지 않음)
        activity = ProcessInfo.processInfo.beginActivity(
            options: [.userInitiatedAllowingIdleSystemSleep],
            reason: "일정 카운트다운"
        )

        let t = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t

        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.quietNextTransition = true
                self?.tick()
            }
        }
    }

    var snapshot: StatusSnapshot { StatusSnapshot(schedule: schedule, now: now) }
    var position: Position { schedule.position(at: now) }
    var statusLine: String { Format.menuTitle(schedule, now: now, maxChars: 100) }

    /// 상태바 기준 크기 (스킨 유무에 따라 다름)
    var statusBaseSize: CGSize {
        skin != nil
            ? CGSize(width: StatusBarSkin.size.width, height: StatusBarSkin.size.height)
            : StatusBarView.baseSize
    }

    // MARK: - 스킨·효과음

    /// Skin 폴더에서 StatusBar.img, Game.img 다시 읽기
    func reloadSkin() {
        var messages: [String] = []
        if let url = AppFolder.skinFile(named: "StatusBar.img") {
            do {
                var loaded = try StatusBarSkin(statusBar: WZImage.load(contentsOf: url))
                messages.append("상태바: StatusBar.img 사용 중")
                if let basic = AppFolder.skinFile(named: "Basic.img") {
                    let ok = (try? WZImage.load(contentsOf: basic)).map { loaded.loadLevelDigits(basic: $0) } ?? false
                    messages.append(ok ? "LV 숫자: Basic.img 사용 중" : "LV 숫자: Basic.img에서 LevelNo를 못 찾음")
                } else {
                    messages.append("LV 숫자: 기본 글자 (Basic.img 없음)")
                }
                skin = loaded
            } catch {
                skin = nil
                messages.append("상태바: StatusBar.img 읽기 실패 (\(error))")
            }
        } else {
            skin = nil
            messages.append("상태바: 기본 모양 (StatusBar.img 없음)")
        }
        if let url = AppFolder.skinFile(named: "BasicEff.img"),
           let node = (try? WZImage.load(contentsOf: url))?["LevelUp"],
           let animation = FrameAnimation(node: node) {
            levelUpAnimation = PreparedAnimation(animation)
            messages.append("레벨업 이펙트: BasicEff.img (\(animation.frames.count)프레임)")
        } else {
            levelUpAnimation = nil
            messages.append("레벨업 이펙트: 기본 (BasicEff.img 없음)")
        }
        if let url = AppFolder.skinFile(named: "UIWindow.img") {
            do {
                messengerSkin = try MessengerSkin(uiWindow: WZImage.load(contentsOf: url))
                messages.append("일정 입력창: UIWindow.img 메신저 창 사용 중")
            } catch {
                messengerSkin = nil
                messages.append("일정 입력창: UIWindow.img 읽기 실패 (\(error))")
            }
        } else {
            messengerSkin = nil
            messages.append("일정 입력창: 기본 (UIWindow.img 없음)")
        }
        // Sound.wz의 Game.img(게임 효과음), UI.img(클릭 등)
        var bank = SoundBank()
        for (file, prefix) in [("Game.img", "Game"), ("UI.img", "UI")] {
            guard let url = AppFolder.skinFile(named: file) else {
                messages.append("효과음: \(file) 없음")
                continue
            }
            do {
                let before = bank.sounds.count
                bank.add(try WZImage.load(contentsOf: url), prefix: prefix)
                messages.append("효과음: \(file) 소리 \(bank.sounds.count - before)개")
            } catch {
                messages.append("효과음: \(file) 읽기 실패 (\(error))")
            }
        }
        soundBank = bank.sounds.isEmpty ? nil : bank
        fontChoices = FontLoader.registerAll(in: AppFolder.skin)
        messages.append(fontChoices.isEmpty ? "글꼴: 시스템 글꼴 (ttf/otf/ttc 없음)" : "글꼴: \(fontChoices.count)개 불러옴")
        let pixel = PixelFontLoader.load(folder: AppFolder.skin, preferred: selectedFontName)
        pixelFont = pixel?.font
        messages.append(pixel.map { "상태바 글자: \($0.label) 비트맵" } ?? "상태바 글자: 비트맵 글꼴 없음 (부드러운 글꼴 사용)")
        skinMessage = messages.joined(separator: "\n")
    }

    func sound(for event: SoundEvent) -> String {
        soundAssignments[event.rawValue] ?? event.defaultSound
    }

    func setSound(_ sound: String, for event: SoundEvent) {
        soundAssignments[event.rawValue] = sound
    }

    func play(_ event: SoundEvent) {
        let assigned = sound(for: event)
        guard assigned != "-" else { return }
        let custom = event.customFileName.flatMap { SoundPlayer.customFile(named: $0) }
        let data = custom ?? (assigned.isEmpty ? nil : soundBank?.sounds[assigned]?.data)
        soundPlayer.play(
            data: data,
            isRawMP3: custom == nil,
            systemFallback: event.systemFallback,
            volume: event.isQuiet ? quietVolume : effectVolume
        )
    }

    // MARK: - 일정 조작

    /// 입력한 글을 해석해서 저장. 블록이 하나도 없으면 기존 일정 유지.
    @discardableResult
    func saveSchedule(text: String, tomorrow: Bool) -> ParseResult {
        let result = Self.parse(text, tomorrow: tomorrow)
        if result.blocks.isEmpty {
            play(.scheduleFailed)
        } else {
            replaceSchedule(with: result.blocks)
        }
        return result
    }

    static func parse(_ text: String, tomorrow: Bool) -> ParseResult {
        let day = tomorrow ? Calendar.current.date(byAdding: .day, value: 1, to: Date())! : Date()
        return ScheduleParser.parse(text, day: day)
    }

    /// 새 일정으로 교체
    func replaceSchedule(with blocks: [Block]) {
        schedule = Schedule(blocks: blocks)
        // 저장 직후 현재 블록은 레벨업·블록 시작음 없이 표시만
        lastPosition = schedule.position(at: Date())
        persistAndRefresh()
        play(.scheduleSaved)
    }

    func endCurrent(mode: EndMode, status: BlockStatus) {
        schedule.endCurrent(at: Date(), mode: mode, status: status)
        if status == .skipped { play(.skip) }
        persistAndRefresh()
    }

    func extendCurrent(minutes: Int, mode: ExtendMode) {
        schedule.extendCurrent(by: TimeInterval(minutes * 60), at: Date(), mode: mode)
        play(.extend)
        persistAndRefresh()
    }

    func resetToOriginal() {
        schedule.resetToOriginal()
        lastPosition = schedule.position(at: Date())
        play(.reset)
        persistAndRefresh()
    }

    func setLaunchAtLogin(_ on: Bool) {
        do {
            try LoginItem.set(on)
            loginItemMessage = nil
        } catch {
            loginItemMessage = "설정 실패: \(error.localizedDescription)"
        }
        launchAtLogin = LoginItem.isEnabled
        if on && LoginItem.needsApproval {
            loginItemMessage = "시스템 설정 > 일반 > 로그인 항목에서 허용해줘"
        }
    }

    // MARK: - 내부

    private func persistAndRefresh() {
        storage.save(schedule)
        tick()
    }

    private func tick() {
        let t = Date()
        // 타이머는 잠자기 중 멈추므로 간격이 크면 깨어난 것으로 봄
        let wokeUp = t.timeIntervalSince(lastTick) > 10 || quietNextTransition
        lastTick = t
        quietNextTransition = false

        let second = Int(t.timeIntervalSince1970.rounded(.down))
        if second != lastSecond {
            lastSecond = second
            now = t
        }
        checkTransition(at: t, wokeUp: wokeUp)
    }

    private func checkTransition(at t: Date, wokeUp: Bool) {
        let position = schedule.position(at: t)
        guard positionKey(position) != positionKey(lastPosition) else { return }
        let previous = lastPosition
        lastPosition = position
        now = t
        // 잠자기에서 깨어난 경우엔 표시만 바꾸고 조용히
        guard !wokeUp else { return }

        // 직전 블록을 끝까지 했거나 "완료"로 끝냈으면 레벨업 (건너뜀은 제외)
        if case .inBlock(let i) = previous, i < schedule.blocks.count,
           StatusSnapshot.countsAsDone(schedule.blocks[i], now: t) {
            // 마지막 블록이면 "오늘 일정 모두 끝" 소리
            play(position == .finished ? .allDone : .levelUp)
            onLevelUp?()
        } else if case .inBlock = position {
            play(.blockStart)
        }
    }

    private func positionKey(_ position: Position) -> String {
        switch position {
        case .empty: return "empty"
        case .finished: return "finished"
        case .inBlock(let i): return i < schedule.blocks.count ? "block:\(schedule.blocks[i].id)" : "block:?"
        case .gap(let j): return j < schedule.blocks.count ? "gap:\(schedule.blocks[j].id)" : "gap:?"
        }
    }

    private func setupLoginItemOnFirstLaunch() {
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: Keys.didSetupLoginItem) else { return }
        defaults.set(true, forKey: Keys.didSetupLoginItem)
        setLaunchAtLogin(true)
    }
}
