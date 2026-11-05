import { useTranslation } from "react-i18next"
import { formatDistanceToNow } from "date-fns"
import { he } from "date-fns/locale"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import EmptyCard from "@/components/EmptyCard"
import LinkQuality from "@/components/bins/LinkQuality"

// The AXP2101's power-off source register, bit by bit (as the firmware reads it).
const PMU_OFF_BITS = Object.freeze(["pwronLow", "software", "pwronAlwaysLow", "vsysUnder", "vbusOver", "dcdcUnder", "dcdcOver", "dieOverTemp"])
// LTE-M signal strength (RSRP, dBm): good, fair, then weak.
const RSRP_GOOD = -90
const RSRP_FAIR = -105
const SIGNAL_VARIANTS = Object.freeze({ good: "active", fair: "pending", weak: "suspended" })

const known = value => value !== undefined && value !== null

// A latin unit after a number reads right only left to right, in Hebrew too.
const Measure = ({ children }) => <span dir="ltr">{children}</span>

function Row({ label, hint, children }) {
    return (
        <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
            <dt className="flex flex-col text-muted-foreground">
                {label}
                {hint && <span className="text-xs">{hint}</span>}
            </dt>
            <dd className="shrink-0 text-end font-medium tabular-nums">{children}</dd>
        </div>
    )
}

// One card of rows ([label, value, hint?]); one without any value is left out.
function Section({ title, rows }) {
    const shown = rows.filter(([, value]) => known(value))
    if (!shown.length) return null
    return (
        <Card>
            <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
            <CardContent>
                <dl className="divide-y">
                    {shown.map(([label, value, hint]) => <Row key={label} label={label} hint={hint}>{value}</Row>)}
                </dl>
            </CardContent>
        </Card>
    )
}

// The cards of what a device reported about itself: its firmware and why it
// restarted, power and temperatures, the cell, each stage's time, its sensors'
// samples and, for a leaf, its link to the gateway. Shared by the bin's latest
// diagnostics and a single log's.
export function DiagnosticsSections({ d }) {
    const { t, i18n } = useTranslation()
    const key = name => `pages.binDetails.diagnostics.${name}`
    const volts = mv => known(mv) ? <Measure>{(mv / 1000).toFixed(2)} V</Measure> : null
    const ms = value => known(value) ? `${(value / 1000).toFixed(1)} ${t(key("seconds"))}` : null
    const degrees = value => known(value) ? <Measure>{value}°C</Measure> : null
    const pmuOff = known(d.pmuOffSource)
        ? (PMU_OFF_BITS.filter((_, bit) => d.pmuOffSource & (1 << bit)).map(name => t(key(`pmuOff.${name}`))).join(", ") || t(key("none")))
        : null
    const signal = known(d.network?.rsrp) ? (d.network.rsrp >= RSRP_GOOD ? "good" : d.network.rsrp >= RSRP_FAIR ? "fair" : "weak") : null
    return (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Section title={t(key("sections.device"))} rows={[
                [t(key("fields.firmwareVersion")), d.firmwareVersion],
                [t(key("fields.resetReason")), d.resetReason && t(key(`resetReasons.${d.resetReason}`)), t(key("hints.resetReason"))],
                [t(key("fields.wakeCause")), d.wakeCause && t(key(`wakeCauses.${d.wakeCause}`)), t(key("hints.wakeCause"))],
                [t(key("fields.pmuOffSource")), pmuOff, t(key("hints.pmuOffSource"))],
            ]} />
            <Section title={t(key("sections.power"))} rows={[
                [t(key("fields.batteryMv")), volts(d.batteryMv)],
                [t(key("fields.vbusMv")), volts(d.vbusMv)],
                [t(key("fields.systemMv")), volts(d.systemMv)],
                [t(key("fields.charger")), d.charger && t(key(`chargers.${d.charger}`))],
                [t(key("fields.chipTempC")), degrees(d.chipTempC)],
                [t(key("fields.pmuTempC")), degrees(d.pmuTempC)],
            ]} />
            <Section title={t(key("sections.network"))} rows={[
                [t(key("fields.signal")), signal && <Badge variant={SIGNAL_VARIANTS[signal]}>{t(key(`signal.${signal}`))}</Badge>],
                [t(key("fields.rsrp")), known(d.network?.rsrp) ? <span dir="ltr">{d.network.rsrp} dBm</span> : null],
                [t(key("fields.rsrq")), known(d.network?.rsrq) ? <span dir="ltr">{d.network.rsrq} dB</span> : null],
                [t(key("fields.sinr")), known(d.network?.sinr) ? <span dir="ltr">{d.network.sinr} dB</span> : null],
                [t(key("fields.system")), d.network?.system],
                [t(key("fields.operator")), d.network?.operator && <span dir="ltr">{d.network.operator}</span>],
                [t(key("fields.band")), d.network?.band],
                [t(key("fields.cell")), known(d.network?.cellId) ? `${d.network.cellId}${known(d.network.tac) ? ` · TAC ${d.network.tac}` : ""}` : null],
                [t(key("fields.bytesSentLastCycle")), known(d.bytesSentLastCycle) ? d.bytesSentLastCycle.toLocaleString(i18n.language) : null],
            ]} />
            <Section title={t(key("sections.cycle"))} rows={[
                [t(key("fields.modemMs")), ms(d.stages?.modemMs)],
                [t(key("fields.networkMs")), ms(d.stages?.networkMs)],
                [t(key("fields.slotWaitMs")), ms(d.stages?.slotWaitMs)],
                [t(key("fields.mqttMs")), ms(d.stages?.mqttMs)],
                [t(key("fields.gpsMs")), ms(d.stages?.gpsMs)],
            ]} />
            <Section title={t(key("sections.sensors"))} rows={[
                [t(key("fields.distanceSamples")), known(d.distanceSamples) ? t(key("samplesOf"), { count: d.distanceSamples }) : null],
                [t(key("fields.distanceSpreadMm")), known(d.distanceSpreadMm) ? <Measure>{d.distanceSpreadMm} mm</Measure> : null],
                [t(key("fields.scaleRawCounts")), d.scaleRawCounts?.toLocaleString(i18n.language)],
                [t(key("fields.scaleZeroCounts")), d.scaleZeroCounts?.toLocaleString(i18n.language)],
                [t(key("fields.scaleSpreadCounts")), d.scaleSpreadCounts?.toLocaleString(i18n.language)],
            ]} />
            <Section title={t(key("sections.mesh"))} rows={[
                [t(key("fields.beaconRssi")), known(d.beaconRssi) ? <span className="flex items-center justify-end gap-2"><span dir="ltr">{d.beaconRssi} dBm</span> <LinkQuality rssi={d.beaconRssi} /></span> : null],
                [t(key("fields.guardSeconds")), known(d.guardSeconds) ? `${d.guardSeconds} ${t(key("seconds"))}` : null],
                [t(key("fields.missedCycles")), d.missedCycles],
                [t(key("fields.residualPpm")), known(d.residualPpm) ? <Measure>{d.residualPpm.toLocaleString(i18n.language)} ppm</Measure> : null],
            ]} />
        </div>
    )
}

// What the device last reported about itself (owners only), with its open issues.
function BinDiagnostics({ bin }) {
    const { t, i18n } = useTranslation()
    const d = bin.status?.diagnostics
    const key = name => `pages.binDetails.diagnostics.${name}`
    if (!d) {
        return <Card><EmptyCard title={t(key("emptyTitle"))} description={t(key("emptyDescription"))} /></Card>
    }
    const reportedAt = bin.status?.updatedAt
        ? formatDistanceToNow(new Date(bin.status.updatedAt), { addSuffix: true, locale: i18n.language === "he" ? he : undefined })
        : null

    const issues = bin.status?.issues ?? []
    const issueValue = issue => issue.type === "slow_cycle" ? Math.round(issue.value / 1000)
        : issue.type === "unexpected_restart" ? t(key(`resetReasons.${issue.value}`))
        : issue.value
    return (
        <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t(key("description"), { when: reportedAt ?? "-" })}</p>
            {issues.length > 0 && (
                <Card className="border-amber-500/60">
                    <CardHeader><CardTitle className="text-base">{t(key("issuesTitle"))}</CardTitle></CardHeader>
                    <CardContent>
                        <ul className="flex flex-col gap-2 text-sm">
                            {issues.map(issue => (
                                <li key={issue.type} className="flex flex-wrap items-center justify-between gap-2">
                                    <Badge variant="pending">{t(key(`issues.${issue.type}`), { value: issueValue(issue) })}</Badge>
                                    <span className="text-muted-foreground">
                                        {t(key("issueSince"), { when: formatDistanceToNow(new Date(issue.since), { locale: i18n.language === "he" ? he : undefined }) })}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </CardContent>
                </Card>
            )}
            <DiagnosticsSections d={d} />
        </div>
    )
}

export default BinDiagnostics
