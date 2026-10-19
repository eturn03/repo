import Foundation

/// WZ 애니메이션 (예: BasicEff.img의 LevelUp): 숫자 이름의 캔버스들 + 기준점(origin) + 프레임 시간(delay)
public struct FrameAnimation {
    public struct Frame {
        public let image: Bitmap
        /// 이미지 안에서 기준점(캐릭터 발밑) 위치
        public let originX: Int
        public let originY: Int
        public let delayMs: Int

        public init(image: Bitmap, originX: Int, originY: Int, delayMs: Int) {
            self.image = image
            self.originX = originX
            self.originY = originY
            self.delayMs = delayMs
        }
    }

    public let frames: [Frame]

    public init(frames: [Frame]) {
        self.frames = frames
    }

    /// node 아래 0, 1, 2… 캔버스를 순서대로 읽음. 프레임 시간이 없으면 defaultDelayMs.
    public init?(node: WZNode, defaultDelayMs: Int = 100) {
        self.init(root: node, path: "", defaultDelayMs: defaultDelayMs)
    }

    /// root 기준 path 아래 0, 1, 2… 프레임. 프레임이 다른 프레임을 가리키는 링크(UOL)여도 따라감.
    public init?(root: WZNode, path: String, defaultDelayMs: Int = 100) {
        var frames: [Frame] = []
        var index = 0
        let prefix = path.isEmpty ? "" : path + "/"
        while let canvas = root.node(at: "\(prefix)\(index)")?.canvas, let bitmap = try? canvas.bitmap() {
            var originX = 0, originY = 0
            if case .vector(let x, let y)? = canvas.children["origin"] { originX = x; originY = y }
            var delay = defaultDelayMs
            if case .int(let d)? = canvas.children["delay"], d > 0 { delay = d }
            frames.append(Frame(image: bitmap, originX: originX, originY: originY, delayMs: delay))
            index += 1
        }
        guard !frames.isEmpty else { return nil }
        self.frames = frames
    }

    public var durationMs: Int { frames.reduce(0) { $0 + $1.delayMs } }

    /// 좌우 뒤집은 애니메이션 (기준점도 같이 뒤집음)
    public func flipped() -> FrameAnimation {
        FrameAnimation(frames: frames.map {
            Frame(image: $0.image.flippedHorizontally(), originX: $0.image.width - $0.originX,
                  originY: $0.originY, delayMs: $0.delayMs)
        })
    }

    /// 기준점을 (0,0)으로 했을 때 모든 프레임을 감싸는 영역 (y는 아래로 +)
    public var bounds: (minX: Int, minY: Int, maxX: Int, maxY: Int) {
        (frames.map { -$0.originX }.min() ?? 0,
         frames.map { -$0.originY }.min() ?? 0,
         frames.map { $0.image.width - $0.originX }.max() ?? 0,
         frames.map { $0.image.height - $0.originY }.max() ?? 0)
    }

    /// 시작 후 ms 시점의 프레임 번호 (끝났으면 nil)
    public func frameIndex(atMs ms: Int) -> Int? {
        guard ms >= 0 else { return frames.isEmpty ? nil : 0 }
        var elapsed = 0
        for (i, frame) in frames.enumerated() {
            elapsed += frame.delayMs
            if ms < elapsed { return i }
        }
        return nil
    }
}
