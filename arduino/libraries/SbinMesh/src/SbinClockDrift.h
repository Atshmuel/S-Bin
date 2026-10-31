#pragma once

#include <stdint.h>

// Clock helpers and sleep-clock drift math shared by gateways (measured
// against network time) and leaves (measured against a gateway beacon). The
// ESP32 deep-sleep timer and system clock run on the internal RC oscillator,
// which drifted by about +1% (LilyGO ESP32-S3) and +1.3% to +3.5% (ESP32
// WROVER, more the longer it was awake before the sleep) on the boards
// measured so far.

namespace sbinmesh {

// Real times: from 2025 on (an earlier clock was never set) and before 2080
// (a SIM7080 modem's restarted clock reads 1980 with a two-digit year).
constexpr int64_t MIN_VALID_EPOCH = 1735689600;  // 2025-01-01 UTC
constexpr int64_t MAX_VALID_EPOCH = 3471292800;  // 2080-01-01 UTC
inline bool isValidEpoch(int64_t epochSeconds) {
    return epochSeconds >= MIN_VALID_EPOCH && epochSeconds < MAX_VALID_EPOCH;
}

// The system clock in UTC milliseconds, and setting it.
int64_t epochMsNow();
void setEpochMs(int64_t epochMs);

// How far a clock running fast by driftPpm got ahead over a sleep it measured
// itself as sleptMs.
int64_t driftAheadMs(int64_t sleptMs, int32_t driftPpm);

// Stretches (or shortens) a requested sleep so that a clock running fast by
// driftPpm wakes after sleepSeconds of real time.
uint64_t applyDriftCorrection(uint64_t sleepSeconds, int32_t driftPpm);

enum DriftMeasurement {
    DRIFT_MEASURED,
    DRIFT_NO_SLEEP,       // no recorded sleep start, or the sleep was too short
    DRIFT_IMPLAUSIBLE,    // outside maxAbsPpm; likely a bad reference time
};

// Measures drift over the last deep sleep. deviceEpoch is the device clock
// just before it is corrected to referenceEpoch; awakeSeconds is time spent
// awake since that sleep (it runs on the accurate main crystal).
DriftMeasurement measureDriftPpm(int64_t deviceEpoch,
                     int64_t referenceEpoch,
                     int64_t sleepStartedEpoch,
                     int64_t awakeSeconds,
                     int64_t minSleepSeconds,
                     int32_t maxAbsPpm,
                     int32_t& measuredPpm,
                     int64_t& realSleptSeconds);

// Averages a new measurement into the running estimate to smooth out
// temperature noise; the first measurement is used as is.
int32_t blendDriftPpm(int32_t currentPpm, bool hasCurrent, int32_t measuredPpm);

// The drift in flash. It is the chip's, not the bin's: one value for a gateway
// and a leaf alike, in a place of its own, so a device reset does not lose it
// (only erasing the flash does). False when this chip has none yet.
bool loadBoardDriftPpm(int32_t& driftPpm);
// Rewritten only when the estimate moved, to spare the flash.
void saveBoardDriftPpm(int32_t driftPpm);

}  // namespace sbinmesh
