import { MathUtils } from "three"

// The landing page is one long scroll: `raw` is how far through it the visitor
// is (0..1, written by the page), `p` follows it smoothly (written by the
// scene, read by everything that animates).
export const story = { raw: 0, p: 0 }

export const clamp01 = x => Math.min(1, Math.max(0, x))
// The first stretch of the scroll is played faster, so the first thing happens
// within a flick of the wheel instead of after a screen of nothing.
const HEAD_RAW = 0.04, HEAD_P = 0.1
export const warp = raw => raw < HEAD_RAW ? raw * HEAD_P / HEAD_RAW : HEAD_P + (raw - HEAD_RAW) * (1 - HEAD_P) / (1 - HEAD_RAW)
export const unwarp = p => p < HEAD_P ? p * HEAD_RAW / HEAD_P : HEAD_RAW + (p - HEAD_P) * (1 - HEAD_RAW) / (1 - HEAD_P)
export const ease = t => t * t * (3 - 2 * t)
// 0 before a, 1 after b, eased in between.
export const seg = (p, a, b) => ease(clamp01((p - a) / (b - a)))

// Where each chapter begins, and which side of the screen its text takes
// (the 3D scene sits on the other one).
export const CHAPTERS = [
    { key: "hero", from: 0, side: "start" },
    { key: "weigh", from: 0.12, side: "end" },
    { key: "measure", from: 0.33, side: "start" },
    { key: "report", from: 0.54, side: "end" },
    { key: "route", from: 0.73, side: "top" },
    { key: "lineup", from: 0.89, side: "top" },
]

export function chapterAt(p) {
    let index = 0
    CHAPTERS.forEach((chapter, i) => { if (p >= chapter.from) index = i })
    return index
}

// Camera: where it stands and looks at each point of the scroll, and how far
// the scene is pushed sideways (a share of the screen width, + is towards the
// end side) and up or down (`lift`, a share of the screen height) so it never
// sits behind the text.
const K = (p, pos, look, shift, lift = 0, phoneLift = 0.14) => ({ p, pos, look, shift, lift, phoneLift })
export const KEYS = [
    K(0.00, [-1.75, 1.2, 2.85], [0, 0.46, 0], 0.2, 0, 0.2),
    K(0.09, [-1.75, 1.2, 2.85], [0, 0.46, 0], 0.2, 0, 0.2),
    K(0.16, [-2.10, 1.65, 2.75], [0, 0.72, 0], -0.2),
    K(0.30, [-2.10, 1.65, 2.75], [0, 0.72, 0], -0.2),
    K(0.37, [2.60, 1.0, 2.30], [0, 0.46, 0], 0.2),
    K(0.50, [2.60, 1.0, 2.30], [0, 0.46, 0], 0.2),
    K(0.57, [0.25, 1.0, 5.0], [0, 1.1, 0], -0.2, 0, 0.27),
    K(0.70, [0.25, 1.0, 5.0], [0, 1.1, 0], -0.2, 0, 0.27),
    K(0.77, [0, 4.40, 6.60], [0, 0.10, 0], 0, -0.22, 0.1),
    K(0.86, [0, 4.40, 6.60], [0, 0.10, 0], 0, -0.22, 0.1),
    K(0.93, [0, 1.25, 5.10], [0, 0.55, 0], 0, -0.1, 0.1),
    K(1.00, [0, 1.25, 5.10], [0, 0.55, 0], 0, -0.1, 0.1),
]

export function cameraAt(p) {
    let i = 0
    while (i < KEYS.length - 2 && p > KEYS[i + 1].p) i++
    const a = KEYS[i], b = KEYS[i + 1]
    const t = seg(p, a.p, b.p)
    return {
        pos: a.pos.map((v, n) => MathUtils.lerp(v, b.pos[n], t)),
        look: a.look.map((v, n) => MathUtils.lerp(v, b.look[n], t)),
        shift: MathUtils.lerp(a.shift, b.shift, t),
        lift: MathUtils.lerp(a.lift, b.lift, t),
        phoneLift: MathUtils.lerp(a.phoneLift, b.phoneLift, t),
    }
}

// What the bin reads as the story goes on.
export const FILL_END = 0.73
export const WEIGHT_BAG = 18.4
export const WEIGHT_END = 46.8
export const fillAt = p => 0.12 * seg(p, 0.2, 0.24) + (FILL_END - 0.12) * seg(p, 0.34, 0.47)
export const weightAt = p => WEIGHT_BAG * seg(p, 0.2, 0.24) + (WEIGHT_END - WEIGHT_BAG) * seg(p, 0.34, 0.47)

export const fillColor = level => {
    const green = [0.35, 0.78, 0.26], amber = [0.96, 0.65, 0.14], red = [0.94, 0.27, 0.27]
    const t = level < 0.6 ? seg(level, 0.3, 0.6) : seg(level, 0.6, 0.9)
    const [from, to] = level < 0.6 ? [green, amber] : [amber, red]
    return from.map((v, n) => MathUtils.lerp(v, to[n], t))
}
