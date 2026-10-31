#include "globals.h"

// The deep-sleep timer and the system clock both run on the ESP32-S3's internal
// RC oscillator during sleep (this board has no 32 kHz crystal), which runs
// about +1% fast, and the rate changes from cycle to cycle with temperature.
// Each network time sync measures that drift over the sleep that just ended,
// and the next sleep request is stretched to cancel it; what the estimate
// misses is absorbed by waking early and waiting for the slot
// (waitForSlotStart()). The math is shared with the mesh leaves in the
// SbinMesh library.

namespace {
// Network time has 1 s resolution: 30+ minutes keep a sample within ~±600 ppm.
constexpr int64_t MIN_DRIFT_MEASUREMENT_SECONDS = 1800;
// The internal RC oscillator is specified to ±5%; measured so far up to ~1.4%.
constexpr int32_t MAX_ABS_DRIFT_PPM = 60000;
// A limit that matches the server's validation of the report's clock error.
constexpr int64_t MAX_REPORTED_CLOCK_ERROR_SECONDS = 86400;
// A wake further off than this is not that slot's wake; it is not logged.
constexpr int64_t MAX_LOGGED_WAKE_OFFSET_SECONDS = 3600;
}

uint64_t applyDriftCorrection(uint64_t sleepSeconds) {
    return sbinmesh::applyDriftCorrection(sleepSeconds, driftPpm);
}

void markSleepStart() {
    const time_t now = time(nullptr);
    sleepStartedEpoch = sbinmesh::isValidEpoch(now)
        ? static_cast<uint64_t>(now)
        : 0;
}

// Records, for the report, how far the clock was off after the deep sleep that
// just ended, and logs when this wake happened relative to the planned wake:
// the slot minus the lead the sleep ended early by on purpose.
void recordWakeTiming(time_t deviceEpoch, time_t networkEpoch) {
    if (esp_sleep_get_wakeup_cause() != ESP_SLEEP_WAKEUP_TIMER ||
        !sbinmesh::isValidEpoch(deviceEpoch)) {
        return;
    }
    const int64_t error = static_cast<int64_t>(deviceEpoch) - static_cast<int64_t>(networkEpoch);
    if (llabs(error) <= MAX_REPORTED_CLOCK_ERROR_SECONDS) {
        clockErrorSeconds = static_cast<int32_t>(error);
        hasClockError = true;
    }
    if (nextWakeEpoch == 0) {
        return;
    }
    // Boot follows the wake by a few hundred ms; network time has 1 s resolution.
    const int64_t wakeEpoch = static_cast<int64_t>(networkEpoch) - static_cast<int64_t>(millis() / 1000UL);
    const int64_t plannedWake = static_cast<int64_t>(nextWakeEpoch) - sleepLeadSeconds;
    const int64_t offset = wakeEpoch - plannedWake;
    if (llabs(offset) <= MAX_LOGGED_WAKE_OFFSET_SECONDS) {
        Serial.printf("⏰ Woke %lld s %s the planned wake (clock was off by %+lld s).\n",
                      static_cast<long long>(llabs(offset)), offset < 0 ? "before" : "after",
                      static_cast<long long>(error));
    }
}

void recordClockDrift(time_t deviceEpoch, time_t referenceEpoch) {
    if (sleepStartedEpoch == 0 || !sbinmesh::isValidEpoch(deviceEpoch)) {
        return;
    }

    int32_t measuredPpm = 0;
    int64_t realSlept = 0;
    const sbinmesh::DriftMeasurement result = sbinmesh::measureDriftPpm(
        static_cast<int64_t>(deviceEpoch),
        static_cast<int64_t>(referenceEpoch),
        static_cast<int64_t>(sleepStartedEpoch),
        static_cast<int64_t>(millis() / 1000UL),
        MIN_DRIFT_MEASUREMENT_SECONDS,
        MAX_ABS_DRIFT_PPM,
        measuredPpm,
        realSlept
    );
    sleepStartedEpoch = 0;
    if (result == sbinmesh::DRIFT_IMPLAUSIBLE) {
        Serial.printf(
            "⚠️ Ignoring implausible clock drift of %+ld ppm.\n",
            static_cast<long>(measuredPpm)
        );
    }
    if (result != sbinmesh::DRIFT_MEASURED) {
        return;
    }

    driftPpm = sbinmesh::blendDriftPpm(driftPpm, driftMeasured, measuredPpm);
    driftMeasured = true;
    Serial.printf(
        "⏱️ Clock drift: measured %+ld ppm over %lld s; using %+ld ppm.\n",
        static_cast<long>(measuredPpm),
        static_cast<long long>(realSlept),
        static_cast<long>(driftPpm)
    );

    sbinmesh::saveBoardDriftPpm(driftPpm);
}
