#include "globals.h"
#include <algorithm>

namespace {
// The A02 is read this many times per reading: the median is the distance, and
// how far the samples spread shows a noisy sensor (rain, a bin lid, a loose wire).
constexpr uint8_t DISTANCE_SAMPLES = 5;
constexpr uint32_t DISTANCE_SAMPLE_GAP_MS = 60;
}

bool initializePowerManagement() {
    if (!PMU.begin(Wire1, AXP2101_SLAVE_ADDRESS, PMU_I2C_SDA_PIN, PMU_I2C_SCL_PIN)) {
        pmuAvailable = false;
        return false;
    }

    PMU.setChargingLedMode(XPOWERS_CHG_LED_OFF);
    PMU.setVbusCurrentLimit(XPOWERS_AXP2101_VBUS_CUR_LIM_1500MA);
    PMU.setDC3Voltage(3300);
    PMU.enableDC3();
    PMU.setBLDO2Voltage(3300);
    PMU.enableBLDO2();
    PMU.setALDO1Voltage(3300);
    PMU.enableALDO1();
    PMU.enableBattDetection();
    PMU.enableBattVoltageMeasure();
    PMU.enableVbusVoltageMeasure();
    // Off by default: until enabled, getTemperature() reads a stale register
    // (385.7 °C), which the server drops as out of range.
    PMU.enableTemperatureMeasure();

    pmuAvailable = true;
    return true;
}

// Why the AXP2101 last turned the board off and on (its PWROFF and PWRON
// status registers): a cut of the board's own power shows up only here.
// Read at boot and printed again before deep sleep, since a monitor often
// connects only after the first lines of a power-on.
String pmuPowerSources;

void readPmuPowerSources() {
    static const char* const OFF_REASONS[] = {
        "PWRON key pulled low", "software", "PWRON always low", "VSYS under-voltage",
        "VBUS over-voltage", "DCDC under-voltage", "DCDC over-voltage", "die over-temperature",
    };
    const uint8_t off = static_cast<uint8_t>(PMU.getPowerOffSource());
    const uint8_t on = static_cast<uint8_t>(PMU.getPowerOnSource());
    pmuOffSource = off;
    pmuOnSource = on;
    String reasons;
    for (uint8_t bit = 0; bit < 8; bit++) {
        if (off & (1 << bit)) {
            reasons += reasons.length() > 0 ? ", " : "";
            reasons += OFF_REASONS[bit];
        }
    }
    char text[160];
    snprintf(text, sizeof(text), "🔋 PMU last power-off: 0x%02X (%s); power-on: 0x%02X; wake cause %d.",
             off, reasons.length() > 0 ? reasons.c_str() : "none", on,
             static_cast<int>(esp_sleep_get_wakeup_cause()));
    pmuPowerSources = text;
    pmuPowerSources += "\n" + pmuRailsText();
}

// The chip keeps the reason of its last power-off until the next one, so a cut that
// happened once (2026-10-28, DCDC over-voltage) was reported by every wake after it and
// read as a standing fault. Once a report carried it, the bits read are written back:
// the register clears on a write of 1 (a register that did not would be unchanged), and
// a power-off from now on is the only thing it shows.
void clearPmuOffSource() {
    if (!pmuAvailable || pmuOffSource == 0) {
        return;
    }
    PMU.writeRegister(XPOWERS_AXP2101_PWROFF_STATUS, pmuOffSource);
    const uint8_t left = static_cast<uint8_t>(PMU.getPowerOffSource());
    Serial.printf("🔋 PMU power-off reason 0x%02X reported; register now 0x%02X%s.\n", pmuOffSource, left,
                  left == 0 ? " (cleared)" : " (the chip keeps it)");
}

// Which AXP2101 rails are on and at what voltage, to spot one that is on
// without a load (a candidate for the DCDC over-voltage power-off).
String pmuRailsText() {
    struct Rail {
        const char* name;
        bool on;
        uint16_t millivolts;
    };
    const Rail rails[] = {
        {"DC1", PMU.isEnableDC1(), PMU.getDC1Voltage()},
        {"DC2", PMU.isEnableDC2(), PMU.getDC2Voltage()},
        {"DC3", PMU.isEnableDC3(), PMU.getDC3Voltage()},
        {"DC4", PMU.isEnableDC4(), PMU.getDC4Voltage()},
        {"DC5", PMU.isEnableDC5(), PMU.getDC5Voltage()},
        {"ALDO1", PMU.isEnableALDO1(), PMU.getALDO1Voltage()},
        {"ALDO2", PMU.isEnableALDO2(), PMU.getALDO2Voltage()},
        {"ALDO3", PMU.isEnableALDO3(), PMU.getALDO3Voltage()},
        {"ALDO4", PMU.isEnableALDO4(), PMU.getALDO4Voltage()},
        {"BLDO1", PMU.isEnableBLDO1(), PMU.getBLDO1Voltage()},
        {"BLDO2", PMU.isEnableBLDO2(), PMU.getBLDO2Voltage()},
        {"CPUSLDO", PMU.isEnableCPUSLDO(), PMU.getCPUSLDOVoltage()},
        {"DLDO1", PMU.isEnableDLDO1(), PMU.getDLDO1Voltage()},
        {"DLDO2", PMU.isEnableDLDO2(), PMU.getDLDO2Voltage()},
    };
    String text = "🔌 PMU rails on:";
    for (const Rail& rail : rails) {
        if (rail.on) {
            text += " " + String(rail.name) + " " + String(rail.millivolts) + " mV,";
        }
    }
    text.remove(text.length() - 1);
    return text;
}

// Turns off the SIM7080 main (DC3) and GNSS antenna (BLDO2) rails for when the
// modem does not answer AT commands; initializePowerManagement() restores them.
void cutModemPower() {
    if (!pmuAvailable) {
        return;
    }
    PMU.disableBLDO2();
    PMU.disableDC3();
    Serial.println("🔌 Modem power rails turned off.");
}

// Turns the modem's rails back on (as initializePowerManagement() does at boot)
// for a leaf, which cut them, to power the modem for a GPS fix.
void restoreModemPower() {
    if (!pmuAvailable) {
        return;
    }
    PMU.setDC3Voltage(3300);
    PMU.enableDC3();
    PMU.setBLDO2Voltage(3300);
    PMU.enableBLDO2();
    delay(100);
}

// Reads the A02 and the battery and updates the health counters. A sensor not
// trusted (its calibration just failed) counts as failed whatever it reads.
DeviceReading takeReading(bool gpsTested, bool gpsOk, bool sensorTrusted) {
    DeviceReading reading;
    int samples[DISTANCE_SAMPLES];
    uint8_t valid = 0;
    for (uint8_t i = 0; i < DISTANCE_SAMPLES; i++) {
        const int distance = getDistanceMm();
        if (distance > 0) {
            samples[valid++] = distance;
        }
        delay(DISTANCE_SAMPLE_GAP_MS);
    }
    std::sort(samples, samples + valid);
    reading.distanceSamples = valid;
    reading.distanceMm = valid > 0 ? samples[valid / 2] : -1;
    reading.distanceSpreadMm = valid > 1 ? samples[valid - 1] - samples[0] : 0;
    const bool sensorOk = sensorTrusted && reading.distanceMm > 0 &&
                          calculateFillLevel(reading.distanceMm) >= 0;
    if (!sensorOk) {
        Serial.println("⚠️ Sensor Read Error; fill level will be reported as unavailable.");
    }
    reading.batteryMillivolts = readBatteryMillivolts();
    reading.batteryPercent = readBatteryPercent();
    const bool pmuOk = pmuAvailable && reading.batteryMillivolts > 0;
    // A scale counts (and can fail) only once it is calibrated: a bin without
    // one is never calibrated.
    reading.weightGrams = 0;
    reading.scaleState = "uncalibrated";
    const bool scaleTested = isScaleCalibrated();
    bool scaleOk = true;
    if (scaleTested) {
        const ScaleResult scale = readWeightGrams(reading.weightGrams);
        scaleOk = scale == SCALE_OK;
        reading.scaleState = scaleOk ? "ok" : "failed";
        if (!scaleOk) {
            reading.weightGrams = 0;
            Serial.printf("⚠️ Scale reading failed (%s); weight reported as unavailable.\n", scaleResultCode(scale));
        }
    }
    reading.health = updateDeviceHealth(sensorOk, pmuOk, gpsTested, gpsOk, scaleTested, scaleOk);
    return reading;
}

uint16_t readBatteryMillivolts() {
    return pmuAvailable && PMU.isBatteryConnect() ? PMU.getBattVoltage() : 0;
}

int readBatteryPercent() {
    return pmuAvailable && PMU.isBatteryConnect() ? PMU.getBatteryPercent() : 0;
}

String updateDeviceHealth(bool sensorOk, bool pmuOk, bool gpsTested, bool gpsOk, bool scaleTested, bool scaleOk) {
    if (sensorOk) {
        sensorFailureCycles = 0;
    } else if (sensorFailureCycles < 2) {
        sensorFailureCycles++;
    }

    if (pmuOk) {
        pmuFailureCycles = 0;
    } else if (pmuFailureCycles < 2) {
        pmuFailureCycles++;
    }

    if (gpsTested) {
        if (gpsOk) {
            gpsFailureCycles = 0;
        } else if (gpsFailureCycles < 2) {
            gpsFailureCycles++;
        }
    }

    if (scaleTested) {
        if (scaleOk) {
            scaleFailureCycles = 0;
        } else if (scaleFailureCycles < 2) {
            scaleFailureCycles++;
        }
    }

    // The scale counts like the other parts; it is kept out of
    // healthFromFailureCounts, which relayed leaves (no scale) share.
    const String health = healthFromFailureCounts(sensorFailureCycles, pmuFailureCycles, gpsFailureCycles);
    if (scaleFailureCycles >= 2) {
        return "critical";
    }
    return scaleFailureCycles > 0 && health == "good" ? "warning" : health;
}

String healthFromFailureCounts(uint8_t sensorFailures, uint8_t pmuFailures, uint8_t gpsFailures) {
    if (sensorFailures >= 2 || pmuFailures >= 2 || gpsFailures >= 2) {
        return "critical";
    }
    if (sensorFailures > 0 || pmuFailures > 0 || gpsFailures > 0) {
        return "warning";
    }
    return "good";
}

// What went wrong, as codes the server checks and the app words in the
// user's language (see the server's utils/faults.js); each fault's cycles are
// how many reporting cycles in a row it has lasted (2: two or more).
namespace {
void addFault(JsonArray faults, const char* code, uint8_t failures, int distanceMm = INT32_MIN) {
    JsonObject fault = faults.add<JsonObject>();
    fault["code"] = code;
    if (failures > 0) {
        fault["cycles"] = min<uint8_t>(failures, 2);
    }
    if (distanceMm != INT32_MIN) {
        fault["mm"] = distanceMm;
    }
}
}

// This bin's own faults: its parts, and its scale (which leaves do not have).
void addOwnFaults(JsonArray faults, int distanceMm) {
    addFaults(faults, sensorFailureCycles, pmuFailureCycles, gpsFailureCycles,
              binDepthMm <= 0 || lastCalibrationFailed, distanceMm);
    if (scaleFailureCycles > 0) {
        addFault(faults, "scale", scaleFailureCycles);
    }
}

// Shared by this bin's own reports and the readings it relays for mesh leaves.
void addFaults(
    JsonArray faults,
    uint8_t sensorFailures,
    uint8_t pmuFailures,
    uint8_t gpsFailures,
    bool calibrationFailed,
    int distanceMm
) {
    if (sensorFailures > 0 && calibrationFailed) {
        addFault(faults, "calibration_failed", 0, distanceMm);
    } else if (sensorFailures > 0 && distanceMm <= 0) {
        addFault(faults, "distance_sensor", sensorFailures);
    } else if (sensorFailures > 0) {
        addFault(faults, "fill_calculation", sensorFailures, distanceMm);
    }
    if (pmuFailures > 0) {
        addFault(faults, "pmu", pmuFailures);
    }
    if (gpsFailures > 0) {
        addFault(faults, "gps", gpsFailures);
    }
}
