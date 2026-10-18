import SwiftUI
import WZKit

/// 레벨업 이펙트 (임시: 코드로 그린 금색 LEVEL UP + 빛기둥 + 반짝이)
struct LevelUpView: View {
    static let duration: TimeInterval = 2.8
    static let baseSize = CGSize(width: 520, height: 260)

    let scale: CGFloat
    /// 이펙트 시작 시각. 미리보기 렌더링에서는 fixedElapsed 사용.
    var startDate = Date()
    var fixedElapsed: TimeInterval?

    var body: some View {
        if let fixedElapsed {
            effectFrame(elapsed: fixedElapsed)
        } else {
            TimelineView(.animation) { context in
                effectFrame(elapsed: context.date.timeIntervalSince(startDate))
            }
        }
    }

    private func effectFrame(elapsed t: TimeInterval) -> some View {
        let size = CGSize(width: Self.baseSize.width * scale, height: Self.baseSize.height * scale)
        // 0~0.25초: 커지며 등장, 이후 천천히 떠오름, 마지막 0.8초 동안 사라짐
        let appear = min(1, t / 0.25)
        let pop = appear < 1 ? 0.6 + 0.6 * appear : 1.2 - 0.2 * min(1, (t - 0.25) / 0.2)
        let fade = t > Self.duration - 0.8 ? max(0, (Self.duration - t) / 0.8) : 1
        let rise = CGFloat(t) * 14 * scale

        return ZStack {
            // 빛기둥
            LinearGradient(
                colors: [Color.yellow.opacity(0), Color(red: 1, green: 0.93, blue: 0.55).opacity(0.55), Color.yellow.opacity(0)],
                startPoint: .leading, endPoint: .trailing
            )
            .frame(width: size.width * 0.32, height: size.height)
            .mask(LinearGradient(colors: [.clear, .white, .white.opacity(0.6)], startPoint: .top, endPoint: .bottom))
            .opacity(min(1, t / 0.15) * fade)

            // 반짝이
            ForEach(0..<18, id: \.self) { i in
                sparkle(index: i, t: t, size: size)
            }

            // LEVEL UP 글자
            ZStack {
                levelUpText.foregroundStyle(Color(red: 0.35, green: 0.15, blue: 0))
                    .offset(x: 3 * scale, y: 3 * scale)
                levelUpText.foregroundStyle(
                    LinearGradient(
                        colors: [Color(red: 1, green: 1, blue: 0.85), Color(red: 1, green: 0.85, blue: 0.2), Color(red: 0.9, green: 0.5, blue: 0)],
                        startPoint: .top, endPoint: .bottom
                    )
                )
            }
            .shadow(color: Color.orange.opacity(0.9), radius: 10 * scale)
            .scaleEffect(pop)
            .offset(y: size.height * 0.08 - rise)
            .opacity(fade)
        }
        .frame(width: size.width, height: size.height)
    }

    private var levelUpText: some View {
        Text("LEVEL UP!")
            .font(.system(size: 64 * scale, weight: .black, design: .rounded))
            .italic()
    }

    private func sparkle(index i: Int, t: TimeInterval, size: CGSize) -> some View {
        // 각도·속도를 index로 고정해서 매 프레임 같은 궤적
        let angle = Double(i) / 18 * 2 * .pi + Double(i % 3) * 0.3
        let speed = 70 + Double((i * 37) % 60)
        let delay = Double(i % 6) * 0.08
        let local = max(0, t - delay)
        let distance = CGFloat(local * speed) * scale
        let alpha = local <= 0 ? 0 : max(0, 1 - local / (Self.duration - delay))
        return Image(systemName: "sparkle")
            .font(.system(size: CGFloat(10 + (i % 4) * 4) * scale))
            .foregroundStyle(i % 2 == 0 ? Color.yellow : Color.white)
            .offset(x: CGFloat(cos(angle)) * distance, y: CGFloat(sin(angle)) * distance * 0.6 + size.height * 0.08)
            .opacity(alpha)
    }
}

/// 화면에 그리기 좋게 프레임을 CGImage로 바꿔둔 애니메이션
struct PreparedAnimation {
    let images: [CGImage]
    let animation: FrameAnimation

    init?(_ animation: FrameAnimation) {
        let images = animation.frames.compactMap { $0.image.cgImage() }
        guard images.count == animation.frames.count else { return nil }
        self.images = images
        self.animation = animation
    }

    /// 기준점 기준 전체 영역 (원본 픽셀)
    var size: CGSize {
        let b = animation.bounds
        return CGSize(width: b.maxX - b.minX, height: b.maxY - b.minY)
    }

    var duration: TimeInterval { Double(animation.durationMs) / 1000 }
}

/// BasicEff.img의 LevelUp 프레임을 원본 그대로 재생 (기준점 고정, 픽셀 그대로 확대)
struct MapleLevelUpView: View {
    let prepared: PreparedAnimation
    let scale: CGFloat
    var startDate = Date()

    var body: some View {
        let b = prepared.animation.bounds
        TimelineView(.animation) { context in
            let ms = Int(context.date.timeIntervalSince(startDate) * 1000)
            ZStack(alignment: .topLeading) {
                if let i = prepared.animation.frameIndex(atMs: ms) {
                    let frame = prepared.animation.frames[i]
                    Image(decorative: prepared.images[i], scale: 1)
                        .interpolation(.none)
                        .resizable()
                        .frame(width: CGFloat(frame.image.width) * scale, height: CGFloat(frame.image.height) * scale)
                        .offset(x: CGFloat(-b.minX - frame.originX) * scale,
                                y: CGFloat(-b.minY - frame.originY) * scale)
                }
            }
            .frame(width: prepared.size.width * scale, height: prepared.size.height * scale, alignment: .topLeading)
        }
    }
}
