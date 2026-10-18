import SwiftUI
import ScheduleCore
import WZKit

/// StatusBar.img 원본 이미지로 그린 상태바. 픽셀 아트는 확대해도 뭉개지지 않게 그대로 키움.
struct SkinStatusBarView: View {
    let skin: StatusBarSkin
    let snapshot: StatusSnapshot
    let nickname: String
    let fontName: String?
    let scale: CGFloat
    var onOpenSettings: () -> Void = {}
    var onDrag: (DragGesture.Value?) -> Void = { _ in }

    private func s(_ v: Int) -> CGFloat { CGFloat(v) * scale }

    var body: some View {
        let size = StatusBarSkin.size
        ZStack(alignment: .topLeading) {
            barImage
                .frame(width: s(size.width), height: s(size.height))

            // 지금 할 일 / 닉네임: 화면 크기 그대로 부드럽게 (12px에서 확대하면 맥에서 획이 뭉개짐)
            VStack(alignment: .leading, spacing: 0) {
                bracketText(snapshot.title, base: snapshot.phase == .inBlock ? .white : Color(white: 0.75))
                    .frame(height: s(14), alignment: .leading)
                bracketText(nickname, base: .white)
                    .frame(height: s(14), alignment: .leading)
            }
            .font(nameFont)
            .lineLimit(1)
            .truncationMode(.tail)
            .frame(width: s(StatusBarSkin.nameMaxX - StatusBarSkin.nameOrigin.x), alignment: .leading)
            .offset(x: s(StatusBarSkin.nameOrigin.x), y: s(StatusBarSkin.nameOrigin.y))
            .allowsHitTesting(false)
        }
        .frame(width: s(size.width), height: s(size.height), alignment: .topLeading)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 1, coordinateSpace: .global)
                .onChanged { onDrag($0) }
                .onEnded { _ in onDrag(nil) }
        )
        // 돋보기 대신: 더블클릭으로 설정 열기 (오른쪽 클릭 메뉴는 StatusBarRoot)
        .simultaneousGesture(TapGesture(count: 2).onEnded { onOpenSettings() })
        .help("더블클릭: 설정 열기 / 오른쪽 클릭: 메뉴")
    }

    @ViewBuilder
    private var barImage: some View {
        let base = skin.compose(
            level: snapshot.level,
            hp: snapshot.hpFraction, mp: snapshot.mpFraction, exp: snapshot.expProgress,
            hpText: snapshot.hpText, mpText: snapshot.mpText, expText: snapshot.expText
        )
        if let cgImage = base.cgImage() {
            Image(decorative: cgImage, scale: 1)
                .interpolation(.none)
                .resizable()
        } else {
            Color.black
        }
    }

    private var nameFont: Font {
        .custom(fontName ?? PixelText.defaultFontName, fixedSize: 12 * scale)
    }

    /// 원본 상태바처럼 `[`, `]`만 초록색
    private func bracketText(_ string: String, base: Color) -> Text {
        let green = Color(red: 0x99 / 255, green: 0xcc / 255, blue: 0x33 / 255)
        return string.reduce(Text("")) { text, ch in
            text + Text(String(ch)).foregroundColor(ch == "[" || ch == "]" ? green : base)
        }
    }
}
