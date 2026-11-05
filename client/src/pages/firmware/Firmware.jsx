import { useEffect } from "react"
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useAppSide } from "@/hooks/useAppSide"
import { useBreadcrumbs } from "@/hooks/useBreadcrumbs"
import { useMe } from "@/hooks/users/auth/useMe"
import { useOverviewSection } from "@/hooks/analytics/useOverviewSection"
import { formatDate } from "@/utils/helpers"
import SectionCard, { Muted } from "@/components/analytics/SectionCard"

const UNKNOWN_VERSION = "unknown"

function Header({ children }) {
    return <th className="py-2 pe-4 text-start text-xs font-medium text-muted-foreground">{children}</th>
}

// A row that opens the next level.
function RowLink({ to, children }) {
    const { isRight } = useAppSide()
    const navigate = useNavigate()
    const Arrow = isRight ? ChevronRight : ChevronLeft
    return (
        <tr className="cursor-pointer border-b last:border-0 hover:bg-muted/50" onClick={() => navigate(to)}>
            {children}
            <td className="py-2 text-end"><Arrow className="inline size-4 text-muted-foreground" /></td>
        </tr>
    )
}

function Tag({ tone, children }) {
    const tones = { behind: "bg-amber-500/15 text-amber-600", newest: "bg-emerald-500/15 text-emerald-600", muted: "text-muted-foreground" }
    return <span className={`rounded-full px-2 py-0.5 text-xs ${tones[tone]}`}>{children}</span>
}

// The firmware each device runs, down three levels: an owner's organizations,
// an organization's versions (an admin starts here, with their own), the
// devices on one version. The level is in the address (?organization=, ?version=).
function Firmware() {
    const { t } = useTranslation()
    const { isRight } = useAppSide()
    const { isOwner } = useMe()
    const [searchParams] = useSearchParams()
    const { pathname, search } = useLocation()
    const { setCustomBreadcrumbs } = useBreadcrumbs()
    const organization = isOwner ? searchParams.get("organization") : null
    const version = searchParams.get("version")
    const { data, isLoading, error } = useOverviewSection("firmware", {
        params: { ...(organization ? { organization } : {}), ...(version ? { version } : {}) },
    })
    const text = (key, values) => t(`pages.firmware.${key}`, values)
    const link = (next) => `/firmware?${new URLSearchParams(next)}`

    // Where the user is, in the navbar: each step a way back.
    const crumbs = [{ label: text("root"), path: "/firmware" }]
    if (data?.organization && isOwner) crumbs.push({ label: data.organization.name, path: link({ organization: data.organization._id }) })
    if (data?.level === "devices") crumbs.push({ label: version === UNKNOWN_VERSION ? text("unknown") : version, path: pathname + search })
    const crumbsKey = JSON.stringify(crumbs)
    useEffect(() => {
        if (data) setCustomBreadcrumbs(JSON.parse(crumbsKey))
    }, [crumbsKey, data, setCustomBreadcrumbs])

    const description = data?.level === "organizations" ? text("organizationsDescription", { newest: data.newest ?? "—" })
        : data?.level === "versions" ? text("versionsDescription")
            : data?.level === "devices" ? (version === UNKNOWN_VERSION ? text("devicesUnknownDescription") : text("devicesDescription", { version })) : null
    const lastReport = (at) => at ? formatDate(at, isRight, { dateStyle: "medium", timeStyle: "short" }) : text("never")

    return (
        <SectionCard
            title={text("title")}
            description={description}
            isLoading={isLoading}
            error={error}
        >
            {data?.level === "organizations" && (data.organizations.length === 0 ? <Muted>{text("none")}</Muted> : (
                <table className="w-full text-sm">
                    <thead><tr><Header>{text("columns.organization")}</Header><Header>{text("columns.devices")}</Header><Header>{text("columns.behind")}</Header><th /></tr></thead>
                    <tbody>
                        {data.organizations.map(org => (
                            <RowLink key={org._id} to={link({ organization: org._id })}>
                                <td className="py-2 pe-4 font-medium">{org.name}</td>
                                <td className="py-2 pe-4 tabular-nums">{org.devices}</td>
                                <td className="py-2 pe-4 tabular-nums">{org.behind > 0 ? <Tag tone="behind">{org.behind}</Tag> : 0}</td>
                            </RowLink>
                        ))}
                    </tbody>
                </table>
            ))}
            {data?.level === "versions" && (data.versions.length === 0 ? <Muted>{text("none")}</Muted> : (
                <table className="w-full text-sm">
                    <thead><tr><Header>{text("columns.version")}</Header><Header>{text("columns.devices")}</Header><Header>{text("columns.status")}</Header><th /></tr></thead>
                    <tbody>
                        {data.versions.map(row => (
                            <RowLink key={row.version ?? UNKNOWN_VERSION}
                                to={link({ ...(isOwner ? { organization: data.organization._id } : {}), version: row.version ?? UNKNOWN_VERSION })}>
                                <td className="py-2 pe-4 font-mono" dir="ltr">{row.version ?? text("unknown")}</td>
                                <td className="py-2 pe-4 tabular-nums">{row.devices}</td>
                                <td className="py-2 pe-4">
                                    {row.behind ? <Tag tone="behind">{text("behind")}</Tag>
                                        : row.version === data.newest ? <Tag tone="newest">{text("newest")}</Tag> : null}
                                </td>
                            </RowLink>
                        ))}
                    </tbody>
                </table>
            ))}
            {data?.level === "devices" && (data.devices.length === 0 ? <Muted>{text("none")}</Muted> : (
                <table className="w-full text-sm">
                    <thead><tr><Header>{text("columns.device")}</Header><Header>{text("columns.type")}</Header><Header>{text("columns.lastReport")}</Header></tr></thead>
                    <tbody>
                        {data.devices.map(device => (
                            <tr key={device._id} className="border-b last:border-0">
                                <td className="py-2 pe-4"><Link to={`/bins/${device._id}`} className="font-medium text-primary underline-offset-4 hover:underline">{device.name}</Link></td>
                                <td className="py-2 pe-4">{text(`kind.${device.kind === "gateway" ? "gateway" : "bin"}`)}</td>
                                <td className="py-2 pe-4">{lastReport(device.lastReportAt)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            ))}
        </SectionCard>
    )
}

export default Firmware
