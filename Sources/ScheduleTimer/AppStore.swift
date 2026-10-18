import AppKit
import Combine
import ScheduleCore

/// 앱 전체 상태: 일정, 현재 시각, 설정. 1초마다 갱신하고 블록 전환 시 소리·알림.
@MainActor
final class AppStore: ObservableObject {
    @Published private(set) var schedule: Schedule
    @Published private(set) var now = Date()
    @Published var maxTitleChars: Int {
        didSet { UserDefaults.standard.set(maxTitleChars, forKey: Keys.maxTitleChars) }
    }
    @Published private(set) var launchAtLogin = LoginItem.isEnabled
    @Published private(set) var loginItemMessage: String?

    private enum Keys {
        static let maxTitleChars = "maxTitleChars"
        static let didSetupLoginItem = "didSetupLoginItem"
    }

    private let storage = Storage()
    private let notifier = Notifier()
    private var timer: Timer?
    private var lastTick = Date()
    private var lastSecond = 0
    private var lastPositionKey: String
    private var quietNextTransition = false
    private var activity: NSObjectProtocol?

    init() {
        let saved = UserDefaults.standard.integer(forKey: Keys.maxTitleChars)
        maxTitleChars = saved > 0 ? saved : 6
        schedule = storage.load()
        lastPositionKey = ""
        lastPositionKey = positionKey(at: Date())

        notifier.requestPermission()
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

    var menuTitle: String {
        Format.menuTitle(schedule, now: now, maxChars: maxTitleChars)
    }

    var position: Position { schedule.position(at: now) }

    // MARK: - 일정 조작

    /// 새 일정으로 교체
    func replaceSchedule(with blocks: [Block]) {
        schedule = Schedule(blocks: blocks)
        // 저장 직후 현재 블록은 알림 없이 표시만
        lastPositionKey = positionKey(at: Date())
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
        let key = positionKey(at: t)
        guard key != lastPositionKey else { return }
        lastPositionKey = key
        now = t
        // 블록이 시작될 때만 알림. 빈 시간 시작은 조용히.
        guard case .inBlock(let i) = schedule.position(at: t) else { return }
        let block = schedule.blocks[i]
        if !wokeUp { Chime.play() }
        notifier.post(
            title: "지금 할 일: \(block.title)",
            body: Format.range(block.start, block.end)
        )
    }

    private func positionKey(at t: Date) -> String {
        switch schedule.position(at: t) {
        case .empty: return "empty"
        case .finished: return "finished"
        case .inBlock(let i): return "block:\(schedule.blocks[i].id)"
        case .gap(let j): return "gap:\(schedule.blocks[j].id)"
        }
    }

    private func setupLoginItemOnFirstLaunch() {
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: Keys.didSetupLoginItem) else { return }
        defaults.set(true, forKey: Keys.didSetupLoginItem)
        setLaunchAtLogin(true)
    }
}

/// 짧은 효과음 (시스템 볼륨 기준 50%)
enum Chime {
    private static let sound: NSSound? = {
        let s = NSSound(named: NSSound.Name("Glass"))
        s?.volume = 0.5
        return s
    }()

    static func play() {
        sound?.stop()
        sound?.play()
    }
}
