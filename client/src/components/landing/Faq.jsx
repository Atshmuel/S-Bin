import { useTranslation } from "react-i18next"
import { ChevronDown } from "lucide-react"
import Reveal from "./Reveal"

const KEYS = ["existing", "measures", "connects", "team", "start"]

function Faq() {
    const { t } = useTranslation()
    return <section className="mx-auto max-w-3xl px-6 py-24 md:px-10">
        <Reveal><h2 className="text-center text-3xl font-semibold tracking-tight md:text-5xl">{t("pages.landing.faq.title")}</h2></Reveal>
        <div className="mt-12 space-y-3">
            {KEYS.map((key, i) => <Reveal key={key} delay={i * 60}>
                <details className="group rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-4 transition open:border-primary/40 open:bg-white/[0.07]">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-medium [&::-webkit-details-marker]:hidden">
                        {t(`pages.landing.faq.${key}.q`)}
                        <ChevronDown className="size-5 shrink-0 text-white/50 transition group-open:rotate-180" />
                    </summary>
                    <p className="mt-3 text-sm leading-relaxed text-white/65">{t(`pages.landing.faq.${key}.a`)}</p>
                </details>
            </Reveal>)}
        </div>
    </section>
}

export default Faq
