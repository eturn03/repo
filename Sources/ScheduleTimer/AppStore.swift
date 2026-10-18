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
    /// 블록 시작 소리로 쓸 Game.img 안의 소리 이름 (빈 문자열이면 기본음)
    @Published var blockStartSoundName: String {
        didSet { UserDefaults.standard.set(blockStartSoundName, forKey: Keys.blockStartSound) }
    }
    /// Skin 폴더의 StatusBar.img / Game.img에서 읽은 것 (없으면 nil → 코드로 그린 모양·기본음)
    @Published private(set) var skin: StatusBarSkin?
    @Published private(set) var soundBank: SoundBank?
    @Published private(set) var skinMessage = ""
    /// Skin 폴더에 넣은 글꼴 (이름·할 일 글자용). nil이면 시스템 글꼴.
    @Published private(set) var customFontName: String?
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
        static let didSetupLoginItem = "didSetupLoginItem"
    }

    private let storage = Storage()
    private let soundPlayer = SoundPlayer()
    private var timer: Timer?
    private var lastTick = Date()
    private var lastSecond = 0
    private var lastPosition: Position
    private var quietNextTransition = false
    private var activity: NSObjectProtocol?

    init() {
        let defaults = UserDefaults.standard
        nickname = defaults.string(forKey: Keys.nickname) ?? "임진택"
        let savedScale = defaults.double(forKey: Keys.barScale)
        barScale = savedScale > 0 ? savedScale : 1.5
        showStatusBar = defaults.object(forKey: Keys.showStatusBar) as? Bool ?? true
        blockStartSoundName = defaults.string(forKey: Keys.blockStartSound) ?? ""
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
        if let url = AppFolder.skinFile(named: "Game.img") {
            do {
                let bank = SoundBank(gameImage: try WZImage.load(contentsOf: url))
                soundBank = bank
                messages.append("효과음: Game.img 소리 \(bank.names.count)개" + (bank.sounds["LevelUp"] == nil ? " (LevelUp 없음)" : ""))
            } catch {
                soundBank = nil
                messages.append("효과음: Game.img 읽기 실패 (\(error))")
            }
        } else {
            soundBank = nil
            messages.append("효과음: 기본음 (Game.img 없음)")
        }
        customFontName = FontLoader.registerFirstFont(in: AppFolder.skin)
        messages.append(customFontName.map { "글꼴: \($0)" } ?? "글꼴: 시스템 글꼴 (ttf/otf/ttc 없음)")
        skinMessage = messages.joined(separator: "\n")
    }

    func play(_ effect: SoundEffect) {
        let name: String?
        switch effect {
        case .levelUp: name = "LevelUp"
        case .blockStart: name = blockStartSoundName.isEmpty ? nil : blockStartSoundName
        }
        soundPlayer.play(effect, bank: soundBank, bankName: name)
    }

    // MARK: - 일정 조작

    /// 새 일정으로 교체
    func replaceSchedule(with blocks: [Block]) {
        schedule = Schedule(blocks: blocks)
        // 저장 직후 현재 블록은 효과음 없이 표시만
        lastPosition = schedule.position(at: Date())
        persistAndRefresh()
    }

    func endCurrent(mode: EndMode, status: BlockStatus) {
        schedule.endCurrent(at: Date(), mode: mode, status: status)
        persistAndRefresh()
    }

    func extendCurrent(minutes: Int, mode: ExtendMode) {
        schedule.extendCurrent(by: TimeInterval(minutes * 60), at: Date(), mode: mode)
        persistAndRefresh()
    }

    func resetToOriginal() {
        schedule.resetToOriginal()
        lastPosition = schedule.position(at: Date())
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
            play(.levelUp)
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
