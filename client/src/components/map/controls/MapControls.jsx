import { useEffect, useId, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import L from "leaflet"
import { Marker, Popup, useMap } from "react-leaflet"
import { SlidersHorizontal, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { MobileTooltip } from "@/components/ui/mobile-tooltip"
import { Separator } from "@/components/ui/separator"
import { useAppSide } from "@/hooks/useAppSide"
import { useMapSettings } from "@/hooks/useMapSettings"
import { USER_MARKER_MS } from "@/utils/constants"
import { createUserLocationIcon } from "@/utils/mapClusters"
import MapDisplayOptions from "./MapDisplayOptions"
import MapSearchForm from "./MapSearchForm"

const LOCATION_ERRORS = { 1: "locationDenied", 2: "locationUnavailable", 3: "locationTimeout" }
const USER_LOCATION_ICON = createUserLocationIcon()

// The map's actions behind a button in a corner: finding bins (where the page
// allows it) with the display options; MapKeyPanel explains the colors. One
// panel opens at a time. Routes are planned on the routes page.
function MapControls({ legendForm = false }) {
    const { t } = useTranslation()
    const map = useMap()
    const { isRight } = useAppSide()
    const { openPanel, setOpenPanel } = useMapSettings()
    const isOpen = openPanel === "controls"
    const panelId = useId()
    const panelRef = useRef(null)
    const [userMarker, setUserMarker] = useState(null)

    // Clicks, drags and scrolls in the panel (a slider, its list) stay off the map.
    useEffect(() => {
        if (!panelRef.current) return
        L.DomEvent.disableClickPropagation(panelRef.current)
        L.DomEvent.disableScrollPropagation(panelRef.current)
    }, [isOpen])

    useEffect(() => {
        if (!userMarker) return
        const timer = setTimeout(() => setUserMarker(null), USER_MARKER_MS)
        return () => clearTimeout(timer)
    }, [userMarker])

    function locateMe() {
        if (!navigator.geolocation) {
            toast.error(t("mapLegend.errors.gepError"))
            return
        }
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const location = { lat: position.coords.latitude, lng: position.coords.longitude }
                map.flyTo(location, 17)
                setUserMarker(location)
            },
            (error) => toast.error(t(`mapLegend.errors.${LOCATION_ERRORS[error.code] ?? "unknownError"}`)),
        )
    }

    return (
        // The column spans the map's height, so a panel scrolls inside it
        // instead of growing past the top. Its buttons keep to the right in
        // Hebrew too, where the column's end is its left.
        <div className={`pointer-events-none absolute top-8 right-2 bottom-2 z-[400] flex flex-col justify-end gap-2 ${isRight ? "items-end" : "items-start"}`}>
            {isOpen && (
                <div id={panelId} ref={panelRef}
                    className="pointer-events-auto flex min-h-0 w-72 max-w-[calc(100vw-3rem)] flex-col gap-4 overflow-y-auto rounded-lg border bg-background/95 p-4 text-foreground shadow-lg backdrop-blur">
                    {legendForm && (
                        <>
                            <MapSearchForm map={map} userMarker={userMarker} />
                            <Separator />
                        </>
                    )}
                    <MapDisplayOptions onLocate={locateMe} />
                </div>
            )}
            <div className="pointer-events-auto flex shrink-0 gap-2">
                <MobileTooltip content={t(openPanel === "controls" ? "mapLegend.close" : "mapLegend.openHint")}>
                    <Button type="button" size="icon" variant={openPanel === "controls" ? "default" : "secondary"} className="shadow-md"
                        aria-expanded={openPanel === "controls"} aria-controls={panelId}
                        aria-label={t(openPanel === "controls" ? "mapLegend.close" : "mapLegend.open")}
                        onClick={() => setOpenPanel(openPanel === "controls" ? null : "controls")}>
                        {openPanel === "controls" ? <X /> : <SlidersHorizontal />}
                    </Button>
                </MobileTooltip>
            </div>

            {userMarker && (
                <Marker position={userMarker} icon={USER_LOCATION_ICON}>
                    <Popup>{t("mapLegend.locations.youAreHere")}</Popup>
                </Marker>
            )}
        </div>
    )
}

export default MapControls
