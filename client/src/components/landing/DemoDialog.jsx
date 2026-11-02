import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DEMO_EMAIL } from "@/utils/constants"
import { useAppSide } from "@/hooks/useAppSide"

// 16px text keeps a phone from zooming in when a field is focused.
const FIELD = "w-full rounded-md border border-input bg-input/30 px-3 text-base outline-none transition focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"

function Field({ label, id, ...props }) {
    return <label className="block text-sm" htmlFor={`demo-${id}`}>
        <span className="mb-1.5 block font-medium">{label}</span>
        <input id={`demo-${id}`} className={`${FIELD} h-11`} {...props} />
    </label>
}

// "Get a demo": the request is written for the visitor and opened in their
// mail app, addressed to DEMO_EMAIL.
function DemoDialog({ open, onOpenChange }) {
    const { t, i18n } = useTranslation()
    const { side, isRight } = useAppSide()
    const [form, setForm] = useState({ name: "", email: "", company: "", bins: "", message: "" })
    const set = key => event => setForm(current => ({ ...current, [key]: event.target.value }))

    function send(event) {
        event.preventDefault()
        const body = [
            `${t("pages.landing.demo.name")}: ${form.name}`,
            `${t("pages.landing.demo.email")}: ${form.email}`,
            `${t("pages.landing.demo.company")}: ${form.company}`,
            `${t("pages.landing.demo.bins")}: ${form.bins}`,
            "", form.message,
        ].join("\n")
        window.location.href = `mailto:${DEMO_EMAIL}?subject=${encodeURIComponent(t("pages.landing.demo.subject"))}&body=${encodeURIComponent(body)}`
        onOpenChange(false)
    }

    return <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent side={side} dir={i18n.language === "he" ? "rtl" : "ltr"} className="dark text-foreground max-h-[90svh] overflow-y-auto sm:max-w-md">
            <DialogHeader isRight={isRight} className="items-start text-start">
                <DialogTitle>{t("pages.landing.demo.title")}</DialogTitle>
                <DialogDescription isRight={!isRight}>{t("pages.landing.demo.text")}</DialogDescription>
            </DialogHeader>
            <form onSubmit={send} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="name" label={t("pages.landing.demo.name")} required value={form.name} onChange={set("name")} autoComplete="name" />
                    <Field id="email" label={t("pages.landing.demo.email")} type="email" required value={form.email} onChange={set("email")} autoComplete="email" dir="ltr" />
                    <Field id="company" label={t("pages.landing.demo.company")} value={form.company} onChange={set("company")} autoComplete="organization" />
                    <Field id="bins" label={t("pages.landing.demo.bins")} inputMode="numeric" value={form.bins} onChange={set("bins")} />
                </div>
                <label className="block text-sm">
                    <span className="mb-1.5 block font-medium">{t("pages.landing.demo.message")}</span>
                    <textarea rows={3} value={form.message} onChange={set("message")} className={`${FIELD} resize-none py-2`} />
                </label>
                <button type="submit" className="w-full rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:brightness-110">
                    {t("pages.landing.demo.send")}
                </button>
            </form>
        </DialogContent>
    </Dialog>
}

export default DemoDialog
