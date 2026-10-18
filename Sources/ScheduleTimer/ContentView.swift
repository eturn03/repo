import AppKit
import SwiftUI
import ScheduleCore

/// 메뉴 막대 아이콘을 클릭하면 뜨는 창
struct ContentView: View {
    @EnvironmentObject private var store: AppStore

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
        VStack(alignment: .leading, spacing: 10) {
            Text(store.menuTitle)
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
        .padding(12)
        .frame(width: 360)
    }

    // MARK: - 블록 조작

    @ViewBuilder
    private var controls: some View {
        HStack {
            Button("지금 끝내기") { pending = .end }
            Button("건너뛰기") { pending = .skip }
            Button("+5분") { pending = .extend(5) }
            Button("+10분") { pending = .extend(10) }
        }

        if let pending {
            VStack(alignment: .leading, spacing: 6) {
                switch pending {
                case .end, .skip:
                    let status: BlockStatus = pending == .end ? .completed : .skipped
                    Text(pending == .end ? "지금 끝내고 다음은?" : "건너뛰고 다음은?")
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
            .frame(maxHeight: 280)
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

    private var footer: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Button("원래 일정으로 되돌리기") { store.resetToOriginal() }
                    .disabled(!store.schedule.hasModifications)
                Spacer()
                Button("종료") { NSApplication.shared.terminate(nil) }
            }
            Toggle("로그인 시 자동 실행", isOn: Binding(
                get: { store.launchAtLogin },
                set: { store.setLaunchAtLogin($0) }
            ))
            if let message = store.loginItemMessage {
                Text(message).font(.caption).foregroundStyle(.orange)
            }
            Stepper("메뉴 막대 할 일 이름: \(store.maxTitleChars)글자", value: $store.maxTitleChars, in: 2...20)
        }
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
