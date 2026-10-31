import { useMe } from "@/hooks/users/auth/useMe";
import { format } from "date-fns";
import { LoaderCircle, Send, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useAppSide } from "@/hooks/useAppSide";
import { cn } from "@/lib/utils";
import {
    useCancelInstruction,
    useDeviceInstructions,
    useEnqueueInstruction,
} from "@/hooks/bins/instructions/useDeviceInstructions";
import { isGateway } from "@/utils/binHelpers";
import { formatReportSchedule } from "@/utils/orgSettings";
import { INSTRUCTIONS_PAGE_SIZE as PAGE_SIZE, MAX_AWAKE_MINUTES, MAX_SCALE_GRAMS, MIN_SCALE_GRAMS } from "@/utils/constants";

const INSTRUCTION_TYPES = ["report_now", "stay_awake", "calibrate_empty_bin", "calibrate_scale", "refresh_location", "become_leaf"];
// Commands that ask first: what each changes is not undone by the next report.
const CONFIRMED_TYPES = {
    calibrate_empty_bin: {
        title: "calibrationConfirmationTitle",
        description: "calibrationConfirmationDescription",
        action: "confirmCalibration",
    },
    become_leaf: {
        title: "becomeLeafConfirmationTitle",
        description: "becomeLeafConfirmationDescription",
        action: "confirmBecomeLeaf",
    },
};
// Only a device with its own modem has an awake time to extend and a GPS.
const OWN_MODEM_TYPES = ["stay_awake", "refresh_location"];
const CALIBRATION_TYPES = ["calibrate_empty_bin", "calibrate_scale"];
const DATE_FORMAT = "yyyy-MM-dd HH:mm";
// The last report to the second, as on the bin page's tile.
const REPORT_TIME_FORMAT = "yyyy-MM-dd HH:mm:ss";
const STATUS_VARIANTS = {
    pending: "pending",
    completed: "default",
    failed: "destructive",
    cancelled: "secondary",
};

// The device reports results as codes (and the server marks stale ones
// "expired"); unknown codes are shown as they are.
function formatResult(result, t) {
    const code = (key) => t(`components.deviceInstructions.results.${key}`, { defaultValue: key });
    // An empty-bin calibration also zeroes the scale, if there is one.
    const depth = /^empty_depth_mm_(\d+)(?:_(scale_\w+))?$/.exec(result) ??
        /^(empty_bin_calibration_failed)(?:_(scale_\w+))?$/.exec(result);
    if (depth) {
        const main = depth[1] === "empty_bin_calibration_failed"
            ? code(depth[1])
            : t("components.deviceInstructions.results.emptyDepth", { cm: Math.round(Number(depth[1]) / 10) });
        if (!depth[2]) return main;
        return `${main} · ${depth[2] === "scale_zeroed" ? code("scaleZeroed") : code(depth[2])}`;
    }
    const scale = /^scale_calibrated_(\d+)_reads_(-?\d+)$/.exec(result);
    if (scale) {
        return t("components.deviceInstructions.results.scaleCalibrated", { placed: scale[1], reads: scale[2] });
    }
    return code(result);
}

// Instructions for one device. They are queued on the server and delivered
// when the device next reports, so the card says when that will be.
function DeviceInstructions({ bin, className }) {
    const { t, i18n } = useTranslation();
    const { isRight } = useAppSide();
    // Calibration needs the A02 sensor: every bin has one, including a bin that
    // relays for leaves; only a gateway does not. A leaf reaches commands
    // through its gateway's ACK and has no awake time to extend, nor a GPS.
    const viaMesh = bin.status?.connection?.via === "mesh";
    // Only an owner, and only for a device with a device key of its own (it
    // registered with a SIM), can turn a gateway into a leaf; the server checks too.
    const { isOwner } = useMe();
    const instructionTypes = INSTRUCTION_TYPES.filter((type) =>
        !(isGateway(bin) && CALIBRATION_TYPES.includes(type)) && !(viaMesh && OWN_MODEM_TYPES.includes(type)) &&
        !(type === "become_leaf" && (bin.meshOnly || !isOwner)));
    // The SIM may have been taken out on purpose: the owner can then make it a leaf.
    const hasNoSim = isOwner && !bin.meshOnly && (bin.status?.faults ?? []).some((fault) => fault.code === "sim_missing");
    const [instructionType, setInstructionType] = useState(instructionTypes[0]);
    const [durationMinutes, setDurationMinutes] = useState("5");
    const [scaleGrams, setScaleGrams] = useState("1000");
    const [confirmingType, setConfirmingType] = useState(null);
    const confirmation = CONFIRMED_TYPES[confirmingType];
    const [page, setPage] = useState(0);

    const { instructions, isLoadingInstructions, instructionsError } = useDeviceInstructions(bin._id);
    const { enqueueInstruction, isEnqueuing } = useEnqueueInstruction(bin._id);
    const { cancelInstruction, isCancelling } = useCancelInstruction(bin._id);

    // Older commands stay reachable (the server returns the latest 100), so a
    // pending one beyond the first page can still be cancelled.
    const pageCount = Math.max(1, Math.ceil(instructions.length / PAGE_SIZE));
    const currentPage = Math.min(page, pageCount - 1);
    const pageInstructions = instructions.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

    const duration = Number(durationMinutes);
    const durationInvalid = instructionType === "stay_awake" &&
        (!Number.isInteger(duration) || duration < 1 || duration > MAX_AWAKE_MINUTES);
    const grams = Number(scaleGrams);
    const gramsInvalid = instructionType === "calibrate_scale" &&
        (!Number.isInteger(grams) || grams < MIN_SCALE_GRAMS || grams > MAX_SCALE_GRAMS);

    const enqueueSelectedInstruction = () => enqueueInstruction({
        binId: bin._id,
        type: instructionType,
        durationMinutes: duration,
        grams,
    });

    return (
        // Sending on one side and what was sent on the other.
        <div className={cn("grid gap-4 lg:grid-cols-2", className)}>
            <Card>
                <CardHeader>
                    <CardTitle>{t("components.deviceInstructions.title")}</CardTitle>
                    <CardDescription className="flex flex-col gap-1">
                        <span className="block">
                            {t(viaMesh
                                ? "components.deviceInstructions.meshDeliveryNote"
                                : "components.deviceInstructions.deliveryNote")}
                        </span>
                        {bin.reportSchedule && (
                            <span className="block">
                                {t("components.deviceInstructions.schedule", {
                                    schedule: formatReportSchedule(
                                        bin.reportSchedule.reportIntervalMinutes,
                                        bin.reportSchedule.reportStartHour,
                                        t,
                                        i18n.language,
                                    ),
                                })}
                            </span>
                        )}
                        {bin.status?.updatedAt && (
                            <span className="block">
                                {t("components.deviceInstructions.lastReport")}{" "}
                                <span dir="ltr">{format(new Date(bin.status.updatedAt), REPORT_TIME_FORMAT)}</span>
                            </span>
                        )}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {hasNoSim && (
                        <p className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                            {t("components.deviceInstructions.noSimHint")}
                        </p>
                    )}
                    <div className="flex flex-col gap-2">
                        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                            <div className="flex flex-col gap-2 sm:w-72">
                                <label className="text-sm font-medium" htmlFor="instruction-type">
                                    {t("components.deviceInstructions.instruction")}
                                </label>
                                <Select value={instructionType} onValueChange={setInstructionType}>
                                    <SelectTrigger id="instruction-type" isRight={isRight}>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {instructionTypes.map((type) => (
                                            <SelectItem isRight={isRight} key={type} value={type}>
                                                {t(`components.deviceInstructions.types.${type}`)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {instructionType === "stay_awake" && (
                                <div className="flex flex-col gap-2">
                                    <label className="text-sm font-medium" htmlFor="awake-duration">
                                        {t("components.deviceInstructions.duration")}
                                    </label>
                                    <Input
                                        id="awake-duration"
                                        className="w-28"
                                        type="number"
                                        min={1}
                                        max={MAX_AWAKE_MINUTES}
                                        step={1}
                                        value={durationMinutes}
                                        onChange={(event) => setDurationMinutes(event.target.value)}
                                    />
                                </div>
                            )}

                            {instructionType === "calibrate_scale" && (
                                <div className="flex flex-col gap-2">
                                    <label className="text-sm font-medium" htmlFor="scale-grams">
                                        {t("components.deviceInstructions.scaleGrams")}
                                    </label>
                                    <Input
                                        id="scale-grams"
                                        className="w-32"
                                        type="number"
                                        min={MIN_SCALE_GRAMS}
                                        max={MAX_SCALE_GRAMS}
                                        step={1}
                                        value={scaleGrams}
                                        onChange={(event) => setScaleGrams(event.target.value)}
                                    />
                                </div>
                            )}

                            <Button
                                type="button"
                                className="cursor-pointer self-start sm:self-auto"
                                disabled={isEnqueuing || durationInvalid || gramsInvalid}
                                onClick={() => {
                                    if (CONFIRMED_TYPES[instructionType]) {
                                        setConfirmingType(instructionType);
                                    } else {
                                        enqueueSelectedInstruction();
                                    }
                                }}
                            >
                                {isEnqueuing ? <LoaderCircle className="animate-spin" /> : <Send />}
                                {t("components.deviceInstructions.send")}
                            </Button>
                        </div>
                        {instructionType === "stay_awake" && (
                            <p className="text-xs text-muted-foreground">
                                {t("components.deviceInstructions.durationLimit")}
                            </p>
                        )}
                        {instructionType === "calibrate_scale" && (
                            <p className="text-xs text-muted-foreground">
                                {t("components.deviceInstructions.scaleGramsLimit")}
                            </p>
                        )}
                    </div>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>{t("components.deviceInstructions.recentTitle")}</CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoadingInstructions ? (
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <LoaderCircle className="size-4 animate-spin" />
                            {t("loading")}
                        </div>
                    ) : instructionsError ? (
                        <p role="alert" className="text-sm text-destructive">
                            {instructionsError.message}
                        </p>
                    ) : instructions.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            {t("components.deviceInstructions.emptyQueue")}
                        </p>
                    ) : (
                        <ul className="divide-y">
                            {pageInstructions.map((instruction) => (
                                <li key={instruction._id} className="flex items-start justify-between gap-3 py-3">
                                    <div className="flex min-w-0 flex-col gap-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-sm font-medium">
                                                {t(`components.deviceInstructions.types.${instruction.type}`, {
                                                    defaultValue: instruction.type,
                                                })}
                                            </span>
                                            <Badge variant={STATUS_VARIANTS[instruction.status] ?? "secondary"}>
                                                {t(`components.deviceInstructions.statuses.${instruction.status}`)}
                                            </Badge>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            <span dir="ltr">{format(new Date(instruction.createdAt), DATE_FORMAT)}</span>
                                            {instruction.type === "stay_awake" &&
                                                Number.isInteger(instruction.payload?.durationSeconds) && (
                                                    <> · {t("components.deviceInstructions.durationValue", {
                                                        count: instruction.payload.durationSeconds / 60,
                                                    })}</>
                                                )}
                                            {instruction.type === "calibrate_scale" &&
                                                Number.isInteger(instruction.payload?.grams) && (
                                                    <> · {t("components.deviceInstructions.gramsValue", {
                                                        grams: instruction.payload.grams,
                                                    })}</>
                                                )}
                                        </p>
                                        {instruction.result && (
                                            <p className="text-xs text-muted-foreground">
                                                {formatResult(instruction.result, t)}
                                            </p>
                                        )}
                                    </div>
                                    {instruction.status === "pending" && (
                                        <Button
                                            type="button"
                                            variant="outline_destructive"
                                            size="sm"
                                            disabled={isCancelling}
                                            onClick={() => cancelInstruction({
                                                binId: bin._id,
                                                instructionId: instruction._id,
                                            })}
                                        >
                                            <X />
                                            {t("components.deviceInstructions.cancel")}
                                        </Button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                    {pageCount > 1 && (
                        <div className="flex items-center justify-between gap-2 pt-3">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={currentPage === 0}
                                onClick={() => setPage(currentPage - 1)}
                            >
                                {t("globalTable.previous")}
                            </Button>
                            <span className="text-sm text-muted-foreground">
                                {currentPage + 1} {t("globalTable.tablePage")} {pageCount}
                            </span>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={currentPage === pageCount - 1}
                                onClick={() => setPage(currentPage + 1)}
                            >
                                {t("globalTable.next")}
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>

            <AlertDialog open={Boolean(confirmation)} onOpenChange={(open) => !open && setConfirmingType(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {confirmation && t(`components.deviceInstructions.${confirmation.title}`)}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {confirmation && t(`components.deviceInstructions.${confirmation.description}`)}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(event) => {
                                event.preventDefault();
                                setConfirmingType(null);
                                enqueueSelectedInstruction();
                            }}
                        >
                            {confirmation && t(`components.deviceInstructions.${confirmation.action}`)}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

export default DeviceInstructions;
