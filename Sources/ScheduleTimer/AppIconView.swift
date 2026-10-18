import AppKit
import SwiftUI

/// 앱 아이콘 (오리지널 디자인): 들판 배경 + 얼굴 있는 주황 자명종 + 새싹 + EXP 막대.
/// 1024×1024 기준으로 그리고, 설치할 때 크기별 PNG → .icns로 만듦.
struct AppIconView: View {
    private let outline = Color(red: 0.35, green: 0.18, blue: 0.06)
    private let orangeTop = Color(red: 1.0, green: 0.74, blue: 0.33)
    private let orangeBottom = Color(red: 1.0, green: 0.52, blue: 0.12)

    var body: some View {
        ZStack {
            background
            sprout.position(x: 512, y: 205)
            bell.position(x: 320, y: 285)
            bell.position(x: 704, y: 285)
            leg.rotationEffect(.degrees(30)).position(x: 375, y: 770)
            leg.rotationEffect(.degrees(-30)).position(x: 649, y: 770)
            clock.position(x: 512, y: 490)
            expBar.position(x: 512, y: 838)
        }
        .frame(width: 1024, height: 1024)
    }

    // MARK: - 배경 (하늘·구름·언덕)

    private var background: some View {
        ZStack {
            LinearGradient(
                colors: [Color(red: 0.55, green: 0.83, blue: 1.0), Color(red: 0.32, green: 0.64, blue: 0.93)],
                startPoint: .top, endPoint: .bottom
            )
            // 이 안의 좌표는 824×824 기준
            cloud(width: 200).position(x: 150, y: 140)
            cloud(width: 160).position(x: 690, y: 100)
            Ellipse()
                .fill(LinearGradient(
                    colors: [Color(red: 0.55, green: 0.83, blue: 0.35), Color(red: 0.35, green: 0.66, blue: 0.22)],
                    startPoint: .top, endPoint: .bottom
                ))
                .frame(width: 1100, height: 420)
                .position(x: 412, y: 800)
        }
        .frame(width: 824, height: 824)
        .clipShape(RoundedRectangle(cornerRadius: 185, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 185, style: .continuous)
                .strokeBorder(Color.white.opacity(0.35), lineWidth: 8)
        )
        .shadow(color: .black.opacity(0.25), radius: 18, y: 10)
    }

    private func cloud(width: CGFloat) -> some View {
        ZStack {
            Ellipse().frame(width: width, height: width * 0.42)
            Circle().frame(width: width * 0.5).offset(x: -width * 0.12, y: -width * 0.16)
            Circle().frame(width: width * 0.38).offset(x: width * 0.18, y: -width * 0.1)
        }
        .foregroundStyle(Color.white.opacity(0.92))
    }

    // MARK: - 자명종 캐릭터

    private var clock: some View {
        ZStack {
            Circle()
                .fill(LinearGradient(colors: [orangeTop, orangeBottom], startPoint: .top, endPoint: .bottom))
                .overlay(Circle().strokeBorder(outline, lineWidth: 26))
                .frame(width: 540, height: 540)
            // 윗부분 반짝임
            Ellipse()
                .fill(Color.white.opacity(0.35))
                .frame(width: 220, height: 70)
                .rotationEffect(.degrees(-20))
                .offset(x: -110, y: -190)
            // 얼굴판
            Circle()
                .fill(Color(red: 1.0, green: 0.97, blue: 0.88))
                .overlay(Circle().strokeBorder(Color(red: 0.92, green: 0.78, blue: 0.58), lineWidth: 8))
                .frame(width: 400, height: 400)
            // 12·3·6·9 눈금
            ForEach(0..<4, id: \.self) { i in
                Circle()
                    .fill(outline)
                    .frame(width: 28, height: 28)
                    .offset(y: -160)
                    .rotationEffect(.degrees(Double(i) * 90))
            }
            // 얼굴
            eye.offset(x: -72, y: -10)
            eye.offset(x: 72, y: -10)
            Ellipse().fill(Color(red: 1.0, green: 0.45, blue: 0.5).opacity(0.55))
                .frame(width: 70, height: 34).offset(x: -125, y: 52)
            Ellipse().fill(Color(red: 1.0, green: 0.45, blue: 0.5).opacity(0.55))
                .frame(width: 70, height: 34).offset(x: 125, y: 52)
            smile.offset(y: 40)
        }
    }

    private var eye: some View {
        ZStack {
            Capsule().fill(outline).frame(width: 42, height: 66)
            Circle().fill(Color.white).frame(width: 16, height: 16).offset(x: 7, y: -14)
        }
    }

    private var smile: some View {
        Path { p in
            p.addArc(center: .zero, radius: 34, startAngle: .degrees(20), endAngle: .degrees(160), clockwise: false)
        }
        .stroke(outline, style: StrokeStyle(lineWidth: 13, lineCap: .round))
        .frame(width: 0, height: 0)
    }

    private var bell: some View {
        Circle()
            .fill(LinearGradient(colors: [orangeTop, orangeBottom], startPoint: .top, endPoint: .bottom))
            .overlay(Circle().strokeBorder(outline, lineWidth: 20))
            .frame(width: 150, height: 150)
    }

    private var leg: some View {
        Capsule()
            .fill(outline)
            .frame(width: 34, height: 90)
    }

    private var sprout: some View {
        ZStack {
            Capsule().fill(Color(red: 0.25, green: 0.55, blue: 0.18)).frame(width: 16, height: 70).offset(y: 30)
            leaf.rotationEffect(.degrees(-35)).offset(x: -42, y: -6)
            leaf.rotationEffect(.degrees(35)).offset(x: 42, y: -6)
        }
    }

    private var leaf: some View {
        Ellipse()
            .fill(LinearGradient(
                colors: [Color(red: 0.6, green: 0.9, blue: 0.35), Color(red: 0.3, green: 0.68, blue: 0.2)],
                startPoint: .top, endPoint: .bottom
            ))
            .overlay(Ellipse().strokeBorder(Color(red: 0.2, green: 0.42, blue: 0.12), lineWidth: 8))
            .frame(width: 92, height: 52)
    }

    // MARK: - EXP 막대

    private var expBar: some View {
        ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: 18).fill(Color(white: 0.82))
            RoundedRectangle(cornerRadius: 18)
                .fill(LinearGradient(
                    colors: [Color(red: 0.98, green: 1.0, blue: 0.55), Color(red: 0.93, green: 0.97, blue: 0.07),
                             Color(red: 0.6, green: 0.66, blue: 0.0)],
                    startPoint: .top, endPoint: .bottom
                ))
                .frame(width: 560 * 0.7)
            RoundedRectangle(cornerRadius: 18).strokeBorder(outline, lineWidth: 12)
        }
        .frame(width: 560, height: 70)
    }
}

/// `ScheduleTimer --render-icon <폴더>`: 크기별 아이콘 PNG를 .iconset 형식으로 저장
@MainActor
enum IconRenderer {
    static func render(to directory: String) {
        let folder = URL(fileURLWithPath: directory, isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        for size in [16, 32, 128, 256, 512] {
            for multiplier in [1, 2] {
                let pixels = size * multiplier
                let renderer = ImageRenderer(content: AppIconView())
                renderer.scale = CGFloat(pixels) / 1024
                guard let cg = renderer.cgImage,
                      let png = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])
                else { continue }
                let name = multiplier == 1 ? "icon_\(size)x\(size).png" : "icon_\(size)x\(size)@2x.png"
                try? png.write(to: folder.appendingPathComponent(name))
            }
        }
    }
}
