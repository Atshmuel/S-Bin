import { Component, lazy, Suspense, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ArrowRight, ChevronDown, Rotate3d } from "lucide-react"
import { useAppSide } from "@/hooks/useAppSide"
import BinCard from "@/components/landing/BinCard"
import Benefits from "@/components/landing/Benefits"
import RoiCalculator from "@/components/landing/RoiCalculator"
import Faq from "@/components/landing/Faq"
import DemoDialog from "@/components/landing/DemoDialog"
import { CHAPTERS, cameraAt, chapterAt, clamp01, story } from "@/components/landing/story"
import smallLogo from "@/assets/Sbin-small-logo.png"
import { APP_URL } from "@/utils/constants"

// three.js is only fetched when the landing page is opened.
const SbinScene = lazy(() => import("@/components/landing/SbinScene").then(m => ({ default: m.SbinScene })))

const GREEN = "var(--primary)"
const SHOWCASE_FOV = Math.tan((32 / 2) * Math.PI / 180)
const SHOWCASE_DISTANCE = 5.1
const SPREAD_WORLD = 1.3

// If the browser can't draw 3D the page still reads: the text carries it.
class SceneBoundary extends Component {
    state = { failed: false }
    static getDerivedStateFromError() { return { failed: true } }
    render() { return this.state.failed ? null : this.props.children }
}

function Panel({ chapter, index, active, children }) {
    const placement = {
        start: "md:items-center md:justify-start",
        end: "md:items-center md:justify-end",
        top: "md:items-start md:justify-center md:text-center",
    }[chapter.side]
    return <div aria-hidden={!active}
        className={`absolute inset-0 flex items-end justify-center px-6 pb-8 pt-24 transition-all duration-700 md:px-16 md:pb-10 ${placement}
            pointer-events-none ${active ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"}`}>
        <div className={`w-full max-w-md rounded-3xl max-md:bg-gradient-to-t max-md:from-[#070b12] max-md:via-[#070b12]/80 max-md:to-transparent max-md:px-1 max-md:pt-16 ${chapter.side === "top" ? "md:max-w-xl" : "md:max-w-[28rem]"}`}>
            {index > 0 && <p className="mb-3 text-sm font-medium tracking-widest" style={{ color: GREEN }}>{String(index).padStart(2, "0")}</p>}
            {children}
        </div>
    </div>
}

function Landing() {
    const { t, i18n } = useTranslation()
    const { toggleSide } = useAppSide()
    const isHebrew = i18n.language === "he"
    const stage = useRef(), glow = useRef()
    const [chapter, setChapter] = useState(0)
    const [demoOpen, setDemoOpen] = useState(false)
    const [inView, setInView] = useState(true)
    const [mobile, setMobile] = useState(() => window.innerWidth < 768)
    const [aspect, setAspect] = useState(() => window.innerWidth / window.innerHeight)
    const direction = isHebrew ? -1 : 1

    // The page is always dark, whatever the device prefers.
    useEffect(() => { document.title = "sBin"; document.body.classList.add("dark") }, [])

    // Scroll position -> how far through the story we are.
    useEffect(() => {
        let frame = 0
        const update = () => {
            frame = 0
            const el = stage.current
            if (!el) return
            const raw = clamp01(-el.getBoundingClientRect().top / (el.offsetHeight - window.innerHeight))
            story.raw = raw
            setChapter(chapterAt(raw))
            glow.current?.style.setProperty("--glow-x", `${50 + cameraAt(raw).shift * direction * 100}%`)
        }
        const onScroll = () => { if (!frame) frame = requestAnimationFrame(update) }
        const onResize = () => { setMobile(window.innerWidth < 768); setAspect(window.innerWidth / window.innerHeight); onScroll() }
        update()
        window.addEventListener("scroll", onScroll, { passive: true })
        window.addEventListener("resize", onResize)
        return () => {
            window.removeEventListener("scroll", onScroll)
            window.removeEventListener("resize", onResize)
            cancelAnimationFrame(frame)
        }
    }, [direction])

    // The 3D scene only draws while the story is on screen.
    useEffect(() => {
        const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin: "100px" })
        observer.observe(stage.current)
        return () => observer.disconnect()
    }, [])

    function goTo(index) {
        const el = stage.current
        const total = el.offsetHeight - window.innerHeight
        window.scrollTo({ top: el.offsetTop + total * (CHAPTERS[index].from + 0.005), behavior: "smooth" })
    }

    // Where the three models stand on screen in the line-up, so each label sits under its own.
    const spread = Math.min(1, Math.max(0.42, aspect / 1.7))
    const halfWidth = SHOWCASE_FOV * SHOWCASE_DISTANCE * aspect
    const offset = Math.min(46, 50 * SPREAD_WORLD * spread / halfWidth)
    const lineup = [
        { x: 50 - offset * direction, name: "bin" },
        { x: 50 + offset * direction, name: "device" },
    ]

    const labels = { weight: t("pages.landing.labels.weight"), fill: t("pages.landing.labels.fill"), live: t("pages.landing.labels.live") }
    const text = key => t(`pages.landing.${key}`)

    return <div dir={isHebrew ? "rtl" : "ltr"} className="min-h-screen bg-[#070b12] text-white antialiased">
        <header className="fixed inset-x-0 top-0 z-30 flex items-center justify-between px-5 py-4 md:px-10">
            <a href="/" className="flex items-center gap-2 text-lg font-semibold">
                <img src={smallLogo} alt="" className="h-7" />
                <span><span style={{ color: GREEN }}>s</span>Bin</span>
            </a>
            <nav className="flex items-center gap-2 md:gap-3">
                <button type="button" onClick={() => toggleSide(isHebrew ? "en" : "he")}
                    className="rounded-full px-3 py-1.5 text-sm text-white/70 transition hover:text-white">
                    {text("nav.language")}
                </button>
                <button type="button" onClick={() => setDemoOpen(true)} className="rounded-full px-4 py-1.5 text-sm font-semibold text-primary-foreground transition hover:brightness-110" style={{ background: GREEN }}>
                    {text("nav.demo")}
                </button>
            </nav>
        </header>

        <section ref={stage} className="relative h-[820vh]">
            <div className="sticky top-0 h-svh overflow-hidden">
                <div ref={glow} className="absolute inset-0"
                    style={{ background: "radial-gradient(ellipse 55% 60% at var(--glow-x, 70%) 52%, #14355f 0%, #0a1424 45%, #070b12 78%)" }} />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#070b12] to-transparent" />

                <SceneBoundary>
                    <Suspense fallback={null}>
                        <div className="absolute inset-0">
                            <SbinScene labels={labels} direction={direction} mobile={mobile} active={inView} />
                        </div>
                    </Suspense>
                </SceneBoundary>

                <Panel chapter={CHAPTERS[0]} index={0} active={chapter === 0}>
                    <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs tracking-wide text-white/75">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: GREEN }} />{text("hero.eyebrow")}
                    </p>
                    <h1 className="text-[2.2rem] font-semibold leading-[1.04] tracking-tight md:text-6xl">{text("hero.title")}</h1>
                    <p className="mt-4 text-[15px] leading-relaxed text-white/70 md:mt-5 md:text-lg">{text("hero.text")}</p>
                    <div className="pointer-events-auto mt-5 flex md:mt-7 flex-wrap items-center gap-3">
                        <button type="button" onClick={() => setDemoOpen(true)} className="group inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/40 transition hover:brightness-110" style={{ background: GREEN }}>
                            {text("hero.demo")}<ArrowRight className="size-4 transition group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
                        </button>
                        <button type="button" onClick={() => goTo(1)} className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3 text-sm font-medium text-white/85 transition hover:bg-white/10">
                            {text("hero.how")}
                        </button>
                    </div>
                </Panel>

                {["weigh", "measure", "report", "route"].map((key, i) =>
                    <Panel key={key} chapter={CHAPTERS[i + 1]} index={i + 1} active={chapter === i + 1}>
                        <h2 className="text-3xl font-semibold leading-tight tracking-tight md:text-5xl">{text(`${key}.title`)}</h2>
                        <p className="mt-4 text-base leading-relaxed text-white/70 md:text-lg">{text(`${key}.text`)}</p>
                        {key === "report" && <BinCard />}
                        {key === "route" && <div className="mt-5 space-y-2 md:hidden text-sm text-white/75 md:mx-auto md:w-fit md:text-start">
                            <p className="flex items-center gap-3"><span className="w-8 border-t-2 border-dashed border-slate-400" />{text("route.legendDefault")}</p>
                            <p className="flex items-center gap-3"><span className="w-8 border-t-2 border-dashed" style={{ borderColor: GREEN }} />{text("route.legendBest")}</p>
                        </div>}
                    </Panel>)}

                <Panel chapter={CHAPTERS[5]} index={5} active={chapter === 5}>
                    <h2 className="text-3xl font-semibold leading-tight tracking-tight md:text-5xl">{text("lineup.title")}</h2>
                    <p className="mt-4 text-base leading-relaxed text-white/70 md:text-lg">{text("lineup.text")}</p>
                    <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80">
                        <Rotate3d className="size-4" style={{ color: GREEN }} />{text("lineup.hint")}
                    </p>
                </Panel>

                <div className={`pointer-events-none absolute inset-x-0 bottom-8 hidden transition-all duration-700 md:block ${chapter === 5 ? "opacity-100" : "translate-y-4 opacity-0"}`}>
                    {lineup.map(({ x, name }) => <div key={name} className="absolute bottom-0 w-60 -translate-x-1/2 text-center" style={{ left: `${x}%` }}>
                        <p className="text-base font-semibold">{text(`labels.${name}`)}</p>
                        <p className="mt-1 text-sm text-white/60">{text(`labels.${name}Text`)}</p>
                    </div>)}
                </div>

                <div className={`pointer-events-none absolute inset-x-0 bottom-6 hidden justify-center transition-opacity duration-700 md:flex ${chapter === 4 ? "opacity-100" : "opacity-0"}`}>
                    <div className="space-y-1.5 rounded-2xl border border-white/10 bg-[#070b12]/70 px-5 py-3 text-sm text-white/80 backdrop-blur-md">
                        <p className="flex items-center gap-3"><span className="w-8 border-t-2 border-dashed border-slate-400" />{text("route.legendDefault")}</p>
                        <p className="flex items-center gap-3"><span className="w-8 border-t-2 border-dashed" style={{ borderColor: GREEN }} />{text("route.legendBest")}</p>
                    </div>
                </div>

                <div className={`absolute inset-x-0 bottom-5 hidden flex-col items-center md:flex gap-1 text-xs text-white/50 transition-opacity duration-500 ${chapter === 0 ? "opacity-100" : "opacity-0"}`}>
                    {text("hero.scroll")}<ChevronDown className="size-4 animate-bounce" />
                </div>

                <ol className="absolute end-5 top-1/2 hidden -translate-y-1/2 flex-col gap-3 md:flex">
                    {CHAPTERS.map((c, i) => <li key={c.key}>
                        <button type="button" aria-label={c.key} onClick={() => goTo(i)}
                            className="block h-2 w-2 rounded-full transition-all"
                            style={{ background: i === chapter ? GREEN : "rgba(255,255,255,.3)", transform: i === chapter ? "scale(1.5)" : "none" }} />
                    </li>)}
                </ol>
            </div>
        </section>

        <Benefits />
        <RoiCalculator />
        <Faq />

        <section className="relative flex min-h-[70vh] flex-col items-center justify-center overflow-hidden px-6 py-24 text-center">
            <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 60% 70% at 50% 100%, #14355f 0%, #070b12 70%)" }} />
            <div className="relative">
                <h2 className="mx-auto max-w-2xl text-4xl font-semibold leading-tight tracking-tight md:text-6xl">{text("cta.title")}</h2>
                <p className="mx-auto mt-5 max-w-xl text-lg text-white/70">{text("cta.text")}</p>
                <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                    <button type="button" onClick={() => setDemoOpen(true)} className="rounded-full px-7 py-3.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/40 transition hover:brightness-110" style={{ background: GREEN }}>{text("cta.demo")}</button>
                    <a href={`${APP_URL}/login`} className="rounded-full border border-white/20 px-7 py-3.5 text-sm font-medium text-white/85 transition hover:bg-white/10">{text("cta.login")}</a>
                </div>
            </div>
        </section>

        <DemoDialog open={demoOpen} onOpenChange={setDemoOpen} />

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-6 py-6 text-sm text-white/50 md:px-10">
            <span>© {new Date().getFullYear()} {text("footer.rights")}</span>
            <a href={`${APP_URL}/login`} className="transition hover:text-white">{text("nav.login")}</a>
        </footer>
    </div>
}

export default Landing
