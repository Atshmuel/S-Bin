import { useTranslation } from "react-i18next"
import { Bell, Gauge, LayoutDashboard, MapPin, Route, Scale } from "lucide-react"
import Reveal from "./Reveal"

const ITEMS = [
    { key: "weigh", icon: Scale },
    { key: "level", icon: Gauge },
    { key: "place", icon: MapPin },
    { key: "alert", icon: Bell },
    { key: "route", icon: Route },
    { key: "team", icon: LayoutDashboard },
]

function Benefits() {
    const { t } = useTranslation()
    return <section className="relative mx-auto max-w-6xl px-6 py-24 md:px-10">
        <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight md:text-5xl">{t("pages.landing.benefits.title")}</h2>
            <p className="mt-4 text-lg text-white/65">{t("pages.landing.benefits.text")}</p>
        </Reveal>
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ITEMS.map(({ key, icon: Icon }, i) => <Reveal key={key} delay={(i % 3) * 90}>
                <div className="group h-full rounded-2xl border border-white/10 bg-white/[0.04] p-6 transition duration-300 hover:-translate-y-1 hover:border-primary/50 hover:bg-white/[0.07]">
                    <span className="mb-4 flex size-11 items-center justify-center rounded-xl bg-primary/15 text-primary transition group-hover:bg-primary/25">
                        <Icon className="size-5" />
                    </span>
                    <h3 className="text-lg font-semibold">{t(`pages.landing.benefits.${key}.title`)}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-white/65">{t(`pages.landing.benefits.${key}.text`)}</p>
                </div>
            </Reveal>)}
        </div>
    </section>
}

export default Benefits
