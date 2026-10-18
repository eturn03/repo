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

            settingsButton
                .offset(x: s(StatusBarSkin.buttonSlot.x), y: s(StatusBarSkin.buttonSlot.y))
        }
        .frame(width: s(size.width), height: s(size.height), alignment: .topLeading)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 1, coordinateSpace: .global)
                .onChanged { onDrag($0) }
                .onEnded { _ in onDrag(nil) }
        )
    }

    @ViewBuilder
    private var barImage: some View {
        let bitmap = skin.compose(
            level: snapshot.level,
            hp: snapshot.hpFraction, mp: snapshot.mpFraction, exp: snapshot.expProgress,
            hpText: snapshot.hpText, mpText: snapshot.mpText, expText: snapshot.expText
        )
        let bitmap = withNames(bitmap)
        if let cgImage = bitmap.cgImage() {
            Image(decorative: cgImage, scale: 1)
                .interpolation(.none)
                .resizable()
        } else {
            Color.black
        }
    }

    /// 지금 할 일 / 닉네임을 원본처럼 12px 각진 글자로 이미지 안에 그림
    private func withNames(_ base: Bitmap) -> Bitmap {
        var out = base
        let origin = StatusBarSkin.nameOrigin
        let maxWidth = StatusBarSkin.nameMaxX - origin.x
        let titleColor: (r: UInt8, g: UInt8, b: UInt8) = snapshot.phase == .inBlock ? (255, 255, 255) : (190, 190, 190)
        let title = PixelText.render(snapshot.title, fontName: fontName, color: titleColor, maxWidth: maxWidth)
        let name = PixelText.render(nickname, fontName: fontName, maxWidth: maxWidth)
        out.draw(title, x: origin.x, y: origin.y)
        out.draw(name, x: origin.x, y: origin.y + 14)
        return out
    }

    private var settingsButton: some View {
        let side = s(StatusBarSkin.buttonSlot.width)
        return Button(action: onOpenSettings) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: side * 0.45, weight: .bold))
                .foregroundStyle(Maple.buttonIcon)
                .frame(width: side, height: side)
                .background(
                    Circle().fill(LinearGradient(
                        colors: [Maple.buttonTop, Maple.buttonBottom],
                        startPoint: .top, endPoint: .bottom
                    ))
                )
                .overlay(Circle().strokeBorder(Maple.panelBorder, lineWidth: scale))
        }
        .buttonStyle(.plain)
        .help("설정 열기")
    }
}
