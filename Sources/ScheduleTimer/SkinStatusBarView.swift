import SwiftUI
import ScheduleCore
import WZKit

/// StatusBar.img 원본 이미지로 그린 상태바. 픽셀 아트는 확대해도 뭉개지지 않게 그대로 키움.
struct SkinStatusBarView: View {
    let skin: StatusBarSkin
    let snapshot: StatusSnapshot
    let nickname: String
    let scale: CGFloat
    var onOpenSettings: () -> Void = {}
    var onDrag: (DragGesture.Value?) -> Void = { _ in }

    private func s(_ v: Int) -> CGFloat { CGFloat(v) * scale }

    var body: some View {
        let size = StatusBarSkin.size
        ZStack(alignment: .topLeading) {
            barImage
                .frame(width: s(size.width), height: s(size.height))

            // LV 숫자 (원본 숫자 이미지가 없어서 글자로)
            Text(String(snapshot.level))
                .font(.system(size: 15 * scale, weight: .black, design: .rounded))
                .foregroundStyle(Color(red: 1, green: 0.67, blue: 0.2))
                .shadow(color: .black, radius: 0, x: scale, y: scale)
                .frame(width: s(StatusBarSkin.levelSlot.width), height: s(StatusBarSkin.levelSlot.height))
                .offset(x: s(StatusBarSkin.levelSlot.x), y: s(StatusBarSkin.levelSlot.y))

            // 지금 할 일 / 닉네임
            VStack(alignment: .leading, spacing: 1 * scale) {
                Text(snapshot.title)
                    .foregroundStyle(snapshot.phase == .inBlock ? Color.white : Color(white: 0.75))
                Text(nickname)
                    .foregroundStyle(.white)
            }
            .font(.system(size: 12 * scale, weight: .medium))
            .lineLimit(1)
            .truncationMode(.tail)
            .frame(width: s(205 - StatusBarSkin.nameOrigin.x), alignment: .leading)
            .offset(x: s(StatusBarSkin.nameOrigin.x), y: s(StatusBarSkin.nameOrigin.y))

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
            hp: snapshot.hpFraction, mp: snapshot.mpFraction, exp: snapshot.expProgress,
            hpText: snapshot.hpText, mpText: snapshot.mpText, expText: snapshot.expText
        )
        if let cgImage = bitmap.cgImage() {
            Image(decorative: cgImage, scale: 1)
                .interpolation(.none)
                .resizable()
        } else {
            Color.black
        }
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
