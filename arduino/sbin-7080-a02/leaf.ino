#include "globals.h"
#include <SbinMeshLeaf.h>

// This device as a mesh leaf (no SIM): the wake, the schedule, the clock and
// the delivery are the SbinMesh leaf cycle's; this file gives it the bin's
// real measurements and commands. The modem stays off except for the monthly
// GPS fix (GNSS needs no SIM), taken after the readings went out.
//
// A leaf's mesh keys come, in this order, from the organization key it kept
// from being a gateway; from mesh_keys.h next to this sketch, made for this
// board by server/scripts/mesh-keys.mjs (a bench build only); from flash, where
// a JOIN left them; or from a JOIN, with the join code its setup page took
// (the add-device wizard makes it), asked of a gateway over the mesh.
#if __has_include("mesh_keys.h")
#include "mesh_keys.h"
#define SBIN_LEAF_HAS_KEYS 1
#else
#define SBIN_LEAF_HAS_KEYS 0
#endif

// Set by a gateway reporting through another one: why it cannot itself.
uint8_t leafFallbackFlags = 0;

namespace {
constexpr uint32_t NO_KEYS_RETRY_SLEEP_SECONDS = 15UL * 60UL;
constexpr uint32_t JOIN_REFUSED_RETRY_SLEEP_SECONDS = 60UL * 60UL;
// As long as a cold join: a gateway's window comes once a cycle.
constexpr uint32_t JOIN_LISTEN_MS = 13UL * 60UL * 60UL * 1000UL + 30UL * 60UL * 1000UL;
constexpr unsigned long LEAF_GPS_TIMEOUT_MS = 300000UL;
constexpr unsigned long LEAF_GPS_POLL_MS = 5000UL;
constexpr uint8_t CALIBRATION_ATTEMPTS = 2;

uint8_t leafScaleState(const DeviceReading& reading) {
    if (!scaleZeroSet) {
        return sbinmesh::SCALE_STATE_NONE;  // no scale answered at the empty-bin calibration
    }
    if (strcmp(reading.scaleState, "ok") == 0) {
        return sbinmesh::SCALE_STATE_OK;
    }
    return strcmp(reading.scaleState, "failed") == 0 ? sbinmesh::SCALE_STATE_FAILED
                                                     : sbinmesh::SCALE_STATE_UNCALIBRATED;
}

void fillLeafReading(sbinmesh::DataPacket& data) {
    const DeviceReading reading = takeReading(false, true, !lastCalibrationFailed);
    const int level = calculateFillLevel(reading.distanceMm);
    const bool sensorOk = !lastCalibrationFailed && reading.distanceMm > 0 && level >= 0;

    data.flags = leafFallbackFlags;
    if (sensorOk) {
        data.flags |= sbinmesh::DATA_SENSOR_OK;
        data.level = static_cast<uint8_t>(level);
    }
    if (lastCalibrationFailed) {
        data.flags |= sbinmesh::DATA_CALIBRATION_FAILED;
    }
    if (hasGpsFix) {
        data.flags |= sbinmesh::DATA_HAS_LOCATION;
        data.latitude = latitude;
        data.longitude = longitude;
    }
    data.battery = static_cast<uint8_t>(constrain(reading.batteryPercent, 0, 100));
    data.distanceMm = static_cast<int16_t>(constrain(reading.distanceMm, -1, INT16_MAX));
    data.sensorFailureCycles = sensorFailureCycles;
    data.pmuFailureCycles = pmuFailureCycles;
    data.gpsFailureCycles = gpsFailureCycles;
    data.scaleState = leafScaleState(reading);
    data.weightGrams = data.scaleState == sbinmesh::SCALE_STATE_OK ? reading.weightGrams : 0;

    sbinmesh::LeafDiagnostics& diagnostics = data.diagnostics;
    diagnostics.flags = 0;
    if (reading.batteryMillivolts > 0) {
        diagnostics.flags |= sbinmesh::DIAG_HAS_BATTERY_MV;
        diagnostics.batteryMv = reading.batteryMillivolts;
    }
    diagnostics.flags |= sbinmesh::DIAG_HAS_CHIP_TEMP;
    diagnostics.chipTempC = static_cast<int8_t>(constrain(lroundf(temperatureRead()), -128L, 127L));
    if (reading.distanceSamples > 0) {
        diagnostics.flags |= sbinmesh::DIAG_HAS_DISTANCE_SPREAD;
        diagnostics.distanceSamples = reading.distanceSamples;
        diagnostics.distanceSpreadMm = static_cast<uint16_t>(constrain(reading.distanceSpreadMm, 0, UINT16_MAX));
    }
    if (lastScaleSampled) {
        diagnostics.flags |= sbinmesh::DIAG_HAS_SCALE_SAMPLE;
        diagnostics.scaleRawCounts = lastScaleRawCounts;
        diagnostics.scaleSpreadCounts = static_cast<uint32_t>(max<int32_t>(lastScaleSpreadCounts, 0));
    }
}

void setScaleError(sbinmesh::DataPacket& data, ScaleResult result) {
    data.resultStatus = sbinmesh::RESULT_FAILED;
    switch (result) {
        case SCALE_NOT_RESPONDING:
            data.resultCode = sbinmesh::RESULT_SCALE_NOT_RESPONDING;
            return;
        case SCALE_UNSTABLE: data.resultValue = sbinmesh::SCALE_ERROR_UNSTABLE; break;
        case SCALE_NOT_ZEROED: data.resultValue = sbinmesh::SCALE_ERROR_NOT_ZEROED; break;
        case SCALE_NO_LOAD_CHANGE: data.resultValue = sbinmesh::SCALE_ERROR_NO_LOAD_CHANGE; break;
        default: data.resultValue = sbinmesh::SCALE_ERROR_INVALID_WEIGHT; break;
    }
    data.resultCode = sbinmesh::RESULT_SCALE_ERROR;
}

// The same commands a gateway runs for itself; the result rides on a fresh
// reading, measured again after a calibration so it shows the outcome.
void runLeafInstruction(const sbinmesh::AckPacket& ack, sbinmesh::DataPacket& data) {
    switch (ack.instructionType) {
        case sbinmesh::INSTRUCTION_REPORT_NOW:
            data.resultStatus = sbinmesh::RESULT_COMPLETED;
            data.resultCode = sbinmesh::RESULT_REPORT_SENT;
            break;
        case sbinmesh::INSTRUCTION_CALIBRATE_EMPTY_BIN: {
            const bool calibrated = calibrateBinDepth();
            // The empty bin is also the scale's zero; a bin without a scale does not answer.
            zeroScale();
            fillLeafReading(data);
            data.resultStatus = calibrated ? sbinmesh::RESULT_COMPLETED : sbinmesh::RESULT_FAILED;
            data.resultCode = calibrated ? sbinmesh::RESULT_EMPTY_DEPTH : sbinmesh::RESULT_CALIBRATION_FAILED;
            data.resultValue = calibrated ? binDepthMm : 0;
            break;
        }
        case sbinmesh::INSTRUCTION_CALIBRATE_SCALE: {
            int32_t measuredGrams = 0;
            const ScaleResult scale = calibrateScale(ack.instructionValue, measuredGrams);
            fillLeafReading(data);
            if (scale == SCALE_OK) {
                data.resultStatus = sbinmesh::RESULT_COMPLETED;
                data.resultCode = sbinmesh::RESULT_SCALE_CALIBRATED;
                data.resultValue = measuredGrams;
                data.resultExtra = ack.instructionValue;
            } else {
                setScaleError(data, scale);
            }
            break;
        }
        case sbinmesh::INSTRUCTION_BECOME_LEAF:
            // A gateway reporting through another one switches once this
            // exchange is over; a leaf already is one, and says so.
            becomeLeafAfterThisCycle = deviceRole == ROLE_GATEWAY;
            data.resultStatus = sbinmesh::RESULT_COMPLETED;
            data.resultCode = sbinmesh::RESULT_BECAME_LEAF;
            break;
        default:
            data.resultStatus = sbinmesh::RESULT_FAILED;
            data.resultCode = sbinmesh::RESULT_UNSUPPORTED;
            break;
    }
}

// Once a month, as on a gateway: the modem only for GNSS, then off again. The
// fix goes out with the next reading.
void refreshLeafLocation() {
    acceptSetupLocation();
    if (!shouldRefreshGpsLocation()) {
        return;
    }
    Serial.println("🛰️ GPS refresh is due.");
    recordGpsAttempt();
    bool alreadyOn = false;
    bool fixed = false;
    restoreModemPower();  // cut at the start of the wake
    if (powerOnModem(alreadyOn) && startGpsAcquisition()) {
        const unsigned long startedAt = millis();
        while (!fixed && millis() - startedAt < LEAF_GPS_TIMEOUT_MS) {
            fixed = updateGpsLocation();
            if (!fixed) {
                delay(LEAF_GPS_POLL_MS);
            }
        }
        stopGpsAcquisition();
    }
    powerOffModem();
    if (fixed) {
        gpsFailureCycles = 0;
        Serial.printf("✅ GPS fix saved: %.6f, %.6f\n", latitude, longitude);
    } else {
        gpsFailureCycles = min<uint8_t>(gpsFailureCycles + 1, 2);
        Serial.println("⚠️ No GPS fix this time.");
    }
}

// Asks a gateway for this leaf's keys with the join code from its setup page.
// Returns with them, or sleeps and tries again (the code stays until it works).
void joinTheMesh(sbinmesh::LeafKeys& keys) {
    if (joinCode.length() == 0) {
        enterDeepSleepForSetupRetry(NO_KEYS_RETRY_SLEEP_SECONDS,
                                    "This leaf has no mesh keys and no join code (add the device again from the app)");
    }
    sbinmesh::JoinConfig join = {ownerId.c_str(), joinCode.c_str()};
    switch (sbinmesh::joinMesh(join, keys, JOIN_LISTEN_MS)) {
        case sbinmesh::JoinOutcome::JOINED:
            forgetJoinCode();
            Serial.println("✅ Joined the mesh: the keys are saved.");
            return;
        case sbinmesh::JoinOutcome::REFUSED:
            enterDeepSleepForSetupRetry(JOIN_REFUSED_RETRY_SLEEP_SECONDS,
                                        "The server did not accept the join code (used, expired or wrong)");
        case sbinmesh::JoinOutcome::BAD_SETTINGS:
            enterDeepSleepForSetupRetry(JOIN_REFUSED_RETRY_SLEEP_SECONDS, "The join code is not valid");
        case sbinmesh::JoinOutcome::NO_ANSWER:
            break;
    }
    enterDeepSleepForSetupRetry(NO_KEYS_RETRY_SLEEP_SECONDS, "No gateway answered the join");
}

void prepareLeafSleep() {
    powerDownScale();
    cutModemPower();
}
}

// The leaf cycle's settings with these keys: this board's measurements and commands.
sbinmesh::LeafConfig makeLeafConfig(const sbinmesh::LeafKeys& keys) {
    sbinmesh::LeafConfig config = {};
    config.organizationId = ownerId.c_str();
    memcpy(config.firmwareVersion, FIRMWARE_VERSION_NUMBERS, sizeof(FIRMWARE_VERSION_NUMBERS));
    config.keys = keys;
    config.hooks.fillReading = fillLeafReading;
    config.hooks.runInstruction = runLeafInstruction;
    config.hooks.beforeSleep = prepareLeafSleep;
    return config;
}

void runLeafCycleWith(const sbinmesh::LeafConfig& config) {
    // The config must outlive the cycle, which never returns.
    static sbinmesh::LeafConfig leafConfig;
    leafConfig = config;
    sbinmesh::runLeafCycle(leafConfig);
}

void runAsLeaf() {
    Serial.println("🌿 Running as a mesh leaf.");
    powerOffModem();

    const bool depthWasMissing = binDepthMm <= 0;
    for (uint8_t attempt = 1; binDepthMm <= 0 && attempt <= CALIBRATION_ATTEMPTS; attempt++) {
        if (!calibrateBinDepth()) {
            Serial.printf("⚠️ Calibration attempt %u of %u failed.\n", attempt, CALIBRATION_ATTEMPTS);
        }
    }
    if (depthWasMissing && binDepthMm > 0) {
        zeroScale();
    }

    // A leaf that was a gateway keeps the organization key and derives its own
    // keys from it; a bench build has mesh_keys.h; otherwise the keys a JOIN
    // left in flash, or a JOIN now.
    sbinmesh::LeafKeys keys = {};
    if (!ownLeafKeys(keys)) {
#if SBIN_LEAF_HAS_KEYS
        memcpy(keys.mac, MESH_KEY_MAC, sbinmesh::MAC_LENGTH);
        memcpy(keys.leafKey, MESH_LEAF_KEY, sbinmesh::KEY_LENGTH);
        memcpy(keys.beaconKey, MESH_BEACON_KEY, sbinmesh::KEY_LENGTH);
        keys.keyId = MESH_KEY_ID;
#else
        if (!sbinmesh::loadJoinedKeys(keys)) {
            joinTheMesh(keys);
        }
#endif
    }
    sbinmesh::LeafConfig config = makeLeafConfig(keys);
    config.hooks.afterDelivery = refreshLeafLocation;
    runLeafCycleWith(config);
}
