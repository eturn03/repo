import AppKit
import Combine
import ScheduleCore
import SwiftUI
import WZKit

/// 테두리 없이 항상 위에 떠 있는 창
final class FloatingPanel: NSPanel {
    init(size: CGSize, clickThrough: Bool) {
        super.init(
            contentRect: CGRect(origin: .zero, size: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        isOpaque = false
        backgroundColor = .clear
        hasShadow = !clickThrough
        ignoresMouseEvents = clickThrough
        isReleasedWhenClosed = false
        hidesOnDeactivate = false
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

/// 상태바 창 (끌어서 이동, 크기 조절, 위치 기억), 레벨업 이펙트 창, 설정 창 관리
@MainActor
final class WindowManager {
    private let store: AppStore
    private let statusPanel: FloatingPanel
    private var settingsWindow: NSWindow?
    private var inputWindow: NSWindow?
    private var inputDragStart: (mouse: NSPoint, origin: NSPoint)?
    private var effectPanels: [FloatingPanel] = []
    private var effectID: UUID?
    private var dragStart: (mouse: NSPoint, origin: NSPoint)?
    private var cancellables = Set<AnyCancellable>()
    /// 블록 끝 사냥 장면
    private var battlePanel: FloatingPanel?
    private var battleID: UUID?
    private var battleBlockID: UUID?
    private var battleWork: [DispatchWorkItem] = []
    /// 포기했을 때 묘비
    private var tombPanel: FloatingPanel?

    private static let originKey = "statusBarOrigin"

    init(store: AppStore) {
        self.store = store
        statusPanel = FloatingPanel(size: Self.statusSize(base: store.statusBaseSize, scale: store.barScale), clickThrough: false)

        let root = StatusBarRoot(
            store: store,
            onOpenSettings: { [weak self] in self?.showSettings() },
            onOpenInput: { [weak self] in self?.showScheduleInput() },
            onDrag: { [weak self] value in self?.handleDrag(value) }
        )
        statusPanel.contentView = NSHostingView(rootView: root)
        restorePosition()

        // @Published는 값이 바뀌기 직전에 알려주므로 새 값을 그대로 받아서 계산
        Publishers.CombineLatest(store.$barScale.removeDuplicates(), store.$skin.map { $0 != nil }.removeDuplicates())
            .sink { [weak self] scale, hasSkin in
                let base = hasSkin
                    ? CGSize(width: StatusBarSkin.size.width, height: StatusBarSkin.size.height)
                    : StatusBarView.baseSize
                self?.resizeStatusPanel(base: base, scale: scale)
            }
            .store(in: &cancellables)
        store.$showStatusBar
            .sink { [weak self] show in
                if show { self?.statusPanel.orderFrontRegardless() } else { self?.statusPanel.orderOut(nil) }
            }
            .store(in: &cancellables)

        store.onLevelUp = { [weak self] event in self?.handleLevelUp(event) }
        store.onBlockEnding = { [weak self] event, climax in self?.prepareBattle(event, climax: climax) }
        store.onSceneCancel = { [weak self] in self?.cancelBattle() }
        store.onGiveUp = { [weak self] gaveUp in
            if gaveUp { self?.showTomb(falling: true) } else { self?.hideTomb() }
        }
        if store.hasGivenUp { showTomb(falling: false) }
    }

    // MARK: - 상태바

    private static func statusSize(base: CGSize, scale: Double) -> CGSize {
        CGSize(width: base.width * scale, height: base.height * scale)
    }

    private func resizeStatusPanel(base: CGSize, scale: Double) {
        // 왼쪽 아래 기준점을 유지한 채 크기만 바꿈
        let origin = statusPanel.frame.origin
        statusPanel.setFrame(CGRect(origin: origin, size: Self.statusSize(base: base, scale: scale)), display: true)
        keepOnScreen()
        if tombPanel != nil { showTomb(falling: false) }
    }

    private func restorePosition() {
        if let saved = UserDefaults.standard.string(forKey: Self.originKey) {
            statusPanel.setFrameOrigin(NSPointFromString(saved))
        } else if let screen = NSScreen.main {
            // 처음엔 화면 아래 가운데
            let visible = screen.visibleFrame
            let size = statusPanel.frame.size
            statusPanel.setFrameOrigin(NSPoint(x: visible.midX - size.width / 2, y: visible.minY + 20))
        }
        keepOnScreen()
    }

    /// 모니터 연결이 바뀌어 화면 밖에 있으면 안쪽으로 데려옴
    private func keepOnScreen() {
        let frame = statusPanel.frame
        if NSScreen.screens.contains(where: { $0.visibleFrame.intersects(frame) }) { return }
        guard let visible = NSScreen.main?.visibleFrame else { return }
        statusPanel.setFrameOrigin(NSPoint(x: visible.midX - frame.width / 2, y: visible.minY + 20))
        savePosition()
    }

    private func savePosition() {
        UserDefaults.standard.set(NSStringFromPoint(statusPanel.frame.origin), forKey: Self.originKey)
    }

    private func handleDrag(_ value: DragGesture.Value?) {
        guard value != nil else {
            if dragStart != nil { store.play(.dragEnd) }
            dragStart = nil
            savePosition()
            return
        }
        let mouse = NSEvent.mouseLocation
        if dragStart == nil {
            dragStart = (mouse, statusPanel.frame.origin)
            store.play(.dragStart)
        }
        guard let start = dragStart else { return }
        statusPanel.setFrameOrigin(NSPoint(
            x: start.origin.x + mouse.x - start.mouse.x,
            y: start.origin.y + mouse.y - start.mouse.y
        ))
        positionTomb()
    }

    // MARK: - 레벨업 이펙트

    /// 레벨업 이펙트는 항상, 직업이 바뀌면 전직 이펙트를 같이 겹쳐서
    func showLevelUpEffect(jobChanged: Bool = false) {
        guard store.showStatusBar else { return }
        hideEffects()
        let id = UUID()
        effectID = id
        let animations = [store.levelUpAnimation, jobChanged ? store.jobChangeAnimation : nil].compactMap { $0 }
        if !animations.isEmpty {
            for prepared in animations { showMapleLevelUp(prepared, id: id) }
            return
        }

        let scale = store.barScale
        let size = CGSize(width: LevelUpView.baseSize.width * scale, height: LevelUpView.baseSize.height * scale)
        let bar = statusPanel.frame
        let panel = FloatingPanel(size: size, clickThrough: true)
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 1)
        panel.contentView = NSHostingView(rootView: LevelUpView(scale: scale, startDate: Date()))
        // 상태바 바로 위, EXP 쪽(오른쪽)에 띄움
        var origin = NSPoint(x: bar.maxX - size.width - 20 * scale, y: bar.maxY - 10 * scale)
        if let screen = statusPanel.screen?.visibleFrame, origin.y + size.height > screen.maxY {
            origin.y = bar.minY - size.height + 10 * scale
        }
        panel.setFrameOrigin(origin)
        panel.orderFrontRegardless()
        effectPanels.append(panel)
        hide(panel, after: LevelUpView.duration, id: id)
    }

    private func hideEffects() {
        effectPanels.forEach { $0.orderOut(nil) }
        effectPanels = []
    }

    /// 이펙트 창 하나를 seconds 뒤에 닫음 (그사이 새 이펙트가 떴으면 그쪽에서 이미 닫음)
    private func hide(_ panel: FloatingPanel, after seconds: TimeInterval, id: UUID) {
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            guard let self, self.effectID == id else { return }
            panel.orderOut(nil)
            self.effectPanels.removeAll { $0 === panel }
        }
    }

    /// 원본 레벨업 이펙트: 기준점(발밑)을 상태바 윗변, EXP 막대 위에 맞춤
    private func showMapleLevelUp(_ prepared: PreparedAnimation, id: UUID) {
        let scale = CGFloat(store.barScale)
        let bounds = prepared.animation.bounds
        let size = CGSize(width: prepared.size.width * scale, height: prepared.size.height * scale)
        let bar = statusPanel.frame
        // 스킨 상태바면 EXP 막대 가운데, 아니면 상태바 가운데
        let anchorX = store.skin != nil ? bar.minX + 496 * scale : bar.midX
        let anchorY = bar.maxY - 6 * scale
        let panel = FloatingPanel(size: size, clickThrough: true)
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 1)
        panel.hasShadow = false
        panel.contentView = NSHostingView(rootView: MapleLevelUpView(prepared: prepared, scale: scale, startDate: Date()))
        panel.setFrameOrigin(NSPoint(x: anchorX + CGFloat(bounds.minX) * scale,
                                     y: anchorY - CGFloat(bounds.maxY) * scale))
        panel.orderFrontRegardless()
        effectPanels.append(panel)
        hide(panel, after: prepared.duration + 0.1, id: id)
    }

    // MARK: - 사냥 장면

    private func handleLevelUp(_ event: LevelUpEvent) {
        // 장면이 떠 있으면 장면 안에서 레벨업 이펙트가 나옴
        if battlePanel != nil || battleID != nil, battleBlockID == event.blockID { return }
        showLevelUpEffect(jobChanged: event.jobChanged)
    }

    /// 장면을 백그라운드에서 만들고, 레벨업 순간(climax)에 맞춰 띄움
    private func prepareBattle(_ event: LevelUpEvent, climax: Date) {
        cancelBattle()
        guard store.showStatusBar, store.showBattleScene else { return }
        let token = UUID()
        battleID = token
        battleBlockID = event.blockID
        let assets = store.assets
        let levelUp = store.levelUpAnimation?.animation
        let jobChange = store.jobChangeAnimation?.animation
        let font = store.pixelFont
        let fontName = store.customFontName
        Task.detached(priority: .userInitiated) {
            let scene = BattleSceneBuilder.build(event: event, assets: assets, levelUp: levelUp, jobChange: jobChange,
                                                 font: font, fontName: fontName)
            await MainActor.run { [weak self] in
                self?.presentBattle(scene, climax: climax, token: token)
            }
        }
    }

    private func presentBattle(_ scene: BattleScene?, climax: Date, token: UUID) {
        guard battleID == token else { return }
        guard let scene else {
            // 캐릭터 파일이 없거나 못 만듦 → 예전처럼 레벨업 이펙트만
            battleID = nil
            battleBlockID = nil
            return
        }
        let startDate = climax.addingTimeInterval(-scene.climax)
        func at(_ date: Date, _ work: @escaping () -> Void) {
            let item = DispatchWorkItem(block: work)
            battleWork.append(item)
            DispatchQueue.main.asyncAfter(deadline: .now() + max(0, date.timeIntervalSinceNow), execute: item)
        }
        at(startDate) { [weak self] in self?.showBattlePanel(scene, startDate: startDate, token: token) }
        for sound in scene.sounds {
            let when = startDate.addingTimeInterval(sound.at)
            guard when.timeIntervalSinceNow > -0.2 else { continue }
            at(when) { [weak self] in self?.store.playSound(sound.data) }
        }
        at(startDate.addingTimeInterval(scene.duration + 0.1)) { [weak self] in
            guard self?.battleID == token else { return }
            self?.cancelBattle()
        }
    }

    private func showBattlePanel(_ scene: BattleScene, startDate: Date, token: UUID) {
        guard battleID == token, store.showStatusBar else { return }
        battlePanel?.orderOut(nil)
        let scale = CGFloat(store.barScale)
        let size = CGSize(width: BattleScene.size.width * scale, height: BattleScene.size.height * scale)
        let panel = FloatingPanel(size: size, clickThrough: true)
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 1)
        panel.hasShadow = false
        panel.contentView = NSHostingView(rootView: BattleSceneView(scene: scene, scale: scale, startDate: startDate))
        let bar = statusPanel.frame
        // 장면의 땅(아래에서 15px)이 상태바 윗변에 오게, 몬스터 쪽이 EXP 막대 위
        var origin = NSPoint(
            x: store.skin != nil ? bar.minX + 190 * scale : bar.maxX - size.width,
            y: bar.maxY - (BattleScene.size.height - BattleScene.ground) * scale
        )
        if let screen = statusPanel.screen?.visibleFrame {
            origin.x = min(max(origin.x, screen.minX), screen.maxX - size.width)
            if origin.y + size.height > screen.maxY { origin.y = bar.minY - size.height }
        }
        panel.setFrameOrigin(origin)
        panel.orderFrontRegardless()
        battlePanel = panel
    }

    private func cancelBattle() {
        battleID = nil
        battleBlockID = nil
        battleWork.forEach { $0.cancel() }
        battleWork = []
        battlePanel?.orderOut(nil)
        battlePanel = nil
    }

    // MARK: - 묘비 (포기)

    private func showTomb(falling: Bool) {
        hideTomb()
        guard store.showStatusBar, let root = store.assets.skinRoot("Tomb.img"),
              let land = FrameAnimation(root: root, path: "land").flatMap(PreparedAnimation.init)
        else { return }
        let fall = FrameAnimation(root: root, path: "fall").flatMap(PreparedAnimation.init)
        let scale = CGFloat(store.barScale)
        let size = CGSize(width: TombView.size.width * scale, height: TombView.size.height * scale)
        let panel = FloatingPanel(size: size, clickThrough: true)
        panel.hasShadow = false
        panel.contentView = NSHostingView(rootView: TombView(fall: fall, land: land, scale: scale,
                                                             startDate: falling ? Date() : nil))
        tombPanel = panel
        positionTomb()
        panel.orderFrontRegardless()
    }

    private func positionTomb() {
        guard let panel = tombPanel else { return }
        let bar = statusPanel.frame
        let scale = CGFloat(store.barScale)
        // 이름 칸 위, 묘비 밑동이 상태바 윗변에 살짝 걸치게
        panel.setFrameOrigin(NSPoint(x: bar.minX + 140 * scale - panel.frame.width / 2, y: bar.maxY - 4 * scale))
    }

    private func hideTomb() {
        tombPanel?.orderOut(nil)
        tombPanel = nil
    }

    // MARK: - 설정 창

    func showSettings() {
        store.play(.openSettings)
        if settingsWindow == nil {
            let window = NSWindow(
                contentRect: CGRect(x: 0, y: 0, width: 420, height: 760),
                styleMask: [.titled, .closable, .miniaturizable, .resizable],
                backing: .buffered,
                defer: false
            )
            window.title = "일정 타이머 설정"
            window.isReleasedWhenClosed = false
            window.contentView = NSHostingView(
                rootView: ContentView(
                    onTestLevelUp: { [weak self] in
                        self?.store.play(.levelUp)
                        self?.showLevelUpEffect()
                    },
                    onTestJobChange: { [weak self] in
                        self?.store.play(.levelUp)
                        self?.store.play(.jobChange)
                        self?.showLevelUpEffect(jobChanged: true)
                    },
                    onTestBattle: { [weak self] level in self?.store.previewScene(toLevel: level) },
                    onOpenInput: { [weak self] in self?.showScheduleInput() }
                )
                .environmentObject(store)
                .environmentObject(store.music)
            )
            window.center()
            settingsWindow = window
        }
        NSApp.activate(ignoringOtherApps: true)
        settingsWindow?.makeKeyAndOrderFront(nil)
    }

    // MARK: - 일정 입력창 (메신저 모양)

    /// UIWindow.img가 있으면 메신저 모양 입력창, 없으면 설정 창
    func showScheduleInput() {
        guard let skin = store.messengerSkin else {
            showSettings()
            return
        }
        store.play(.openSettings)
        let scale: CGFloat = 2
        let size = CGSize(width: MessengerSkin.size.width * scale, height: MessengerSkin.size.height * scale)
        // 스킨을 다시 불러왔을 수 있으니 열 때마다 새로 만듦 (위치는 유지)
        let previousOrigin = inputWindow?.frame.origin
        inputWindow?.orderOut(nil)
        let window = KeyableBorderlessWindow(
            contentRect: CGRect(origin: .zero, size: size),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = true
        window.level = .floating
        window.isReleasedWhenClosed = false
        window.contentView = NSHostingView(
            rootView: MessengerInputView(
                skin: skin,
                scale: scale,
                onClose: { [weak self] in self?.inputWindow?.orderOut(nil) },
                onDrag: { [weak self] value in self?.handleInputDrag(value) }
            )
            .environmentObject(store)
        )
        if let previousOrigin {
            window.setFrameOrigin(previousOrigin)
        } else {
            window.center()
        }
        inputWindow = window
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    private func handleInputDrag(_ value: DragGesture.Value?) {
        guard let window = inputWindow else { return }
        guard value != nil else {
            if inputDragStart != nil { store.play(.dragEnd) }
            inputDragStart = nil
            return
        }
        let mouse = NSEvent.mouseLocation
        if inputDragStart == nil {
            inputDragStart = (mouse, window.frame.origin)
            store.play(.dragStart)
        }
        guard let start = inputDragStart else { return }
        window.setFrameOrigin(NSPoint(
            x: start.origin.x + mouse.x - start.mouse.x,
            y: start.origin.y + mouse.y - start.mouse.y
        ))
    }
}

/// 테두리 없는 창이지만 글자 입력을 받을 수 있게
final class KeyableBorderlessWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

/// 상태바 창 내용: store를 구독해서 1초마다 다시 그림. StatusBar.img가 있으면 원본 이미지로.
private struct StatusBarRoot: View {
    @ObservedObject var store: AppStore
    let onOpenSettings: () -> Void
    let onOpenInput: () -> Void
    let onDrag: (DragGesture.Value?) -> Void

    var body: some View {
        Group {
            if let skin = store.skin {
                SkinStatusBarView(
                    skin: skin,
                    snapshot: store.snapshot,
                    nickname: store.displayName,
                    fontName: store.customFontName,
                    pixelFont: store.pixelFont,
                    scale: store.barScale,
                    onOpenSettings: onOpenSettings,
                    onGaugeClick: gaugeClick,
                    onDrag: onDrag
                )
            } else {
                StatusBarView(
                    snapshot: store.snapshot,
                    nickname: store.displayName,
                    scale: store.barScale,
                    onOpenSettings: onOpenSettings,
                    onGaugeClick: gaugeClick,
                    onDrag: onDrag
                )
            }
        }
        .contextMenu {
            Button("일정 입력", action: onOpenInput)
            Button("설정 열기", action: onOpenSettings)
            Divider()
            Button(store.music.isPlaying ? "음악 일시정지" : "음악 재생") { store.music.togglePlay() }
            Button("이전 곡") { store.music.previous() }
            Button("다음 곡") { store.music.next() }
            Button("지금 곡 삭제") { store.music.deleteCurrent() }
                .disabled(store.music.current == nil)
            Toggle("옛날 메이플만 듣기", isOn: Binding(
                get: { store.music.oldMapleOnly },
                set: { store.music.oldMapleOnly = $0 }
            ))
            Divider()
            if store.hasGivenUp {
                Button("포기 취소") { store.undoGiveUp() }
            } else {
                Button("오늘은 여기까지 (포기)…") { confirmGiveUp() }
            }
        }
    }

    private func confirmGiveUp() {
        let alert = NSAlert()
        alert.messageText = "오늘은 여기까지 할까?"
        alert.informativeText = "남은 블록은 모두 포기로 바뀌어. 오늘 얻은 레벨은 그대로고, 새벽 4시에 정리돼. (포기 취소도 가능)"
        alert.addButton(withTitle: "포기")
        alert.addButton(withTitle: "취소")
        NSApp.activate(ignoringOtherApps: true)
        if alert.runModal() == .alertFirstButtonReturn { store.giveUp() }
    }

    /// HP: 이전 곡, MP: 재생/일시정지, EXP: 다음 곡
    private func gaugeClick(_ gauge: Int) {
        store.play(.click)
        switch gauge {
        case 0: store.music.previous()
        case 1: store.music.togglePlay()
        default: store.music.next()
        }
    }
}
