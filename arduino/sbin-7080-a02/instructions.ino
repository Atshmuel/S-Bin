#include "globals.h"

namespace {
bool loadCachedInstructionResult(
    const String& instructionId,
    String& status,
    String& result
) {
    preferences.begin("instCache", true);
    bool found = false;
    for (uint8_t slot = 0; slot < MAX_PENDING_INSTRUCTIONS; slot++) {
        String suffix(slot);
        if (preferences.getString(("id" + suffix).c_str()) == instructionId) {
            status = preferences.getString(("status" + suffix).c_str());
            result = preferences.getString(("result" + suffix).c_str());
            found = status.length() > 0;
            break;
        }
    }
    preferences.end();
    return found;
}

void saveCachedInstructionResult(
    const String& instructionId,
    const String& status,
    const String& result
) {
    preferences.begin("instCache", false);
    uint8_t slot = preferences.getUChar("next", 0) % MAX_PENDING_INSTRUCTIONS;
    String suffix(slot);
    preferences.putString(("id" + suffix).c_str(), instructionId);
    preferences.putString(("status" + suffix).c_str(), status);
    preferences.putString(("result" + suffix).c_str(), result);
    preferences.putUChar("next", (slot + 1) % MAX_PENDING_INSTRUCTIONS);
    preferences.end();
}

uint32_t processInstruction(const DeviceInstruction& instruction) {
    String status;
    String result;
    uint32_t awakeExtensionSeconds = 0;
    if (loadCachedInstructionResult(instruction.id, status, result)) {
        Serial.printf("↩️ Re-sending saved result for instruction %s.\n", instruction.id.c_str());
    } else {
        if (instruction.type == "report_now") {
            Serial.printf("📊 Executing report_now instruction %s.\n", instruction.id.c_str());
            if (publishTelemetry(takeReading(false, true, true))) {
                status = "completed";
                result = "additional_report_published";
            } else {
                status = "failed";
                result = "additional_report_publish_failed";
            }
        } else if (instruction.type == "become_leaf") {
            // Done once this cycle's report and results are out (role.ino).
            Serial.printf("🌿 Instruction %s: this gateway becomes a mesh leaf after this cycle.\n",
                          instruction.id.c_str());
            becomeLeafAfterThisCycle = true;
            status = "completed";
            result = "became_leaf";
        } else if (instruction.type == "stay_awake") {
            if (instruction.durationSeconds == 0 ||
                instruction.durationSeconds > MAX_AWAKE_EXTENSION_SECONDS) {
                status = "failed";
                result = "invalid_awake_extension_duration";
            } else {
                status = "completed";
                awakeExtensionSeconds = instruction.durationSeconds;
                result = "awake_window_extended";
                Serial.printf(
                    "⏱️ Staying awake for an additional %lu seconds.\n",
                    static_cast<unsigned long>(awakeExtensionSeconds)
                );
            }
        } else if (instruction.type == "calibrate_empty_bin") {
            Serial.printf("📏 Starting empty-bin calibration for instruction %s.\n",
                          instruction.id.c_str());
            const bool calibrated = calibrateBinDepth();
            if (calibrated) {
                status = "completed";
                result = "empty_depth_mm_" + String(binDepthMm);
            } else {
                status = "failed";
                result = "empty_bin_calibration_failed";
            }
            // The empty bin is also the scale's zero. A bin without a scale
            // (no answer) just leaves it out of the result.
            const ScaleResult zero = zeroScale();
            if (zero == SCALE_OK) {
                result += "_scale_zeroed";
            } else if (zero != SCALE_NOT_RESPONDING) {
                result += String("_") + scaleResultCode(zero);
            }
            // Publish refreshed telemetry either way, so the bin's health reflects
            // the calibration outcome instead of the report sent before it.
            if (!publishTelemetry(takeReading(false, true, calibrated))) {
                Serial.println("⚠️ The refreshed telemetry after calibration could not be published.");
            }
        } else if (instruction.type == "refresh_location") {
            // GNSS and cellular data cannot run together on the SIM7080, so the
            // fix is taken at the next cycle, on the monthly refresh's path.
            lastGpsAttemptEpoch = 0;
            preferences.begin("credentials", false);
            preferences.putLong64("gpsAttempt", 0);
            preferences.end();
            status = "completed";
            result = "location_refresh_scheduled";
            Serial.println("🛰️ A GPS refresh is scheduled for the next cycle.");
        } else if (instruction.type == "calibrate_scale") {
            Serial.printf("⚖️ Calibrating the scale with %lu g for instruction %s.\n",
                          static_cast<unsigned long>(instruction.grams), instruction.id.c_str());
            int32_t measuredGrams = 0;
            const ScaleResult scale = calibrateScale(instruction.grams, measuredGrams);
            if (scale == SCALE_OK) {
                status = "completed";
                result = "scale_calibrated_" + String(instruction.grams) + "_reads_" + String(measuredGrams);
            } else {
                status = "failed";
                result = scaleResultCode(scale);
            }
            if (!publishTelemetry(takeReading(false, true, true))) {
                Serial.println("⚠️ The refreshed telemetry after scale calibration could not be published.");
            }
        } else {
            Serial.printf("⚠️ Unsupported instruction type: %s.\n", instruction.type.c_str());
            status = "failed";
            result = "unsupported_instruction_type";
        }
        // Saved before reporting it, so a lost confirmation re-sends this result
        // instead of running the instruction again.
        saveCachedInstructionResult(instruction.id, status, result);
    }

    if (!publishInstructionResult(instruction.id, status, result)) {
        Serial.printf("⚠️ Instruction %s remains pending on the server until its result is received.\n",
                      instruction.id.c_str());
    }
    return awakeExtensionSeconds;
}
}

// Only asks the server for the leaves' commands (the reply fills the list the
// mesh task hands out), without running this gateway's own: they wait for
// processPendingInstructions(), after the readings went up.
void refreshLeafCommands() {
    constexpr unsigned long LEAF_COMMANDS_TIMEOUT_MS = 3000UL;
    if (deviceKey.length() > 0) {
        requestInstructionCheck(LEAF_COMMANDS_TIMEOUT_MS);
    }
}

void processPendingInstructions(unsigned long timeoutMs) {
    unsigned long deadline = millis() + timeoutMs;
    bool extendedAwakeWindow = false;
    while (static_cast<long>(deadline - millis()) > 0) {
        const unsigned long remaining = deadline - millis();
        const unsigned long checkTimeoutMs = extendedAwakeWindow
            ? min(remaining, 5000UL)
            : remaining;
        if (!requestInstructionCheck(checkTimeoutMs)) {
            if (!extendedAwakeWindow) {
                return;
            }

            maintainCellularConnection();
            maintainMqttConnection();
            serviceMqttFor(min(deadline - millis(), 1000UL));
            continue;
        }
        if (pendingInstructionCount == 0) {
            if (!extendedAwakeWindow) {
                Serial.println("✅ No pending instructions; device may return to sleep.");
                return;
            }

            const unsigned long pollDelayMs = min(remaining, 5000UL);
            Serial.printf(
                "⏳ No pending instructions; checking again in %lu seconds.\n",
                pollDelayMs / 1000
            );
            serviceMqttFor(pollDelayMs);
            continue;
        }
        for (uint8_t i = 0; i < pendingInstructionCount; i++) {
            if (static_cast<long>(deadline - millis()) <= 0) {
                Serial.println("⚠️ Instruction processing window expired; remaining instructions stay queued.");
                return;
            }
            const uint32_t extensionSeconds = processInstruction(pendingInstructions[i]);
            if (extensionSeconds > 0) {
                deadline = max(deadline, millis()) +
                           static_cast<unsigned long>(extensionSeconds) * 1000UL;
                extendedAwakeWindow = true;
            }
        }
    }
    Serial.println("⚠️ Instruction processing window expired; returning to sleep.");
}
