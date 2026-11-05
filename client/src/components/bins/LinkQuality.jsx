import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { MESH_RSSI_GOOD, MESH_RSSI_WEAK } from "@/utils/constants"

const VARIANTS = Object.freeze({ good: "active", fair: "pending", weak: "suspended" })

// How good a mesh link is, from the signal strength (RSSI, dBm) one device
// heard from another; nothing for a reading without one.
function linkQualityOf(rssi) {
    if (typeof rssi !== "number") return null
    return rssi >= MESH_RSSI_GOOD ? "good" : rssi >= MESH_RSSI_WEAK ? "fair" : "weak"
}

function LinkQuality({ rssi, className }) {
    const { t } = useTranslation()
    const quality = linkQualityOf(rssi)
    if (!quality) return null
    return <Badge variant={VARIANTS[quality]} className={className}>{t(`components.linkQuality.${quality}`)}</Badge>
}

export default LinkQuality
