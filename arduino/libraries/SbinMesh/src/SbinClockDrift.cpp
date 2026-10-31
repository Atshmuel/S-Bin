#include "SbinClockDrift.h"

#include <Preferences.h>
#include <stdlib.h>
#include <sys/time.h>

namespace sbinmesh {

namespace {
constexpr char DRIFT_NAMESPACE[] = "clock";
constexpr char DRIFT_KEY[] = "driftPpm";
constexpr int32_t DRIFT_SAVE_THRESHOLD_PPM = 200;

// Before the drift had its own place: the gateway's first, measured against
// network time. Moved over once.
bool takeOldDriftPpm(const char* oldNamespace, int32_t& driftPpm) {
    Preferences store;
    store.begin(oldNamespace, false);
    const bool found = store.isKey(DRIFT_KEY);
    if (found) {
        driftPpm = store.getInt(DRIFT_KEY, 0);
        store.remove(DRIFT_KEY);
    }
    store.end();
    return found;
}
}  // namespace

int64_t epochMsNow() {
    struct timeval now;
    gettimeofday(&now, nullptr);
    return static_cast<int64_t>(now.tv_sec) * 1000LL + now.tv_usec / 1000;
}

void setEpochMs(int64_t epochMs) {
    struct timeval value = {
        static_cast<time_t>(epochMs / 1000),
        static_cast<suseconds_t>((epochMs % 1000) * 1000),
    };
    settimeofday(&value, nullptr);
}

int64_t driftAheadMs(int64_t sleptMs, int32_t driftPpm) {
    return sleptMs * driftPpm / (1000000LL + driftPpm);
}

uint64_t applyDriftCorrection(uint64_t sleepSeconds, int32_t driftPpm) {
    // A clock running fast by r fires after requested / (1 + r) real seconds.
    const int64_t adjustment =
        static_cast<int64_t>(sleepSeconds) * driftPpm / 1000000LL;
    const int64_t corrected = static_cast<int64_t>(sleepSeconds) + adjustment;
    return corrected > 0 ? static_cast<uint64_t>(corrected) : 1;
}

DriftMeasurement measureDriftPpm(int64_t deviceEpoch,
                                 int64_t referenceEpoch,
                                 int64_t sleepStartedEpoch,
                                 int64_t awakeSeconds,
                                 int64_t minSleepSeconds,
                                 int32_t maxAbsPpm,
                                 int32_t& measuredPpm,
                                 int64_t& realSleptSeconds) {
    if (sleepStartedEpoch <= 0) {
        return DRIFT_NO_SLEEP;
    }
    const int64_t slept = deviceEpoch - sleepStartedEpoch - awakeSeconds;
    if (slept < minSleepSeconds) {
        return DRIFT_NO_SLEEP;
    }

    const int64_t errorSeconds = deviceEpoch - referenceEpoch;
    realSleptSeconds = slept - errorSeconds;
    if (realSleptSeconds <= 0) {
        return DRIFT_IMPLAUSIBLE;
    }
    const int64_t ppm = errorSeconds * 1000000LL / realSleptSeconds;
    if (ppm > maxAbsPpm || ppm < -maxAbsPpm) {
        measuredPpm = static_cast<int32_t>(ppm > INT32_MAX ? INT32_MAX : ppm < INT32_MIN ? INT32_MIN : ppm);
        return DRIFT_IMPLAUSIBLE;
    }
    measuredPpm = static_cast<int32_t>(ppm);
    return DRIFT_MEASURED;
}

int32_t blendDriftPpm(int32_t currentPpm, bool hasCurrent, int32_t measuredPpm) {
    if (!hasCurrent) {
        return measuredPpm;
    }
    return static_cast<int32_t>((static_cast<int64_t>(currentPpm) + measuredPpm) / 2);
}

bool loadBoardDriftPpm(int32_t& driftPpm) {
    Preferences store;
    store.begin(DRIFT_NAMESPACE, false);
    const bool saved = store.isKey(DRIFT_KEY);
    if (saved) {
        driftPpm = store.getInt(DRIFT_KEY, 0);
    }
    store.end();
    if (saved) {
        return true;
    }
    if (takeOldDriftPpm("credentials", driftPpm) || takeOldDriftPpm("leaf", driftPpm)) {
        saveBoardDriftPpm(driftPpm);
        return true;
    }
    return false;
}

void saveBoardDriftPpm(int32_t driftPpm) {
    Preferences store;
    store.begin(DRIFT_NAMESPACE, false);
    if (!store.isKey(DRIFT_KEY) || abs(driftPpm - store.getInt(DRIFT_KEY, 0)) > DRIFT_SAVE_THRESHOLD_PPM) {
        store.putInt(DRIFT_KEY, driftPpm);
    }
    store.end();
}

}  // namespace sbinmesh
