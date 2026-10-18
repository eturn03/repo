import AppKit
import SwiftUI
import ScheduleCore

/// 설정 창 (상태바의 돋보기 또는 메뉴 막대 아이콘으로 열기)
struct ContentView: View {
    @EnvironmentObject private var store: AppStore
    @EnvironmentObject private var music: MusicPlayer
    var onTestLevelUp: () -> Void = {}

    private enum Pending: Equatable {
        case end, skip, extend(Int)
    }

    @State private var pending: Pending?
    @State private var showInput = false
    @State private var inputText = ""
    @State private var forTomorrow = false
    @State private var resultMessage: String?
    @State private var parseErrors: [ParseError] = []

    var body: some View {
        ScrollView {
        VStack(alignment: .leading, spacing: 10) {
            Text(store.statusLine)
                .font(.title3.monospacedDigit())

            if case .inBlock = store.position {
                controls
            }

            Divider()
            scheduleList

            Divider()
            if showInput || store.schedule.blocks.isEmpty {
                inputSection
            } else {
                Button("새 일정 입력") { showInput = true }
            }

            Divider()
            footer
        }
        .padding(14)
        .frame(minWidth: 380, maxWidth: .infinity, alignment: .topLeading)
        // 이 창의 모든 버튼에 작은 클릭음
        .buttonStyle(ClickSoundButtonStyle { store.play(.click) })
        }
    }

    // MARK: - 블록 조작

    @ViewBuilder
    private var controls: some View {
        HStack {
            Button("완료") { pending = .end }
            Button("건너뛰기") { pending = .skip }
            Button("+5분") { pending = .extend(5) }
            Button("+10분") { pending = .extend(10) }
        }

        if let pending {
            VStack(alignment: .leading, spacing: 6) {
                switch pending {
                case .end, .skip:
                    let status: BlockStatus = pending == .end ? .completed : .skipped
                    Text(pending == .end ? "완료하고 다음은? (레벨업 O)" : "건너뛰고 다음은? (레벨업 X)")
                        .font(.caption).foregroundStyle(.secondary)
                    Button("다음 블록 바로 시작 (이후 일정 앞당김)") {
                        store.endCurrent(mode: .pullForward, status: status)
                        self.pending = nil
                    }
                    Button("원래 일정 유지 (다음 블록까지 빈 시간)") {
                        store.endCurrent(mode: .keepSchedule, status: status)
                        self.pending = nil
                    }
                case .extend(let minutes):
                    Text("\(minutes)분 연장하면서 다음 블록과 겹치는 부분은?")
                        .font(.caption).foregroundStyle(.secondary)
                    Button("이후 일정 뒤로 밀기") {
                        store.extendCurrent(minutes: minutes, mode: .pushLater)
                        self.pending = nil
                    }
                    Button("다음 블록 줄이기") {
                        store.extendCurrent(minutes: minutes, mode: .shrinkNext)
                        self.pending = nil
                    }
                }
                Button("취소") { self.pending = nil }
            }
            .padding(8)
            .background(Color.secondary.opacity(0.1))
            .cornerRadius(6)
        }
    }

    // MARK: - 오늘 일정 목록

    private var scheduleList: some View {
        let position = store.position
        let blocks = store.schedule.blocks
        return ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    if blocks.isEmpty {
                        Text("등록된 일정 없음").foregroundStyle(.secondary)
                    }
                    ForEach(Array(blocks.enumerated()), id: \.element.id) { index, block in
                        if case .gap(let next) = position, next == index {
                            Text("▶ 지금: 빈 시간")
                                .font(.callout.bold())
                                .foregroundStyle(Color.accentColor)
                                .id("now")
                        }
                        BlockRow(
                            block: block,
                            isCurrent: position == .inBlock(index: index),
                            isPast: block.end <= store.now
                        )
                        .id(position == .inBlock(index: index) ? "now" : block.id.uuidString)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(minHeight: 120, maxHeight: 320)
            .onAppear { proxy.scrollTo("now", anchor: .center) }
        }
    }

    // MARK: - 일정 입력

    private var inputSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("한 줄에 하나씩: 09:00-10:30 영어공부")
                .font(.caption).foregroundStyle(.secondary)
            TextEditor(text: $inputText)
                .font(.system(.body, design: .monospaced))
                .frame(height: 120)
                .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.secondary.opacity(0.4)))
            HStack {
                Button("클립보드에서 붙여넣기") {
                    inputText = NSPasteboard.general.string(forType: .string) ?? ""
                }
                Picker("", selection: $forTomorrow) {
                    Text("오늘").tag(false)
                    Text("내일").tag(true)
                }
                .pickerStyle(.segmented)
                .frame(width: 110)
                .labelsHidden()
            }
            HStack {
                Button("저장 (기존 일정 교체)") { save() }
                    .keyboardShortcut(.defaultAction)
                if !store.schedule.blocks.isEmpty {
                    Button("닫기") { showInput = false; resultMessage = nil; parseErrors = [] }
                }
            }
            if let resultMessage {
                Text(resultMessage).font(.caption)
            }
            ForEach(parseErrors, id: \.lineNumber) { error in
                Text("\(error.lineNumber)번째 줄: \(error.reason)\n  → \(error.line)")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
    }

    private func save() {
        let day = forTomorrow
            ? Calendar.current.date(byAdding: .day, value: 1, to: Date())!
            : Date()
        let result = ScheduleParser.parse(inputText, day: day)
        parseErrors = result.errors
        if result.blocks.isEmpty {
            resultMessage = result.errors.isEmpty
                ? "입력된 일정이 없음"
                : "등록된 블록 없음 (기존 일정 유지)"
            store.play(.scheduleFailed)
            return
        }
        store.replaceSchedule(with: result.blocks)
        pending = nil
        if result.errors.isEmpty {
            resultMessage = nil
            inputText = ""
            showInput = false
        } else {
            resultMessage = "\(result.blocks.count)개 등록, \(result.errors.count)줄은 형식 오류로 제외:"
        }
    }

    // MARK: - 하단

    /// 불러온 소리 목록 + 지금 배정된 소리(파일이 아직 없어도 목록에 보이게)
    private func soundChoices(for event: SoundEvent) -> [String] {
        var names = store.soundBank?.names ?? []
        let current = store.sound(for: event)
        if !current.isEmpty, current != "-", !names.contains(current) { names.insert(current, at: 0) }
        return names
    }

    private func volumeSlider(_ label: String, value: Binding<Double>) -> some View {
        HStack {
            Text(label)
            Slider(value: value, in: 0...1)
            Text("\(Int((value.wrappedValue * 100).rounded()))%")
                .monospacedDigit()
                .frame(width: 40, alignment: .trailing)
        }
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Button("원래 일정으로 되돌리기") { store.resetToOriginal() }
                    .disabled(!store.schedule.hasModifications)
                Spacer()
                Button("종료") { NSApplication.shared.terminate(nil) }
            }
            HStack {
                Text("닉네임")
                TextField("닉네임", text: $store.nickname)
                    .textFieldStyle(.roundedBorder)
            }
            HStack {
                Text("상태바 크기")
                Slider(value: $store.barScale, in: AppStore.scaleRange, step: 0.1)
                Text(String(format: "%.1f배", store.barScale))
                    .monospacedDigit()
                    .frame(width: 44, alignment: .trailing)
            }
            Toggle("상태바 보이기", isOn: $store.showStatusBar)
            GroupBox("음악 (셔플)") {
                VStack(alignment: .leading, spacing: 6) {
                    Text(music.current.map { "♪ \($0.title)" } ?? "재생 중인 곡 없음")
                        .lineLimit(1)
                        .truncationMode(.middle)
                    HStack {
                        Button(music.isPlaying ? "일시정지" : "재생") { music.togglePlay() }
                        Button("다음 곡") { music.next() }
                        Spacer()
                        Button("음악 폴더 열기") { NSWorkspace.shared.open(AppFolder.music) }
                        Button("다시 불러오기") { music.reload() }
                    }
                    Text(music.message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    volumeSlider("음악 볼륨", value: $music.volume)
                    volumeSlider("효과음 볼륨", value: $store.effectVolume)
                    volumeSlider("작은 효과음 볼륨", value: $store.quietVolume)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            GroupBox("스킨·효과음 (메이플 파일)") {
                VStack(alignment: .leading, spacing: 6) {
                    Text(store.skinMessage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack {
                        Button("스킨 폴더 열기") { NSWorkspace.shared.open(AppFolder.skin) }
                        Button("스킨 다시 불러오기") { store.reloadSkin() }
                    }
                    Button("레벨업 미리보기") { onTestLevelUp() }
                    DisclosureGroup("상황별 효과음 바꾸기") {
                        ForEach(SoundEvent.allCases) { event in
                            HStack {
                                Picker(event.title, selection: Binding(
                                    get: { store.sound(for: event) },
                                    set: { store.setSound($0, for: event) }
                                )) {
                                    Text(event.systemFallback == nil ? "기본 (없음)" : "기본음").tag("")
                                    Text("없음").tag("-")
                                    ForEach(soundChoices(for: event), id: \.self) { name in
                                        Text(name).tag(name)
                                    }
                                }
                                Button {
                                    store.play(event)
                                } label: {
                                    Image(systemName: "speaker.wave.2")
                                }
                                .help("들어보기")
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Toggle("로그인 시 자동 실행", isOn: Binding(
                get: { store.launchAtLogin },
                set: { store.setLaunchAtLogin($0) }
            ))
            if let message = store.loginItemMessage {
                Text(message).font(.caption).foregroundStyle(.orange)
            }
        }
    }
}

/// 버튼을 누를 때 클릭음을 내는 스타일 (모양은 기본 버튼 그대로)
private struct ClickSoundButtonStyle: PrimitiveButtonStyle {
    let onClick: () -> Void

    func makeBody(configuration: Configuration) -> some View {
        Button(role: configuration.role) {
            onClick()
            configuration.trigger()
        } label: {
            configuration.label
        }
        .buttonStyle(.automatic)
    }
}

private struct BlockRow: View {
    let block: Block
    let isCurrent: Bool
    let isPast: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 6) {
                Text(isCurrent ? "▶" : " ")
                    .frame(width: 12)
                Text(block.status == .dropped ? "--:--–--:--" : Format.range(block.start, block.end))
                    .font(.system(.body, design: .monospaced))
                Text(block.title)
                    .strikethrough(block.status == .skipped || block.status == .dropped)
                if let tag {
                    Text(tag)
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
            }
            .fontWeight(isCurrent ? .bold : .regular)
            .foregroundStyle(isCurrent ? Color.accentColor : (isPast ? Color.secondary : Color.primary))

            if block.isModified {
                Text("원래 \(Format.range(block.originalStart, block.originalEnd))")
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .padding(.leading, 18)
            }
        }
    }

    private var tag: String? {
        switch block.status {
        case .completed: return "일찍 끝냄"
        case .skipped: return "건너뜀"
        case .dropped: return "없어짐"
        case .scheduled:
            if block.isModified { return "시간 변경" }
            return isPast ? "지남" : nil
        }
    }
}
