import LinkQuality from "@/components/bins/LinkQuality"
import { format, formatDistanceToNow } from "date-fns"
import { he } from "date-fns/locale"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import Battery from "@/components/bins/Battary"
import { getColor, getFullness, isGateway } from "@/utils/binHelpers"
import { useBinAnalytics } from "@/hooks/analytics/useBinAnalytics"
import { useThresholds } from "@/hooks/useThresholds"

function StatTile({ title, value, children }) {
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardDescription>{title}</CardDescription>
                <CardTitle className="flex items-center gap-2 text-2xl tabular-nums">{value}</CardTitle>
            </CardHeader>
            {children && <CardContent className="flex flex-col gap-1 text-xs text-muted-foreground">{children}</CardContent>}
        </Card>
    )
}

// How fast the bin fills since it was last emptied, and when it will need
// collecting (the critical fullness).
function FillForecast({ bin }) {
    const { t, i18n } = useTranslation()
    const { data } = useBinAnalytics(bin._id, "fill-rate")
    if (!data?.applicable) return null
    if (data.fullness >= data.criticalPercent) return <span>{t('pages.binDetails.tiles.collectNow')}</span>
    if (data.ratePerDay === null) return <span>{t('pages.binDetails.tiles.fillRateUnknown')}</span>
    if (!(data.ratePerDay > 0) || !data.collectionDueAt) return <span>{t('pages.binDetails.tiles.notFilling')}</span>
    return (
        <span>
            {t('pages.binDetails.tiles.fillRate', {
                rate: data.ratePerDay.toFixed(1),
                when: formatDistanceToNow(new Date(data.collectionDueAt), { addSuffix: true, locale: i18n.language === 'he' ? he : undefined }),
            })}
        </span>
    )
}

// The bin's state at a glance, four tiles for the page's grid: fill level (or,
// for a gateway, the bins it serves), battery, last report and how it reaches
// the server.
function BinStatTiles({ bin }) {
    const { t, i18n } = useTranslation()
    const { thresholdsFor } = useThresholds()
    const gateway = isGateway(bin)
    const { level, levelValid, battery, updatedAt, connection } = bin.status
    const leaves = bin.connectedLeaves ?? []
    const viaMesh = connection?.via === "mesh"
    // With a working scale the tile shows the combined fullness and its parts.
    const fullness = getFullness(bin.status)
    const hasWeight = fullness.weightPercent !== null
    const shown = hasWeight ? fullness.combined : level

    return (
        <>
            {gateway ? (
                <StatTile title={t('components.binCard.connectedLeaves')} value={leaves.length} />
            ) : (
                <StatTile
                    title={hasWeight ? t('pages.binDetails.tiles.fullness') : t('fillLevel')}
                    value={levelValid === false ? t('sensorUnavailable') : `${shown}%`}
                >
                    {levelValid !== false && (
                        <div className="h-2 w-full rounded-full bg-muted">
                            <div
                                className="h-full rounded-full"
                                style={{ width: `${Math.min(100, Math.max(0, shown))}%`, backgroundColor: getColor(bin.status, 'fill', thresholdsFor(bin.ownerId)) }}
                            />
                        </div>
                    )}
                    {hasWeight && levelValid !== false && (
                        <span>{t('pages.binDetails.tiles.levelPart', { percent: fullness.level })}</span>
                    )}
                    {hasWeight && (
                        <span>{t('pages.binDetails.tiles.weight', { kg: bin.status.weight.toFixed(1) })}</span>
                    )}
                    {bin.status.scale === "uncalibrated" && <span>{t('components.binCard.scaleUncalibrated')}</span>}
                    {bin.status.scale === "failed" && <span>{t('components.binCard.scaleFailed')}</span>}
                    {levelValid !== false && <FillForecast bin={bin} />}
                </StatTile>
            )}

            <StatTile title={t('pages.binDetails.tiles.battery')} value={<><span>{battery}%</span><Battery level={battery} ownerId={bin.ownerId} /></>} />

            <StatTile
                title={t('pages.binDetails.tiles.lastReport')}
                value={updatedAt
                    ? formatDistanceToNow(new Date(updatedAt), { addSuffix: true, locale: i18n.language === 'he' ? he : undefined })
                    : t('pages.binDetails.tiles.never')}
            >
                {/* self-start: the LTR time sits at the start of the tile in both directions. */}
                {updatedAt && <span dir="ltr" className="self-start">{format(new Date(updatedAt), 'yyyy-MM-dd HH:mm:ss')}</span>}
                {bin.nextReportAt && (
                    <span>
                        {t('pages.binDetails.tiles.nextReport')}{" "}
                        <span dir="ltr">{format(new Date(bin.nextReportAt), 'yyyy-MM-dd HH:mm')}</span>
                    </span>
                )}
            </StatTile>

            <StatTile
                title={t('pages.binDetails.tiles.connection')}
                value={viaMesh ? t('pages.binDetails.tiles.mesh') : t('pages.binDetails.tiles.cellular')}
            >
                {viaMesh && bin.gateway && (
                    <span>
                        {t('pages.binDetails.tiles.via')}{" "}
                        <Link to={`/bins/${bin.gateway._id}`} className="text-primary underline-offset-4 hover:underline">
                            {bin.gateway.binName}
                        </Link>
                    </span>
                )}
                {viaMesh && bin.relay && (
                    <span>
                        {t('pages.binDetails.tiles.viaRelay')}{" "}
                        <Link to={`/bins/${bin.relay._id}`} className="text-primary underline-offset-4 hover:underline">
                            {bin.relay.binName}
                        </Link>
                    </span>
                )}
                {viaMesh && (
                    <span className="flex flex-wrap items-center gap-x-1">
                        <span dir="ltr">{connection.rssi ?? '-'} dBm</span> <LinkQuality rssi={connection.rssi} /> · {t('components.binCard.hops')}: {connection.hops ?? '-'}
                    </span>
                )}
                {/* A gateway's first tile already counts them. */}
                {leaves.length > 0 && !gateway && (
                    <span>{t('pages.binDetails.tiles.relaysFor', { count: leaves.length })}</span>
                )}
            </StatTile>
        </>
    )
}

export default BinStatTiles
