import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useAppSide } from "@/hooks/useAppSide"
import { useOrganizations } from "@/hooks/organizations/useOrganizations"
import { useQuery } from "@tanstack/react-query"
import { createJoinCode, getMeshSettings } from "@/services/apiMeshSettings"
import { useMe } from "@/hooks/users/auth/useMe"
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, CircleCheck, Copy, Send, Info, KeyRound, ListChecks, LocateFixed, Smartphone } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import ErrorPage from "../generals/ErrorPage"

const TOTAL_STEPS = 4
const key = name => `pages.addBin.${name}`
const SETUP_PAGE_URL = "http://192.168.4.1/"
// A phone fix less precise than this (Wi-Fi or cell based) is worth retaking outdoors.
const COARSE_ACCURACY_M = 100

// The bin's location, from this phone's own location service (the installer
// stands next to the bin); it is never typed in. The device's setup page cannot
// ask the phone itself: it is plain http, where browsers do not give out the
// location, so it goes in the link that sets the device up. With location access already
// granted it is taken as soon as the wizard opens. Without it the device takes
// a GPS fix instead.
function BinLocation({ value, onChange, copied, onCopy }) {
    const { t } = useTranslation()
    const [locating, setLocating] = useState(false)

    const locate = () => {
        if (!navigator.geolocation) {
            toast.error(t(key("location.unsupported")))
            return
        }
        setLocating(true)
        navigator.geolocation.getCurrentPosition(
            ({ coords }) => {
                onChange({
                    text: `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`,
                    accuracy: Math.round(coords.accuracy),
                })
                setLocating(false)
            },
            () => {
                toast.error(t(key("location.failed")))
                setLocating(false)
            },
            { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
        )
    }
    useEffect(() => {
        navigator.permissions?.query({ name: "geolocation" })
            .then(status => { if (status.state === "granted") locate() })
            .catch(() => {})
        // Once, when the wizard opens.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const coarse = value && value.accuracy > COARSE_ACCURACY_M
    return (
        <div className="bg-muted p-4 rounded-lg space-y-2">
            <p className="font-medium text-sm">{t(key("location.title"))}</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex flex-1 items-center gap-2">
                    {value ? (
                        <code className="flex-1 bg-background p-3 rounded border text-sm font-mono" dir="ltr">{value.text}</code>
                    ) : (
                        <p className="flex-1 bg-background p-3 rounded border text-sm text-muted-foreground">{t(key("location.none"))}</p>
                    )}
                    <Button variant="outline" size="icon" onClick={onCopy} className="shrink-0" disabled={!value} aria-label={t(key("fields.copyLocation"))}>
                        {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                </div>
                <Button variant="outline" onClick={locate} disabled={locating} className="w-full shrink-0 sm:w-auto">
                    <LocateFixed className="h-4 w-4" />
                    {locating ? t(key("location.locating")) : t(key(value ? "location.again" : "location.useMine"))}
                </Button>
            </div>
            {value && (
                <p className={coarse ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                    {t(key(coarse ? "location.coarse" : "location.accuracy"), { meters: value.accuracy })}
                </p>
            )}
            <p className="text-xs text-muted-foreground">{t(key("location.hint"))}</p>
        </div>
    )
}

// One value the device's setup page asks for; a tap anywhere on it copies it.
function CopyField({ label, value, placeholder, copied, onCopy, copyLabel }) {
    return (
        <div className="space-y-1.5">
            <p className="font-medium text-sm">{label}:</p>
            <button type="button" onClick={onCopy} disabled={!value} aria-label={copyLabel}
                className="flex w-full items-center gap-2 rounded border bg-background p-3 text-start transition-colors hover:bg-accent disabled:cursor-default disabled:hover:bg-background">
                {value
                    ? <code className="flex-1 text-sm font-mono tracking-wide break-all" dir="ltr">{value}</code>
                    : <span className="flex-1 text-sm text-muted-foreground">{placeholder}</span>}
                {value && (copied ? <Check className="h-4 w-4 shrink-0 text-green-500" /> : <Copy className="h-4 w-4 shrink-0 text-muted-foreground" />)}
            </button>
        </div>
    )
}

function Checklist({ items }) {
    return (
        <ul className="space-y-2 text-sm text-muted-foreground">
            {items.map(item => (
                <li key={item} className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                    <span>{item}</span>
                </li>
            ))}
        </ul>
    )
}

function Note({ title, children, warning = false }) {
    const Icon = warning ? AlertTriangle : Info
    return (
        <Alert variant={warning ? "destructive" : "default"}>
            <Icon className="h-4 w-4" />
            <AlertTitle className="text-sm font-medium">{title}</AlertTitle>
            <AlertDescription className="text-sm">{children}</AlertDescription>
        </Alert>
    )
}

// The wizard's progress: one bar per step, those done and the current one lit.
function StepProgress({ current }) {
    return (
        <div className="flex gap-1.5" aria-hidden>
            {Array.from({ length: TOTAL_STEPS }, (_, index) => (
                <div key={index} className={`h-1.5 flex-1 rounded-full ${index < current ? "bg-primary" : "bg-muted"}`} />
            ))}
        </div>
    )
}

// A step of the wizard: its progress, title and what to do, with Back / Next.
// The page scrolls, not a box inside it; on a phone the buttons stay in a bar
// at the bottom of the screen, on a wider screen they end the card.
function Step({ number, icon: Icon, name, children, onBack, onNext, nextLabel, footer }) {
    const { t } = useTranslation()
    const { isRight } = useAppSide()
    const NextIcon = isRight ? ArrowRight : ArrowLeft
    const PrevIcon = isRight ? ArrowLeft : ArrowRight
    return (
        <section className="space-y-4 sm:rounded-xl sm:border sm:bg-card sm:p-6 sm:shadow-sm">
            <div className="space-y-2">
                <StepProgress current={number} />
                <div className="text-xs text-muted-foreground">{t(key("progress"), { current: number, total: TOTAL_STEPS })}</div>
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                    <Icon className="h-5 w-5" />
                    {t(key(`${name}.title`))}
                </h2>
                <p className="text-sm text-muted-foreground">{t(key(`${name}.description`))}</p>
            </div>
            <div className="space-y-4">{children}</div>
            <div className={`fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:pt-2 sm:backdrop-blur-none ${onBack ? "justify-between" : "justify-end"}`}>
                {onBack && (
                    <Button variant="outline" onClick={onBack}>
                        <PrevIcon className="h-4 w-4" />
                        {t(key("navigation.back"))}
                    </Button>
                )}
                {onNext && (
                    <Button onClick={onNext}>
                        {nextLabel}
                        <NextIcon className="h-4 w-4" />
                    </Button>
                )}
                {footer}
            </div>
        </section>
    )
}

// Adding a device: the bin joins an organization through its own setup page.
// A new device opens a Wi-Fi network of its own (only for this); a phone on it
// enters the organization's ID, registration code and (optionally) the bin's
// location; the device then restarts and works over cellular: it measures the
// empty bin, takes a GPS fix only when no location was given, registers and reports.
function AddBin() {
    const { me, isOwner } = useMe()
    const { isRight } = useAppSide()
    const { t } = useTranslation()

    const [step, setStep] = useState(1)
    const [showIntro, setShowIntro] = useState(false)
    const [copied, setCopied] = useState(null)
    const [selectedOrgId, setSelectedOrgId] = useState(null)
    const [binLocation, setBinLocation] = useState(null)
    const { data: organizations, isLoadingOrgs, orgsError } = useOrganizations()

    // Owners have no organization of their own, so they pick the one the bin belongs to.
    const ownerId = isOwner ? selectedOrgId : me?.org ?? null
    // The organization's registration code, entered with its ID in the device's setup.
    const { data: settings } = useQuery({ queryKey: ["mesh-settings"], queryFn: getMeshSettings })
    const registrationCode = settings?.organizations?.find(org => org._id === ownerId)?.registrationCode ?? null
    // A device without a SIM card (a mesh leaf) gets its mesh keys with a one-time
    // code made when this page opens for the organization; a device with a SIM
    // ignores it. Without one the link still sets a device up.
    const { data: joinCodeData } = useQuery({
        queryKey: ["join-code", ownerId],
        queryFn: () => createJoinCode(ownerId),
        enabled: Boolean(ownerId),
        staleTime: Infinity,
        gcTime: 0,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    })
    const joinCode = joinCodeData?.code ?? null
    const joinCodeText = joinCode ? joinCode.match(/.{8}/g).join("-") : null
    const waiting = ownerId ? t(key("stepOne.loading")) : t(key("stepOne.organizationRequired"))

    const copy = async (what, value) => {
        if (!value) return
        try {
            await navigator.clipboard.writeText(value)
            setCopied(what)
            toast.success(t(key(`toasts.${what}Copied`)))
            setTimeout(() => setCopied(null), 2000)
        } catch {
            toast.error(t(key("toasts.copyFailed")))
        }
    }
    // Opened on the phone while it is on the device's network, this link sets
    // the device up in one tap (an https page cannot send it in the background).
    const setupLink = ownerId && registrationCode
        ? `${SETUP_PAGE_URL}setup?${new URLSearchParams({ orgId: ownerId, code: registrationCode, ...(joinCode ? { join: joinCode } : {}), ...(binLocation ? { location: binLocation.text } : {}) })}`
        : null
    const fields = (
        <div className="bg-muted p-4 rounded-lg space-y-3">
            <CopyField label={t(key("fields.orgId"))} value={ownerId} placeholder={waiting}
                copied={copied === "orgId"} onCopy={() => copy("orgId", ownerId)} copyLabel={t(key("fields.copyOrgId"))} />
            <CopyField label={t(key("fields.code"))} value={registrationCode} placeholder={waiting}
                copied={copied === "code"} onCopy={() => copy("code", registrationCode)} copyLabel={t(key("fields.copyCode"))} />
            <CopyField label={t(key("fields.joinCode"))} value={joinCodeText} placeholder={waiting}
                copied={copied === "joinCode"} onCopy={() => copy("joinCode", joinCodeText)} copyLabel={t(key("fields.copyJoinCode"))} />
        </div>
    )
    // A new step starts at its top.
    const goTo = (number) => {
        setStep(number)
        window.scrollTo({ top: 0, behavior: "smooth" })
    }
    const next = () => goTo(Math.min(step + 1, TOTAL_STEPS))
    const back = () => goTo(Math.max(step - 1, 1))

    if (!ownerId && !isOwner) {
        return <ErrorPage code={t(key("noOrganization.code"))} description={t(key("noOrganization.description"))}
            buttonText={t(key("noOrganization.buttonText"))} navTo="/" />
    }
    return (
        // Room at the bottom on a phone for the bar with the step's buttons.
        <div className="mx-auto w-full max-w-2xl space-y-4 pb-24 sm:pb-0">
            {/* How it works, folded: on a phone it would push the step below the screen. */}
            <div className="rounded-lg border">
                <button type="button" onClick={() => setShowIntro(open => !open)} aria-expanded={showIntro}
                    className="flex w-full items-center gap-2 p-3 text-start text-sm font-medium">
                    <Info className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{t(key("intro.title"))}</span>
                    <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${showIntro ? "rotate-180" : ""}`} />
                </button>
                {showIntro && <p className="px-3 pb-3 text-sm text-muted-foreground">{t(key("intro.description"))}</p>}
            </div>
            {step === 1 && <Step number={1} icon={ListChecks} name="stepOne" onNext={next} nextLabel={t(key("navigation.ready"))}>
                {isOwner && (
                    <div className="space-y-2">
                        <p className="font-medium text-sm">{t(key("stepOne.organizationLabel"))}:</p>
                        {isLoadingOrgs ? <Skeleton className="w-full h-10" /> : (
                            <Select isRight={isRight} onValueChange={setSelectedOrgId} value={selectedOrgId ?? ""}>
                                <SelectTrigger isRight={isRight} className="bg-background">
                                    <SelectValue placeholder={t(key("stepOne.organizationPlaceholder"))} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        <SelectLabel isRight={isRight}>
                                            {orgsError ? t(key("stepOne.organizationError")) : t(key("stepOne.organizationLabel"))}
                                        </SelectLabel>
                                        <div className="max-h-52 overflow-y-auto">
                                            {!orgsError && organizations?.map(org => (
                                                <SelectItem isRight={isRight} className="truncate" key={org._id} value={org._id}>{org.name}</SelectItem>
                                            ))}
                                        </div>
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        )}
                    </div>
                )}
                <BinLocation value={binLocation} onChange={setBinLocation}
                    copied={copied === "location"} onCopy={() => copy("location", binLocation?.text)} />
                <div className="bg-muted p-4 rounded-lg space-y-3">
                    <p className="font-medium text-sm">{t(key("stepOne.checklistTitle"))}</p>
                    <Checklist items={["empty", "power", "sky", "phone", "scale"].map(item => t(key(`stepOne.checklist.${item}`)))} />
                </div>
            </Step>}

            {step === 2 && <Step number={2} icon={Smartphone} name="stepTwo" onBack={back} onNext={next} nextLabel={t(key("navigation.onSetupPage"))}>
                <div className="bg-muted p-4 rounded-lg">
                    <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                        {["powerOn", "joinNetwork", "openPage"].map(item => <li key={item}>{t(key(`stepTwo.steps.${item}`))}</li>)}
                    </ol>
                </div>
                <Note title={t(key("stepTwo.noInternetTitle"))}>{t(key("stepTwo.noInternetNote"))}</Note>
                <Note title={t(key("stepTwo.noNetworkTitle"))}>{t(key("stepTwo.noNetworkNote"))}</Note>
            </Step>}

            {step === 3 && <Step number={3} icon={KeyRound} name="stepThree" onBack={back} onNext={next} nextLabel={t(key("navigation.saved"))}>
                {setupLink && (
                    <div className="bg-primary/10 p-4 rounded-lg space-y-2">
                        <Button asChild className="w-full">
                            <a href={setupLink} target="_blank" rel="noreferrer">
                                <Send className="h-4 w-4" />
                                {t(key("stepThree.send"))}
                            </a>
                        </Button>
                        <p className="text-xs text-muted-foreground">{t(key("stepThree.sendHint"))}</p>
                        <p className={binLocation ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
                            {binLocation
                                ? <>{t(key("stepThree.withLocation"))} <span dir="ltr">{binLocation.text} (±{binLocation.accuracy} m)</span></>
                                : t(key("stepThree.withoutLocation"))}
                        </p>
                        <p className="text-xs text-muted-foreground">{t(key("stepThree.steps.restart"))}</p>
                    </div>
                )}
                <p className="text-sm text-muted-foreground">{t(key("stepThree.steps.enter"))}</p>
                {fields}
                <p className="text-xs text-muted-foreground">{t(key("stepThree.fieldsHint"))}</p>
                <p className="text-xs text-muted-foreground">{t(key("stepThree.joinHint"))}</p>
            </Step>}

            {step === 4 && <Step number={4} icon={CircleCheck} name="stepFour" onBack={back}
                footer={<Button asChild><Link to="/bins">{t(key("navigation.toBins"))}</Link></Button>}>
                <div className="bg-primary/10 p-4 rounded-lg space-y-3">
                    <p className="font-medium text-primary text-sm">{t(key("stepFour.whatHappens"))}</p>
                    <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                        {["cellular", "gps", "measure", "register"].map(item => <li key={item}>{t(key(`stepFour.steps.${item}`))}</li>)}
                    </ol>
                </div>
                <Note title={t(key("stepFour.timeTitle"))}>{t(key("stepFour.timeNote"))}</Note>
                <Note title={t(key("stepFour.calibrationTitle"))}>
                    <ul className="list-disc list-inside space-y-1">
                        {["how", "notEmpty", "redo", "scale"].map(item => <li key={item}>{t(key(`stepFour.calibration.${item}`))}</li>)}
                    </ul>
                </Note>
                <Note warning title={t(key("stepFour.troubleshootTitle"))}>
                    <ul className="list-disc list-inside space-y-1">
                        {["notListed", "noFix", "wrongDetails"].map(item => <li key={item}>{t(key(`stepFour.troubleshoot.${item}`))}</li>)}
                    </ul>
                </Note>
            </Step>}
        </div>
    )
}

export default AddBin
