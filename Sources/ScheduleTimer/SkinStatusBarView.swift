import SwiftUI
import ScheduleCore
import WZKit

/// StatusBar.img 원본 이미지로 그린 상태바. 픽셀 아트는 확대해도 뭉개지지 않게 그대로 키움.
struct SkinStatusBarView: View {
    let skin: StatusBarSkin
    let snapshot: StatusSnapshot
    let nickname: String
    let fontName: String?
    /// 있으면 이름 두 줄을 원본처럼 12px 비트맵 글자로
    let pixelFont: BitmapFont?
    let scale: CGFloat
    var onOpenSettings: () -> Void = {}
    /// HP(0)·MP(1)·EXP(2) 막대 클릭
    var onGaugeClick: (Int) -> Void = { _ in }
    var onDrag: (DragGesture.Value?) -> Void = { _ in }

    private func s(_ v: Int) -> CGFloat { CGFloat(v) * scale }

    var body: some View {
        let size = StatusBarSkin.size
        ZStack(alignment: .topLeading) {
            barImage
                .frame(width: s(size.width), height: s(size.height))

            // 지금 할 일 / 닉네임: 비트맵 글꼴이 없으면 화면 크기 그대로 부드럽게
            if pixelFont == nil {
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
        }
        .frame(width: s(size.width), height: s(size.height), alignment: .topLeading)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 1, coordinateSpace: .global)
                .onChanged { onDrag($0) }
                .onEnded { _ in onDrag(nil) }
        )
        // 더블클릭: 설정 열기, 한 번 클릭: 막대별 음악 조작 (더블클릭이 아닌 게 확인된 뒤 실행)
        .simultaneousGesture(
            TapGesture(count: 2).onEnded { onOpenSettings() }
                .exclusively(before: SpatialTapGesture().onEnded { value in
                    let x = Int(value.location.x / scale), y = Int(value.location.y / scale)
                    if let gauge = StatusBarSkin.gauge(atX: x, y: y) { onGaugeClick(gauge) }
                })
        )
        .help("HP 클릭: 이전 곡 / MP 클릭: 재생·일시정지 / EXP 클릭: 다음 곡\n더블클릭: 설정 열기 / 오른쪽 클릭: 메뉴")
    }

    @ViewBuilder
    private var barImage: some View {
        let base = skin.compose(
            level: snapshot.level,
            hp: snapshot.hpFraction, mp: snapshot.mpFraction, exp: snapshot.expProgress,
            hpText: snapshot.hpText, mpText: snapshot.mpText, expText: snapshot.expText
        )
        let named = pixelFont.map { withPixelNames(base, font: $0) } ?? base
        // 오늘은 여기까지(포기)면 회색
        let bitmap = snapshot.gaveUp ? named.grayscale() : named
        if let cgImage = bitmap.cgImage() {
            Image(decorative: cgImage, scale: 1)
                .interpolation(.none)
                .resizable()
        } else {
            Color.black
        }
    }

    /// 이름 두 줄을 비트맵 글자로 이미지 안에 그림 (괄호만 초록)
    private func withPixelNames(_ base: Bitmap, font: BitmapFont) -> Bitmap {
        var out = base
        let origin = StatusBarSkin.nameOrigin
        let maxWidth = StatusBarSkin.nameMaxX - origin.x
        let titleColor: (r: UInt8, g: UInt8, b: UInt8) = snapshot.phase == .inBlock ? (255, 255, 255) : (190, 190, 190)
        func colors(_ base: (r: UInt8, g: UInt8, b: UInt8)) -> (Character) -> (r: UInt8, g: UInt8, b: UInt8) {
            { ch in ch == "[" || ch == "]" ? PixelText.bracketColor : base }
        }
        out.draw(font.render(snapshot.title, maxWidth: maxWidth, color: colors(titleColor)), x: origin.x, y: origin.y)
        out.draw(font.render(nickname, maxWidth: maxWidth, color: colors((255, 255, 255))), x: origin.x, y: origin.y + 14)
        return out
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
