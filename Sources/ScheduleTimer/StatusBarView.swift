import SwiftUI
import ScheduleCore

/// 빅뱅 전 메이플스토리 상태바를 흉내 낸 화면. 기준 크기 860×54, scale 배로 그림.
struct StatusBarView: View {
    let snapshot: StatusSnapshot
    let nickname: String
    let scale: CGFloat
    var onOpenSettings: () -> Void = {}
    /// HP(0)·MP(1)·EXP(2) 막대 클릭
    var onGaugeClick: (Int) -> Void = { _ in }
    var onDrag: (DragGesture.Value?) -> Void = { _ in }

    static let baseSize = CGSize(width: 860, height: 54)

    private func s(_ v: CGFloat) -> CGFloat { v * scale }

    var body: some View {
        HStack(spacing: s(3)) {
            levelSection.frame(width: s(108))
            nameSection.frame(width: s(236))
            gaugeSection
            settingsButton
        }
        .padding(s(4))
        .frame(width: s(Self.baseSize.width), height: s(Self.baseSize.height))
        .background(outerFrame)
        .grayscale(snapshot.gaveUp ? 1 : 0)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 1, coordinateSpace: .global)
                .onChanged { onDrag($0) }
                .onEnded { _ in onDrag(nil) }
        )
    }

    // MARK: - 바깥 틀

    private var outerFrame: some View {
        RoundedRectangle(cornerRadius: s(5))
            .fill(LinearGradient(
                stops: [
                    .init(color: Maple.frameTop, location: 0),
                    .init(color: Maple.frameUpper, location: 0.08),
                    .init(color: Maple.frameMid, location: 0.35),
                    .init(color: Maple.frameBottom, location: 1),
                ],
                startPoint: .top, endPoint: .bottom
            ))
            .overlay(
                RoundedRectangle(cornerRadius: s(5))
                    .strokeBorder(Maple.frameBorder, lineWidth: s(1))
            )
    }

    // MARK: - LV

    private var levelSection: some View {
        HStack(spacing: s(6)) {
            Text("LV.")
                .font(.system(size: s(22), weight: .heavy))
                .italic()
                .foregroundStyle(.white)
                .shadow(color: .black, radius: 0, x: s(1), y: s(1))
            HStack(spacing: s(1.5)) {
                ForEach(Array(String(snapshot.level).enumerated()), id: \.offset) { _, digit in
                    LevelDigit(digit: digit, scale: scale)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            RoundedRectangle(cornerRadius: s(3))
                .fill(Maple.levelBackground)
                .overlay(RoundedRectangle(cornerRadius: s(3)).strokeBorder(Color.black, lineWidth: s(1)))
        )
    }

    // MARK: - 이름 (지금 할 일 / 닉네임)

    private var nameSection: some View {
        VStack(alignment: .leading, spacing: s(2)) {
            Text(snapshot.title)
                .foregroundStyle(snapshot.phase == .inBlock ? Color.white : Maple.mutedText)
            Text(nickname)
                .foregroundStyle(.white)
        }
        .font(.system(size: s(14), weight: .medium))
        .lineLimit(1)
        .truncationMode(.tail)
        .padding(.horizontal, s(8))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: s(3))
                .fill(Maple.nameBackground)
                .overlay(RoundedRectangle(cornerRadius: s(3)).strokeBorder(Maple.panelBorder, lineWidth: s(1)))
        )
    }

    // MARK: - 돋보기 (설정 열기)

    private var settingsButton: some View {
        Button(action: onOpenSettings) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: s(13), weight: .bold))
                .foregroundStyle(Maple.buttonIcon)
                .frame(width: s(26), height: s(26))
                .background(
                    Circle().fill(LinearGradient(
                        colors: [Maple.buttonTop, Maple.buttonBottom],
                        startPoint: .top, endPoint: .bottom
                    ))
                )
                .overlay(Circle().strokeBorder(Maple.panelBorder, lineWidth: s(1)))
        }
        .buttonStyle(.plain)
        .help("설정 열기")
    }

    // MARK: - HP / MP / EXP

    private var gaugeSection: some View {
        HStack(spacing: s(8)) {
            Gauge(
                label: "HP",
                value: "[\(Format.hoursMinutes(snapshot.hpRemaining))/\(Format.hoursMinutes(snapshot.hpTotal))]",
                progress: snapshot.hpTotal > 0 ? snapshot.hpRemaining / snapshot.hpTotal : 0,
                colors: Maple.hp, scale: scale
            )
            .contentShape(Rectangle())
            .onTapGesture { onGaugeClick(0) }
            Gauge(
                label: "MP",
                value: "[\(snapshot.mpRemaining)/\(snapshot.mpTotal)]",
                progress: snapshot.mpTotal > 0 ? Double(snapshot.mpRemaining) / Double(snapshot.mpTotal) : 0,
                colors: Maple.mp, scale: scale
            )
            .contentShape(Rectangle())
            .onTapGesture { onGaugeClick(1) }
            Gauge(
                label: "EXP.",
                value: snapshot.expRemaining.map {
                    "\(Format.countdown($0))[\(Format.percent(snapshot.expProgress))]"
                } ?? "-",
                progress: snapshot.expProgress,
                colors: Maple.exp, scale: scale
            )
            .contentShape(Rectangle())
            .onTapGesture { onGaugeClick(2) }
        }
        .padding(.horizontal, s(8))
        .padding(.vertical, s(3))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            RoundedRectangle(cornerRadius: s(4))
                .fill(Maple.gaugePanel)
                .overlay(RoundedRectangle(cornerRadius: s(4)).strokeBorder(Maple.gaugePanelBorder, lineWidth: s(1.5)))
        )
    }
}

/// 주황색 타일 숫자 (LV)
private struct LevelDigit: View {
    let digit: Character
    let scale: CGFloat

    var body: some View {
        Text(String(digit))
            .font(.system(size: 17 * scale, weight: .black, design: .rounded))
            .foregroundStyle(Maple.levelDigitText)
            .frame(width: 16 * scale, height: 22 * scale)
            .background(
                RoundedRectangle(cornerRadius: 2 * scale)
                    .fill(LinearGradient(
                        colors: [Maple.levelDigitTop, Maple.levelDigitBottom],
                        startPoint: .top, endPoint: .bottom
                    ))
            )
            .overlay(RoundedRectangle(cornerRadius: 2 * scale).strokeBorder(Color.black.opacity(0.8), lineWidth: scale))
    }
}

/// 라벨 + [값] + 게이지 막대
private struct Gauge: View {
    let label: String
    let value: String
    let progress: Double
    let colors: [Color]
    let scale: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 2 * scale) {
            HStack(alignment: .firstTextBaseline, spacing: 3 * scale) {
                Text(label)
                    .font(.system(size: 14 * scale, weight: .heavy))
                    .foregroundStyle(.white)
                    .shadow(color: .black, radius: 0, x: scale, y: scale)
                Text(value)
                    .font(.system(size: 11 * scale, weight: .medium).monospacedDigit())
                    .foregroundStyle(Maple.valueText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            GeometryReader { geo in
                let clamped = min(1, max(0, progress))
                ZStack(alignment: .leading) {
                    // 빈 부분 (회색)
                    LinearGradient(colors: Maple.empty, startPoint: .top, endPoint: .bottom)
                    // 채워진 부분
                    LinearGradient(colors: colors, startPoint: .top, endPoint: .bottom)
                        .frame(width: geo.size.width * clamped)
                    // 위쪽 광택
                    VStack(spacing: 0) {
                        Color.white.opacity(0.35).frame(height: geo.size.height * 0.18)
                        Spacer(minLength: 0)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 2 * scale))
                .overlay(
                    RoundedRectangle(cornerRadius: 2 * scale)
                        .strokeBorder(Color.black.opacity(0.85), lineWidth: scale)
                )
            }
            .frame(height: 19 * scale)
        }
        .frame(maxWidth: .infinity)
    }
}

/// 참고 스크린샷에서 뽑은 색
enum Maple {
    static func hex(_ v: UInt32) -> Color {
        Color(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
    }

    static let frameTop = hex(0xbfd2d7)
    static let frameUpper = hex(0x707d83)
    static let frameMid = hex(0x4a4f55)
    static let frameBottom = hex(0x23282b)
    static let frameBorder = hex(0x1a1c1f)

    static let levelBackground = hex(0x0c0c0d)
    static let levelDigitTop = hex(0xd18445)
    static let levelDigitBottom = hex(0x7a2a05)
    static let levelDigitText = hex(0xffe7c2)

    static let nameBackground = hex(0x2a2e33)
    static let panelBorder = hex(0x5c6067)
    static let mutedText = hex(0xb8bcc0)

    static let buttonTop = hex(0xdfe6ea)
    static let buttonBottom = hex(0x8996a4)
    static let buttonIcon = hex(0x23282b)

    static let gaugePanel = hex(0x15100e)
    static let gaugePanelBorder = hex(0x8996a4)
    static let valueText = hex(0xe8ecd0)

    static let hp = [hex(0xff8a80), hex(0xef302f), hex(0xf00000), hex(0xc00708), hex(0x7b060a)]
    static let mp = [hex(0x8cc8ff), hex(0x3895f7), hex(0x0068ee), hex(0x0555c0), hex(0x003571)]
    static let exp = [hex(0xfbffb0), hex(0xf1fb31), hex(0xeff711), hex(0xdbe511), hex(0x879300)]
    static let empty = [hex(0xf6f5f6), hex(0xd6d2d2), hex(0xbebdbd), hex(0x9a9e9f), hex(0x646162)]
}
