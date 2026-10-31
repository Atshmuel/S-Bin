#include "globals.h"

namespace {
// A clock set from network time that the server's differs from by more than
// this was set wrong (see correctClockFromServer()).
constexpr int64_t SERVER_CLOCK_TOLERANCE_SECONDS = 60;
constexpr uint64_t MICROSECONDS_PER_SECOND = 1000000ULL;
constexpr time_t GPS_REFRESH_INTERVAL_SECONDS = 31LL * 24 * 60 * 60;
constexpr uint32_t FALLBACK_SLEEP_SECONDS = 20;

// Anchoring the mesh window to the slot (see waitForSlotStart()). The sleep
// clock's drift changed by up to ~7,600 ppm between cycles and the estimate
// missed it by up to ~5,400 ppm, so a slot sleep ends this early on purpose...
constexpr uint64_t SLOT_LEAD_PPM = 8000;
// ...plus the modem boot and network time sync after the wake (~10 s).
constexpr uint64_t SLOT_LEAD_SYNC_SECONDS = 30;
constexpr uint64_t MAX_SLOT_LEAD_SECONDS = 600;
// Shorter sleeps (development intervals) drift by only a few seconds.
constexpr uint64_t MIN_LEAD_SLEEP_SECONDS = 600;
// The light sleep ends this long before the slot to re-read network time.
constexpr int64_t SLOT_RESYNC_SECONDS = 5;
// The re-read comes at least this long after the first read, even when that
// read puts the slot closer or past: the network corrected the modem's clock
// within seconds of registering.
constexpr int64_t MIN_RESYNC_GAP_MS = 10000;
// A timer wake further than this before the slot is not that slot's wake.
constexpr int64_t MAX_SLOT_WAIT_SECONDS = 900;

// Time spent in light sleep this boot; not counted as awake time.
uint32_t lightSleptMs = 0;

// Right after the modem powers on, its network time was often seconds ahead
// (in 5 of 8 test cycles) until the network updated it; the re-read before the
// slot was always right. So on a slot wake the first read only times the light
// sleep, and the wake and drift are measured at the re-read (waitForSlotStart()).
bool slotSyncPending = false;
// False when the wait runs on the clock the server set: nothing to measure against.
bool slotSyncFromNetwork = true;
time_t firstReadDeviceEpoch = 0;
time_t firstReadNetworkEpoch = 0;
int64_t firstReadCorrectionMs = 0;  // how far the first read moved the clock
uint32_t firstReadMillis = 0;

// How early a slot sleep ends on purpose: enough for the drift to change by
// SLOT_LEAD_PPM over the sleep, plus the time to sync the clock after waking.
uint32_t slotLeadSeconds(uint64_t sleepSeconds) {
    if (sleepSeconds < MIN_LEAD_SLEEP_SECONDS) {
        return 0;
    }
    const uint64_t lead = sleepSeconds * SLOT_LEAD_PPM / 1000000ULL + SLOT_LEAD_SYNC_SECONDS;
    return static_cast<uint32_t>(min(lead, MAX_SLOT_LEAD_SECONDS));
}

// Reads the modem's network time as a UTC epoch (1 s resolution).
bool readNetworkEpoch(time_t& utcEpoch) {
    int year = 0;
    int month = 0;
    int day = 0;
    int hour = 0;
    int minute = 0;
    int second = 0;
    float timezoneOffset = 0;
    if (!modem.getNetworkTime(
            &year,
            &month,
            &day,
            &hour,
            &minute,
            &second,
            &timezoneOffset) ||
        month < 1 || month > 12 ||
        day < 1 || day > 31 || hour < 0 || hour > 23 ||
        minute < 0 || minute > 59 || second < 0 || second > 60 ||
        timezoneOffset < -14 || timezoneOffset > 14) {
        return false;
    }
    setenv("TZ", "UTC0", 1);
    tzset();

    struct tm networkTime = {};
    networkTime.tm_year = year - 1900;
    networkTime.tm_mon = month - 1;
    networkTime.tm_mday = day;
    networkTime.tm_hour = hour;
    networkTime.tm_min = minute;
    networkTime.tm_sec = second;
    utcEpoch = mktime(&networkTime) - static_cast<time_t>(timezoneOffset * 3600.0f);
    // Not a real time when the modem's clock was never set or restarted.
    return sbinmesh::isValidEpoch(utcEpoch);
}

// Deep-sleeps until leadSeconds before the end of sleepSeconds; never returns.
void enterDeepSleep(uint64_t sleepSeconds, uint32_t leadSeconds) {
    if (modem.testAT(1000) && !modem.poweroff()) {
        Serial.println("⚠️ Modem did not confirm power-off before ESP32 deep sleep.");
    }
    // The modem is off and starts cold at every wake anyway, so its rails
    // (main supply and GNSS antenna) need not stay on through the sleep.
    cutModemPower();

    sleepLeadSeconds = leadSeconds < sleepSeconds ? leadSeconds : 0;
    sleepSeconds -= sleepLeadSeconds;
    const uint64_t correctedSleepSeconds = applyDriftCorrection(sleepSeconds);
    Serial.printf(
        "💤 Deep sleep for %llu seconds (timer %llu s, drift %+ld ppm, %lu s before the slot) before the next report attempt.\n",
        static_cast<unsigned long long>(sleepSeconds),
        static_cast<unsigned long long>(correctedSleepSeconds),
        static_cast<long>(driftPpm),
        static_cast<unsigned long>(sleepLeadSeconds)
    );

    if (pmuPowerSources.length() > 0) {
        Serial.println(pmuPowerSources);
    }
    Serial.flush();
    delay(200);  // lets a monitor read the last lines before USB goes down
    lastAwakeSeconds = (millis() - lightSleptMs + 999UL) / 1000UL;
    // This cycle's MQTT bytes go out with the next report.
    bytesSentLastCycle = bytesSentThisCycle;
    bytesSentThisCycle = 0;
    markSleepStart();
    esp_sleep_enable_timer_wakeup(correctedSleepSeconds * MICROSECONDS_PER_SECOND);
    esp_deep_sleep_start();
}

// Without network time, a clock the server set last cycle still serves the mesh
// window once the sleep's drift is taken off: the sleep clock ran fast by about
// driftPpm, so it reads ahead by that much of the sleep. The slot wait then
// runs on it, but nothing is measured against it.
void carryClockFromServer() {
    if (!clockFromServer || !isSystemClockValid() || sleepStartedEpoch == 0 ||
        esp_sleep_get_wakeup_cause() != ESP_SLEEP_WAKEUP_TIMER) {
        return;
    }
    const int64_t deviceMs = sbinmesh::epochMsNow();
    const int64_t sleptMs = deviceMs - static_cast<int64_t>(millis()) -
                            static_cast<int64_t>(sleepStartedEpoch) * 1000LL;
    const int64_t correctionMs = driftMeasured && sleptMs > 0
        ? sbinmesh::driftAheadMs(sleptMs, driftPpm)
        : 0;
    sbinmesh::setEpochMs(deviceMs - correctionMs);
    sleepStartedEpoch = 0;
    clockSynced = true;
    slotSyncPending = sleepLeadSeconds > 0 && nextWakeEpoch != 0;
    slotSyncFromNetwork = false;
    firstReadMillis = millis();
    Serial.printf("🕒 No network time; using the clock the server set, %+lld ms of drift taken off.\n",
                  static_cast<long long>(-correctionMs));
}
}

bool isSystemClockValid() {
    return sbinmesh::isValidEpoch(time(nullptr));
}

// The server's reply carries its clock: the next wake minus the sleep until it
// (1 s resolution, plus the MQTT delay). Without network time this boot that is
// the best time there is; with it, the clock is corrected only if the two
// disagree, as when the modem's own clock was read as network time.
void correctClockFromServer(time_t serverEpoch) {
    if (!sbinmesh::isValidEpoch(serverEpoch)) {
        return;
    }
    const int64_t offset = static_cast<int64_t>(time(nullptr)) - static_cast<int64_t>(serverEpoch);
    const bool networkTimeThisBoot = clockSynced && !clockFromServer;
    if (isSystemClockValid() && networkTimeThisBoot && llabs(offset) <= SERVER_CLOCK_TOLERANCE_SECONDS) {
        return;
    }
    sbinmesh::setEpochMs(static_cast<int64_t>(serverEpoch) * 1000LL);
    clockSynced = true;
    clockFromServer = true;
    Serial.printf("🕒 Clock set from the server's (it was off by %+lld s).\n",
                  static_cast<long long>(offset));
}

bool synchronizeClockFromNetwork(unsigned long timeoutMs) {
    const unsigned long startedAt = millis();

    if (!modem.waitForNetwork(timeoutMs)) {
        Serial.println("⚠️ Cellular network unavailable for clock synchronization.");
        carryClockFromServer();
        return isSystemClockValid();
    }

    for (uint8_t attempt = 0; attempt < 5 && millis() - startedAt < timeoutMs; attempt++) {
        time_t utcEpoch = 0;
        if (readNetworkEpoch(utcEpoch)) {
            const int64_t deviceMs = sbinmesh::epochMsNow();
            const time_t deviceEpoch = static_cast<time_t>(deviceMs / 1000);
            slotSyncPending = esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_TIMER &&
                              sleepLeadSeconds > 0 && nextWakeEpoch != 0;
            slotSyncFromNetwork = true;
            if (slotSyncPending) {
                firstReadDeviceEpoch = deviceEpoch;
                firstReadNetworkEpoch = utcEpoch;
                firstReadCorrectionMs = static_cast<int64_t>(utcEpoch) * 1000LL - deviceMs;
                firstReadMillis = millis();
            } else {
                recordWakeTiming(deviceEpoch, utcEpoch);
                recordClockDrift(deviceEpoch, utcEpoch);
            }
            sbinmesh::setEpochMs(static_cast<int64_t>(utcEpoch) * 1000LL);
            clockSynced = true;
            clockFromServer = false;
            Serial.println("✅ Clock synchronized from the cellular network.");
            return true;
        }
        delay(1000);
    }

    Serial.println("⚠️ Could not read valid network time; using the retained RTC clock if available.");
    setenv("TZ", "UTC0", 1);
    tzset();
    carryClockFromServer();
    return isSystemClockValid();
}

bool shouldRefreshGpsLocation() {
    if (!hasGpsFix || lastGpsAttemptEpoch <= 0 || !isSystemClockValid()) {
        return true;
    }

    time_t now = time(nullptr);
    return difftime(now, lastGpsAttemptEpoch) >= GPS_REFRESH_INTERVAL_SECONDS;
}

void recordGpsAttempt() {
    if (!isSystemClockValid()) {
        return;
    }

    lastGpsAttemptEpoch = time(nullptr);
    preferences.begin("credentials", false);
    preferences.putLong64("gpsAttempt", static_cast<int64_t>(lastGpsAttemptEpoch));
    preferences.end();
}

void saveLastKnownLocation() {
    if (!isSystemClockValid()) {
        Serial.println("⚠️ GPS fix acquired, but clock is invalid; location timestamp was not saved.");
        return;
    }

    lastGpsUpdateEpoch = time(nullptr);
    lastGpsAttemptEpoch = lastGpsUpdateEpoch;
    preferences.begin("credentials", false);
    preferences.putFloat("gpsLat", latitude);
    preferences.putFloat("gpsLon", longitude);
    preferences.putLong64("gpsEpoch", static_cast<int64_t>(lastGpsUpdateEpoch));
    preferences.putLong64("gpsAttempt", static_cast<int64_t>(lastGpsAttemptEpoch));
    preferences.end();
}

// The sleep clock drifts by minutes over 12 hours and the drift changes from
// cycle to cycle, so a slot sleep ends sleepLeadSeconds early on purpose. Once
// network time says roughly how long is left, this waits out the rest in light
// sleep (the modem in its own sleep mode), re-reads network time just before
// the slot and returns on it: the mesh window opens on the slot to about a
// second, wherever the drifting clock woke the gateway. The re-read is also
// what this wake's timing and drift are measured against, so it always
// happens, even when the first read puts the slot seconds away or past. If it
// shows the first read was far ahead, the rest is slept out the same way. A
// wake that is really late returns at once after the re-read.
void waitForSlotStart() {
    if (!slotSyncPending) {
        return;
    }
    slotSyncPending = false;

    constexpr uint8_t MAX_SLOT_SLEEPS = 3;
    // A clock the server set has no network read to measure the wake against.
    bool measured = !slotSyncFromNetwork;
    int64_t untilSlotMs = static_cast<int64_t>(nextWakeEpoch) * 1000LL - sbinmesh::epochMsNow();
    for (uint8_t round = 0; round < MAX_SLOT_SLEEPS && untilSlotMs <= MAX_SLOT_WAIT_SECONDS * 1000LL; round++) {
        int64_t waitMs = untilSlotMs - SLOT_RESYNC_SECONDS * 1000LL;
        if (round == 0 && slotSyncFromNetwork) {
            const int64_t sinceFirstReadMs = static_cast<int64_t>(millis() - firstReadMillis);
            waitMs = max(waitMs, MIN_RESYNC_GAP_MS - sinceFirstReadMs);
        } else if (waitMs <= 1000) {
            break;
        }
        if (waitMs > 1000) {
            Serial.printf("⏳ %lld s until the slot; light sleep with the modem asleep.\n",
                          static_cast<long long>(untilSlotMs / 1000));
            Serial.flush();
            modem.sleepEnable(true);
            digitalWrite(BOARD_MODEM_DTR_PIN, HIGH);
            // The light-sleep timer runs on the same RC clock as deep sleep.
            const uint64_t timerMs = sbinmesh::applyDriftCorrection(static_cast<uint64_t>(waitMs), driftPpm);
            const uint32_t sleepStartedMs = millis();
            esp_sleep_enable_timer_wakeup(timerMs * 1000ULL);
            esp_light_sleep_start();
            lightSleptMs += millis() - sleepStartedMs;

            // DTR low for at least 50 ms wakes the modem; then leave its sleep mode.
            digitalWrite(BOARD_MODEM_DTR_PIN, LOW);
            delay(100);
            modem.testAT(1000);
            modem.sleepEnable(false);
        } else if (waitMs > 0) {
            delay(static_cast<uint32_t>(waitMs));
        }
        time_t utcEpoch = 0;
        const int64_t deviceMs = sbinmesh::epochMsNow();
        if (!readNetworkEpoch(utcEpoch)) {
            Serial.println("⚠️ Could not re-read network time after the wait; using the sleep clock.");
            break;
        }
        if (!measured) {
            // Against the clock as the deep sleep left it, before the first read moved it.
            const time_t deviceEpoch = static_cast<time_t>((deviceMs - firstReadCorrectionMs) / 1000);
            recordWakeTiming(deviceEpoch, utcEpoch);
            recordClockDrift(deviceEpoch, utcEpoch);
            measured = true;
        }
        sbinmesh::setEpochMs(static_cast<int64_t>(utcEpoch) * 1000LL);
        clockFromServer = false;
        untilSlotMs = static_cast<int64_t>(nextWakeEpoch) * 1000LL - sbinmesh::epochMsNow();
    }
    if (!measured) {
        // No re-read: measure against the first read, carried forward to now.
        const time_t elapsed = static_cast<time_t>((millis() - firstReadMillis) / 1000UL);
        recordWakeTiming(firstReadDeviceEpoch + elapsed, firstReadNetworkEpoch + elapsed);
        recordClockDrift(firstReadDeviceEpoch + elapsed, firstReadNetworkEpoch + elapsed);
    }

    if (untilSlotMs <= 0) {
        Serial.printf("⚠️ Reached the slot %lld s late; opening the mesh window now.\n",
                      static_cast<long long>(-untilSlotMs / 1000));
        return;
    }
    if (untilSlotMs > MAX_SLOT_WAIT_SECONDS * 1000LL) {
        return;
    }
    delay(static_cast<uint32_t>(untilSlotMs));
    Serial.println("🎯 Slot reached; opening the mesh window on time.");
}

void enterDeepSleepUntilNextReport() {
    const bool clockValid = isSystemClockValid();
    const uint64_t now = clockValid ? static_cast<uint64_t>(time(nullptr)) : 0;
    uint64_t wakeEpoch = nextWakeEpoch;
    uint64_t sleepSeconds = 0;
    uint32_t leadSeconds = 0;

    // A slot that passed with no reply from the server: the pattern continues,
    // so this device is back for the next one.
    if (clockValid && wakeEpoch > 0 && wakeEpoch <= now && slotPeriodSeconds > 0) {
        wakeEpoch += ((now - wakeEpoch) / slotPeriodSeconds + 1) * slotPeriodSeconds;
        nextWakeEpoch = wakeEpoch;
        preferences.begin("credentials", false);
        preferences.putULong64("nextWake", nextWakeEpoch);
        preferences.end();
    }

    // A stored wake further ahead than any schedule is stale; the server's
    // sleep length replaces it below.
    if (clockValid && wakeEpoch > now && wakeEpoch - now <= sbinmesh::MAX_WAKE_AHEAD_SECONDS) {
        sleepSeconds = wakeEpoch - now;
        leadSeconds = slotLeadSeconds(sleepSeconds);
    } else {
        sleepSeconds = scheduledSleepDurationSeconds > 0
            ? scheduledSleepDurationSeconds
            : FALLBACK_SLEEP_SECONDS;
        if (clockValid) {
            wakeEpoch = now + sleepSeconds;
            nextWakeEpoch = wakeEpoch;
            preferences.begin("credentials", false);
            preferences.putULong64("nextWake", nextWakeEpoch);
            preferences.end();
        }
        Serial.printf(
            "⚠️ No future server wake time; using local %llu-second sleep before retrying.\n",
            static_cast<unsigned long long>(sleepSeconds)
        );
    }

    enterDeepSleep(sleepSeconds, leadSeconds);
}

void enterDeepSleepForSetupRetry(uint32_t sleepSeconds, const char* reason) {
    Serial.printf(
        "❌ %s; sleeping %lu seconds before retrying.\n",
        reason,
        static_cast<unsigned long>(sleepSeconds)
    );
    enterDeepSleep(sleepSeconds, 0);
}
