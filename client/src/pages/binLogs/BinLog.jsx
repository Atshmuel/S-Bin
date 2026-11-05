import BinCard from "@/components/bins/BinCard"
import LogCard from "@/components/bins/bin-logs/LogCard"
import LogDiagnostics from "@/components/bins/bin-logs/LogDiagnostics"
import CustomMarker from "@/components/map/CustomMarker"
import MapComponent from "@/components/map/MapComponent"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useMapSettings } from "@/hooks/useMapSettings"
import { useLog } from "@/hooks/bins/binLogs/useLog"
import { getColor, isGateway } from "@/utils/binHelpers"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { getDeviceRole, getDeviceRoleIcon } from "@/utils/deviceRoles"
import { Link, useParams } from "react-router-dom"
import ErrorPage from "../generals/ErrorPage"
import { useAppSide } from "@/hooks/useAppSide"
import { useTranslation } from "react-i18next"
import { toLatLng } from "@/utils/geo";
import BinPopupCard from "@/components/map/BinPopupCard"
import { useThresholds } from "@/hooks/useThresholds"
function BinLog() {
    const { mapContainerRef, scrollToMap } = useMapSettings();
    const { isRight } = useAppSide()
    const { t } = useTranslation()
    const { id } = useParams()
    const { log, isLoadingLog, logError } = useLog(id);
    const { thresholdsFor } = useThresholds()

    if (isLoadingLog) {
        return <div className="flex h-full w-full justify-center items-center">
            <Spinner className={'size-24'} />
        </div>
    }

    if (logError && !isLoadingLog) {
        return <ErrorPage />
    }
    const { bin } = log

    return (
        <div className="flex flex-col space-y-4 h-full">
            <Link to={`/bins/${log?.binId}`}>
                <Button className={'w-fit mb-2'} variant={'link'}> {isRight ? <ArrowLeft /> : <ArrowRight />}
                    {t("backToBin")}
                </Button>
            </Link>
            <div className="flex flex-wrap justify-start gap-4">
                <BinCard className="flex-1 min-w-xs" bin={bin} actions={false} handleLocationClick={() => scrollToMap(toLatLng(bin.location.coordinates))} isLoading={isLoadingLog} />
                <LogCard className="min-w-xs flex-1 h-fit" log={log} isLoading={isLoadingLog} />
            </div>
            <LogDiagnostics diagnostics={log.diagnostics} />
            <div ref={mapContainerRef} className="rounded-2xl overflow-hidden h-[450px]">
                <MapComponent zoom={14} center={toLatLng(bin.location.coordinates)} legend={true} >
                    <CustomMarker key={bin._id} icon={getDeviceRoleIcon(getDeviceRole(bin))} position={toLatLng(bin.location.coordinates)}
                        color={getColor(bin.status, isGateway(bin) ? 'battery' : 'fill', thresholdsFor(bin.ownerId))} popup={<BinPopupCard bin={bin} />} />
                </MapComponent>
            </div>
        </div>

    )
}

export default BinLog
