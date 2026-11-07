import { Component } from "react"
import { useTranslation } from "react-i18next"
import { useLocation } from "react-router-dom"
import { RefreshCw } from "lucide-react"
import { Button } from "./ui/button"

function ErrorFallback() {
    const { t } = useTranslation()
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-24 text-center">
            <h2 className="text-lg font-semibold">{t("errorBoundary.title")}</h2>
            <p className="max-w-sm text-sm text-muted-foreground">{t("errorBoundary.description")}</p>
            <Button onClick={() => window.location.reload()}>
                <RefreshCw data-icon="inline-start" />
                {t("errorBoundary.reload")}
            </Button>
        </div>
    )
}

// What a page that failed to draw (or to load) shows instead of taking the
// whole app down to an empty screen. `resetKey` (the path) clears it, so
// going to another page tries again.
class AppErrorBoundary extends Component {
    state = { failed: false, key: this.props.resetKey }

    static getDerivedStateFromError() {
        return { failed: true }
    }

    static getDerivedStateFromProps(props, state) {
        return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null
    }

    componentDidCatch(error) {
        console.error("A page failed:", error)
    }

    render() {
        return this.state.failed ? <ErrorFallback /> : this.props.children
    }
}

// The boundary for what the router draws, cleared on every change of page.
export function PageErrorBoundary({ children }) {
    const { pathname } = useLocation()
    return <AppErrorBoundary resetKey={pathname}>{children}</AppErrorBoundary>
}

export default AppErrorBoundary
