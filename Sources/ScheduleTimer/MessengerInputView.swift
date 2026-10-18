import AppKit
import SwiftUI
import ScheduleCore
import WZKit

/// UIWindow.img의 메신저 창 조각들 (일정 입력창 모양)
struct MessengerSkin {
    static let size = CGSize(width: 295, height: 240)
    /// 창 안 위치 (원본 픽셀 좌표)
    static let textArea = CGRect(x: 8, y: 56, width: 258, height: 122)
    static let statusLine = CGRect(x: 11, y: 194, width: 208, height: 15)
    static let optionBar = CGRect(x: 12, y: 25, width: 270, height: 20)
    static let enterOrigin = CGPoint(x: 244, y: 193)
    static let closeOrigin = CGPoint(x: 258, y: 4)
    static let titleBarHeight: CGFloat = 20

    let background: CGImage
    let enter: SpriteButton.Images
    let close: SpriteButton.Images

    init(uiWindow root: WZNode) throws {
        func image(_ path: String) throws -> CGImage {
            guard let canvas = root[path]?.canvas, let cg = try canvas.bitmap().cgImage() else {
                throw WZError.badFormat("\(path) 없음")
            }
            return cg
        }
        func states(_ base: String) throws -> SpriteButton.Images {
            let normal = try image("\(base)/normal/0")
            return SpriteButton.Images(
                normal: normal,
                hover: (try? image("\(base)/mouseOver/0")) ?? normal,
                pressed: (try? image("\(base)/pressed/0")) ?? normal
            )
        }
        background = try image("Messenger/backgrnd2")
        enter = try states("Messenger/BtEnter")
        close = try states("BtUIClose")
    }
}

/// 메이플 이미지 버튼 (보통/마우스 올림/누름)
struct SpriteButton: View {
    struct Images {
        let normal: CGImage
        let hover: CGImage
        let pressed: CGImage
    }

    let images: Images
    let scale: CGFloat
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) { EmptyView() }
            .buttonStyle(SpriteStyle(images: images, scale: scale, hovering: hovering))
            .onHover { hovering = $0 }
    }

    private struct SpriteStyle: ButtonStyle {
        let images: Images
        let scale: CGFloat
        let hovering: Bool

        func makeBody(configuration: Configuration) -> some View {
            let image = configuration.isPressed ? images.pressed : (hovering ? images.hover : images.normal)
            return Image(decorative: image, scale: 1)
                .interpolation(.none)
                .resizable()
                .frame(width: CGFloat(image.width) * scale, height: CGFloat(image.height) * scale)
        }
    }
}

/// 메신저 창 모양의 일정 입력창
struct MessengerInputView: View {
    @EnvironmentObject private var store: AppStore
    let skin: MessengerSkin
    let scale: CGFloat
    var onClose: () -> Void = {}
    var onDrag: (DragGesture.Value?) -> Void = { _ in }

    @State private var text = ""
    @State private var tomorrow = false
    @State private var saved: String?
    @State private var savedIsError = false
    @State private var keepSavedMessage = false

    private func font(_ size: CGFloat) -> Font {
        .custom(store.customFontName ?? PixelText.defaultFontName, size: size * scale)
    }

    private func rect(_ r: CGRect) -> CGRect {
        CGRect(x: r.minX * scale, y: r.minY * scale, width: r.width * scale, height: r.height * scale)
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            Image(decorative: skin.background, scale: 1)
                .interpolation(.none)
                .resizable()
                .frame(width: MessengerSkin.size.width * scale, height: MessengerSkin.size.height * scale)

            // 제목 줄을 끌어서 창 이동
            Color.clear
                .frame(width: (MessengerSkin.closeOrigin.x - 2) * scale, height: MessengerSkin.titleBarHeight * scale)
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 1, coordinateSpace: .global)
                        .onChanged { onDrag($0) }
                        .onEnded { _ in onDrag(nil) }
                )

            SpriteButton(images: skin.close, scale: scale) {
                store.play(.click)
                onClose()
            }
            .offset(x: MessengerSkin.closeOrigin.x * scale, y: MessengerSkin.closeOrigin.y * scale)

            optionBar

            TextEditor(text: $text)
                .font(font(12))
                .foregroundStyle(Color(white: 0.08))
                .scrollContentBackground(.hidden)
                .background(Color.clear)
                .frame(width: rect(MessengerSkin.textArea).width, height: rect(MessengerSkin.textArea).height)
                .offset(x: rect(MessengerSkin.textArea).minX, y: rect(MessengerSkin.textArea).minY)
                .onChange(of: text) { _ in
                    // 저장 후 비울 때는 "저장 완료" 문구를 남김
                    if keepSavedMessage { keepSavedMessage = false } else { saved = nil }
                }

            Text(statusText)
                .font(font(11))
                .foregroundStyle(statusIsError ? Color(red: 0.75, green: 0.1, blue: 0.1) : Color(white: 0.12))
                .lineLimit(1)
                .minimumScaleFactor(0.6)   // 칸보다 길면 글자를 줄여서 끝까지 보이게
                .frame(width: rect(MessengerSkin.statusLine).width, height: rect(MessengerSkin.statusLine).height, alignment: .leading)
                .offset(x: rect(MessengerSkin.statusLine).minX, y: rect(MessengerSkin.statusLine).minY)

            SpriteButton(images: skin.enter, scale: scale) { save() }
                .keyboardShortcut(.return, modifiers: .command)
                .help("저장 (⌘+Enter)")
                .offset(x: MessengerSkin.enterOrigin.x * scale, y: MessengerSkin.enterOrigin.y * scale)
        }
        .frame(width: MessengerSkin.size.width * scale, height: MessengerSkin.size.height * scale, alignment: .topLeading)
    }

    /// 베이지 칸: 오늘/내일, 붙여넣기
    private var optionBar: some View {
        let bar = rect(MessengerSkin.optionBar)
        return HStack(spacing: 10 * scale) {
            dayChoice("오늘", selected: !tomorrow) { tomorrow = false }
            dayChoice("내일", selected: tomorrow) { tomorrow = true }
            Spacer()
            textButton("붙여넣기") {
                text = NSPasteboard.general.string(forType: .string) ?? text
            }
            textButton("지우기") { text = "" }
        }
        .font(font(12))
        .padding(.horizontal, 4 * scale)
        .frame(width: bar.width, height: bar.height)
        .offset(x: bar.minX, y: bar.minY)
    }

    private func dayChoice(_ label: String, selected: Bool, action: @escaping () -> Void) -> some View {
        textButton(selected ? "[\(label)]" : label, color: selected ? Color(red: 0.1, green: 0.2, blue: 0.5) : Color(white: 0.35), action: action)
    }

    private func textButton(_ label: String, color: Color = Color(red: 0.1, green: 0.2, blue: 0.5),
                            action: @escaping () -> Void) -> some View {
        Button {
            store.play(.click)
            action()
        } label: {
            Text(label).foregroundStyle(color)
        }
        .buttonStyle(.plain)
    }

    // MARK: - 검사·저장

    private var preview: ParseResult { AppStore.parse(text, tomorrow: tomorrow) }

    private var statusText: String {
        if let saved { return saved }
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "예) 09:00-10:30 영어공부"
        }
        let result = preview
        if result.errors.isEmpty { return "블록 \(result.blocks.count)개 인식 · 오류 없음" }
        let lines = result.errors.map { String($0.lineNumber) }.joined(separator: ", ")
        return "블록 \(result.blocks.count)개 · 오류 \(lines)번째 줄"
    }

    private var statusIsError: Bool {
        if saved != nil { return savedIsError }
        return !text.isEmpty && !preview.errors.isEmpty
    }

    private func save() {
        let result = store.saveSchedule(text: text, tomorrow: tomorrow)
        if result.blocks.isEmpty {
            saved = result.errors.isEmpty ? "입력된 일정이 없음" : "등록된 블록 없음 (기존 일정 유지)"
            savedIsError = true
        } else if result.errors.isEmpty {
            saved = "저장 완료! 블록 \(result.blocks.count)개"
            savedIsError = false
            keepSavedMessage = true
            text = ""
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                saved = nil
                onClose()
            }
        } else {
            let lines = result.errors.map { String($0.lineNumber) }.joined(separator: ", ")
            saved = "\(result.blocks.count)개 저장 · \(lines)번째 줄 제외"
            savedIsError = true
        }
    }
}
