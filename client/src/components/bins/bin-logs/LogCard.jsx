import HealthBadge from "@/components/bins/HealthBadge"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../ui/card"
import { Activity, BatteryMedium, CalendarClock, GaugeCircle, InfoIcon, Trash2 } from "lucide-react"
import { Link } from "react-router-dom"
import Battery from "@/components/bins/Battary"
import EmptyCard from "@/components/EmptyCard"
import { Spinner } from "@/components/ui/spinner"
import { useTranslation } from "react-i18next"
import { useAppSide } from "@/hooks/useAppSide"
import { formatSleepDuration, formatDate } from "@/utils/helpers"
import { isGateway } from "@/utils/binHelpers"
import { useFaultText } from "@/hooks/useFaultText"
import LinkQuality from "@/components/bins/LinkQuality"

// A log reaching the server later than this after its reading shows when it arrived.
const LATE_RECEIVED_SECONDS = 60

function LogCard({ log, isLoading = true, ...props }) {
    const { t } = useTranslation()
    const faultText = useFaultText()
    const problem = log ? faultText(log.faults, log.message) : null
    const { isRight } = useAppSide()
    const isInfo = log?.severity === "info"
    const gateway = isGateway(log?.bin)
    const delaySeconds = log?.receivedAt ? Math.round((new Date(log.receivedAt) - new Date(log.createdAt)) / 1000) : 0
    const iconColor = isInfo ? 'oklch(0.723 0.219 149.579)' : 'oklch(0.577 0.245 27.325)'

    return (
        <Card {...props}>
            {isLoading ?
                <div className="flex h-full justify-center items-center">
                    <Spinner className={"size-24"} />
                </div>
                : log ?
                    <>

                        <CardHeader>
                            <CardTitle className="flex justify-between items-center">
                                <span>{t("components.logCard.log")} #{log._id} {t("components.logCard.details")}</span>
                                <InfoIcon color={iconColor} size={20} />
                            </CardTitle>
                            <CardDescription>
                                {t('types.' + log.type)} – {formatDate(log.createdAt, isRight)}
                            </CardDescription>
                        </CardHeader>

                        <CardContent className="space-y-4 text-sm">
                            <div className="flex justify-between">
                                <span className="font-medium flex items-center gap-2">
                                    <Trash2 size={16} /> {t("components.logCard.binId")}:
                                </span>
                                <span>{log.bin._id}</span>
                            </div>

                            {!gateway && <>
                                <div className="flex justify-between">
                                    <span className="font-medium flex items-center gap-2">
                                        <GaugeCircle size={16} /> {t("fillLevel")}:
                                    </span>
                                    <span>
                                        {log.oldLevel}% {isRight ? "→" : "←"} <b>{log.newLevel == null ? t("sensorUnavailable") : `${log.newLevel}%`}</b>
                                    </span>
                                </div>

                                <div className="flex justify-between">
                                    <span className="font-medium flex items-center gap-2">
                                        <Activity size={16} /> {t("components.logCard.weight")}:
                                    </span>
                                    <span>
                                        {typeof log.weight === 'number' ? `${log.weight.toFixed(1)} ${t("units.kg")}` : '-'}
                                    </span>
                                </div>
                            </>}

                            <div className="flex justify-between">
                                <span className="font-medium flex items-center gap-2">
                                    <Activity size={16} /> {t("healthStatus")}:
                                </span>
                                <HealthBadge health={log.health} faults={log.faults} message={log.message} />
                            </div>

                            <div className="flex justify-between">
                                <span className="font-medium flex items-center gap-2">
                                    <CalendarClock size={16} /> {t("components.logCard.timestamp")}:
                                </span>
                                <span>
                                    {formatDate(log.createdAt, isRight, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                </span>
                            </div>

                            {/* A reading can wait (a leaf's, queued or relayed) before it reaches the server. */}
                            {delaySeconds >= LATE_RECEIVED_SECONDS && (
                                <div className="flex justify-between">
                                    <span className="font-medium flex items-center gap-2">
                                        <CalendarClock size={16} /> {t("components.logCard.received")}:
                                    </span>
                                    <span>
                                        {formatDate(log.receivedAt, isRight, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                        {" "}({t("components.logCard.afterTaken", { time: formatSleepDuration(delaySeconds, t) })})
                                    </span>
                                </div>
                            )}

                            <div className="flex justify-between">
                                <span className="font-medium flex items-center gap-2">
                                    <BatteryMedium size={16} /> {t("components.logCard.battery")}:
                                </span>
                                <span className="flex items-center gap-2">
                                    <Battery level={log.battery} ownerId={log.bin?.ownerId} /> {log.battery}%
                                </span>
                            </div>

                            {log.connection && <>
                                <div className="flex justify-between">
                                    <span className="font-medium">{t("components.logCard.connection")}:</span>
                                    <span>{t("components.logCard." + log.connection)}</span>
                                </div>
                                {log.connection === "mesh" && <>
                                    {log.gateway && (
                                        <div className="flex justify-between">
                                            <span className="font-medium">{t("components.logCard.gateway")}:</span>
                                            <Link className="text-primary underline-offset-4 hover:underline" to={`/bins/${log.gateway._id}`}>{log.gateway.binName}</Link>
                                        </div>
                                    )}
                                    {log.relay && (
                                        <div className="flex justify-between">
                                            <span className="font-medium">{t("components.logCard.relay")}:</span>
                                            <Link className="text-primary underline-offset-4 hover:underline" to={`/bins/${log.relay._id}`}>{log.relay.binName}</Link>
                                        </div>
                                    )}
                                    {log.hops != null && (
                                        <div className="flex justify-between">
                                            <span className="font-medium">{t("components.binCard.hops")}:</span>
                                            <span>{log.hops === 1 ? t("components.logCard.direct") : t("components.logCard.hops", { count: log.hops })}</span>
                                        </div>
                                    )}
                                    {log.rssi != null && (
                                        <div className="flex justify-between">
                                            <span className="font-medium">{t("components.logCard.signal")}:</span>
                                            <span className="flex items-center gap-2"><span dir="ltr">{log.rssi} dBm</span> <LinkQuality rssi={log.rssi} /></span>
                                        </div>
                                    )}
                                </>}
                            </>}

                            {log.lastAwakeSeconds != null && (
                                <div className="flex justify-between">
                                    <span className="font-medium">{t("lastAwakeTime")}:</span>
                                    <span>{formatSleepDuration(log.lastAwakeSeconds, t)}</span>
                                </div>
                            )}

                            {problem &&
                                <div className="space-y-1">
                                    <span className="font-medium">{t("components.logCard.message")}:</span>
                                    <p>{problem}</p>
                                </div>
                            }

                            <div className="flex justify-between">
                                <span className="font-medium">{t("components.logCard.logSource")}:</span>
                                <span className="capitalize">{t("sources." + log.source)}</span>
                            </div>
                        </CardContent>
                    </> :
                    <EmptyCard title={t("components.logCard.errorCard")} description={t("components.logCard.errorDescription")} />
            }
        </Card>
    )
}

export default LogCard
