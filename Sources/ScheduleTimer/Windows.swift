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

        store.onLevelUp = { [weak self] jobChanged in self?.showLevelUpEffect(jobChanged: jobChanged) }
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
                    onDrag: onDrag
                )
            } else {
                StatusBarView(
                    snapshot: store.snapshot,
                    nickname: store.displayName,
                    scale: store.barScale,
                    onOpenSettings: onOpenSettings,
                    onDrag: onDrag
                )
            }
        }
        .contextMenu {
            Button("일정 입력", action: onOpenInput)
            Button("설정 열기", action: onOpenSettings)
            Divider()
            Button(store.music.isPlaying ? "음악 일시정지" : "음악 재생") { store.music.togglePlay() }
            Button("다음 곡") { store.music.next() }
        }
    }
}
