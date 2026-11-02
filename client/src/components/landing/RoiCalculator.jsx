import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Slider } from "@/components/ui/slider"
import Reveal from "./Reveal"

// A number that counts up to its new value.
function Count({ value, prefix = "" }) {
    const [shown, setShown] = useState(value)
    const from = useRef(value)
    useEffect(() => {
        const start = performance.now(), begin = from.current
        let frame
        const step = now => {
            const t = Math.min(1, (now - start) / 600)
            const current = begin + (value - begin) * (1 - (1 - t) ** 3)
            from.current = current
            setShown(current)
            if (t < 1) frame = requestAnimationFrame(step)
        }
        frame = requestAnimationFrame(step)
        return () => cancelAnimationFrame(frame)
    }, [value])
    return <>{prefix}{Math.round(shown).toLocaleString()}</>
}

function Field({ label, value, onChange, suffix }) {
    return <label className="block">
        <span className="text-sm text-white/70">{label}</span>
        <div className="mt-1.5 flex items-center rounded-xl border border-white/15 bg-white/5 px-3 focus-within:border-primary">
            <input type="number" min="0" value={value} onChange={event => onChange(Math.max(0, Number(event.target.value) || 0))}
                className="w-full bg-transparent py-2.5 text-lg font-medium text-white outline-none" />
            {suffix && <span className="text-sm text-white/50">{suffix}</span>}
        </div>
    </label>
}

// What the visitor could save, from numbers they type in. The share of
// pickups that are unnecessary is theirs to set: it is an assumption, not a promise.
function RoiCalculator() {
    const { t, i18n } = useTranslation()
    const currency = i18n.language === "he" ? "₪" : "$"
    const [bins, setBins] = useState(200)
    const [pickups, setPickups] = useState(8)
    const [cost, setCost] = useState(i18n.language === "he" ? 40 : 12)
    const [share, setShare] = useState(25)

    const avoided = bins * pickups * share / 100
    const month = avoided * cost

    return <section className="relative px-6 py-24 md:px-10">
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 60% 60% at 50% 50%, #0f2a4a55 0%, transparent 70%)" }} />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2">
            <Reveal>
                <h2 className="text-3xl font-semibold tracking-tight md:text-5xl">{t("pages.landing.roi.title")}</h2>
                <p className="mt-4 text-lg text-white/65">{t("pages.landing.roi.text")}</p>
                <div className="mt-8 grid gap-4 sm:grid-cols-3">
                    <Field label={t("pages.landing.roi.bins")} value={bins} onChange={setBins} />
                    <Field label={t("pages.landing.roi.pickups")} value={pickups} onChange={setPickups} />
                    <Field label={t("pages.landing.roi.cost")} value={cost} onChange={setCost} suffix={currency} />
                </div>
                <div className="mt-7">
                    <div className="flex items-center justify-between text-sm text-white/70">
                        <span>{t("pages.landing.roi.share")}</span><span className="font-semibold text-white">{share}%</span>
                    </div>
                    <Slider className="mt-3" min={5} max={60} step={5} value={[share]} onValueChange={([value]) => setShare(value)} />
                </div>
            </Reveal>
            <Reveal delay={120}>
                <div className="rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/15 to-white/[0.03] p-8 shadow-2xl backdrop-blur-xl">
                    <p className="text-sm text-white/65">{t("pages.landing.roi.result")}</p>
                    <p className="mt-2 text-5xl font-semibold tabular-nums tracking-tight text-primary md:text-6xl"><Count value={month * 12} prefix={currency} /></p>
                    <p className="text-sm text-white/55">{t("pages.landing.roi.perYear")}</p>
                    <div className="mt-6 grid grid-cols-2 gap-4 border-t border-white/10 pt-6">
                        <div><p className="text-2xl font-semibold tabular-nums"><Count value={avoided} /></p><p className="text-xs text-white/55">{t("pages.landing.roi.avoided")}</p></div>
                        <div><p className="text-2xl font-semibold tabular-nums"><Count value={month} prefix={currency} /></p><p className="text-xs text-white/55">{t("pages.landing.roi.perMonth")}</p></div>
                    </div>
                    <p className="mt-6 text-xs leading-relaxed text-white/45">{t("pages.landing.roi.note")}</p>
                </div>
            </Reveal>
        </div>
    </section>
}

export default RoiCalculator
