import { useTranslation } from "react-i18next"
import { FILL_END, WEIGHT_END } from "./story"

// What the bin's report looks like on the dashboard, for the "it reports on its own" chapter.
function BinCard() {
    const { t } = useTranslation()
    return <div className="mt-6 w-full max-w-sm rounded-2xl border border-white/15 bg-white/[0.06] p-4 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center justify-between">
            <div>
                <p className="text-sm font-semibold">{t("pages.landing.card.name")}</p>
                <p className="text-xs text-white/55">{t("pages.landing.card.street")}</p>
            </div>
            <span className="rounded-full bg-amber-400/15 px-2.5 py-0.5 text-xs font-medium text-amber-300">
                {t("pages.landing.card.status")}
            </span>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-primary via-amber-400 to-amber-400" style={{ width: `${FILL_END * 100}%` }} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div><p className="text-lg font-semibold tabular-nums">{Math.round(FILL_END * 100)}%</p><p className="text-[11px] text-white/50">{t("pages.landing.card.fill")}</p></div>
            <div><p className="text-lg font-semibold tabular-nums">{WEIGHT_END} kg</p><p className="text-[11px] text-white/50">{t("pages.landing.card.weight")}</p></div>
            <div><p className="text-lg font-semibold">{t("pages.landing.card.now")}</p><p className="text-[11px] text-white/50">{t("pages.landing.card.updated")}</p></div>
        </div>
    </div>
}

export default BinCard
