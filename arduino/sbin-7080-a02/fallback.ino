#include "globals.h"

// A gateway that cannot reach the server still reports: as a leaf, through
// another gateway of its organization, whose slot it shares. It opens no window
// of its own meanwhile (its leaves wait), and stays a gateway: every wake tries
// its own link first, so a SIM put back or the network returning ends it.
//
// Without a modem (no SIM, or one that does not start) the whole wake is the
// leaf cycle, whose guard and drift find the other gateway's slot without
// network time. With a modem but two cycles in a row without a report, it
// delivers once at the slot and then still tries its own link.

// Cycles in a row that ended without a report (RTC memory: a power loss
// starts over, and the first failure after it falls back again by itself).
RTC_DATA_ATTR uint8_t cyclesWithoutReport = 0;

namespace {
constexpr uint8_t FALLBACK_AFTER_FAILED_REPORTS = 2;
// Listened past the slot and the window, for the other gateway's clock.
constexpr uint32_t FALLBACK_LISTEN_SLACK_SECONDS = 30;
constexpr uint32_t FALLBACK_MIN_LISTEN_SECONDS = 20;
// Without a usable slot (no clock, no schedule) it listens this long at most.
constexpr uint32_t FALLBACK_MAX_LISTEN_SECONDS = 20UL * 60UL;

// The clock may be minutes off (no network time), so this does not go by it: a
// slot wake came sleepLeadSeconds before the slot, by a timer corrected for the
// drift, and the lead again is room for the drift having moved.
uint32_t fallbackListenSeconds() {
    if (sleepLeadSeconds == 0 || esp_sleep_get_wakeup_cause() != ESP_SLEEP_WAKEUP_TIMER) {
        return FALLBACK_MAX_LISTEN_SECONDS;
    }
    return constrain(2UL * sleepLeadSeconds + meshAwakeWindowSeconds + FALLBACK_LISTEN_SLACK_SECONDS,
                     FALLBACK_MIN_LISTEN_SECONDS, FALLBACK_MAX_LISTEN_SECONDS);
}
}

bool reportsFailedTooOften() {
    return cyclesWithoutReport >= FALLBACK_AFTER_FAILED_REPORTS;
}

void recordReportOutcome(bool reportSent) {
    if (reportSent) {
        cyclesWithoutReport = 0;
    } else if (cyclesWithoutReport < UINT8_MAX) {
        cyclesWithoutReport++;
    }
}

// The rest of this wake as a leaf, why this gateway cannot report itself
// (DATA_SIM_MISSING or DATA_NO_CELLULAR) with its reading. It returns only
// without a mesh key; otherwise the leaf cycle ends in the deep sleep.
void reportAsLeafUntilNextWake(uint8_t reasonFlag) {
    sbinmesh::LeafKeys keys = {};
    if (!ownLeafKeys(keys)) {
        Serial.println("⚠️ No mesh key yet, so no other gateway can take this report.");
        return;
    }
    Serial.printf("🔁 Reporting through another gateway (%s).\n",
                  reasonFlag == sbinmesh::DATA_SIM_MISSING ? "no SIM card" : "no cellular link");
    leafFallbackFlags = reasonFlag;
    // The leaf cycle's sleeps are not this gateway's: no drift or wake timing
    // is measured over them if the modem answers again.
    sleepStartedEpoch = 0;
    sleepLeadSeconds = 0;
    sbinmesh::LeafConfig config = makeLeafConfig(keys);
    config.hooks.afterDelivery = becomeLeafIfAsked;
    runLeafCycleWith(config);
}

// Sends this cycle's reading through another gateway, the failing cellular link
// (DATA_NO_CELLULAR) with it. The beacon's slot becomes this gateway's next
// wake, so it keeps its slot without network time.
bool reportThroughAnotherGateway() {
    sbinmesh::LeafKeys keys = {};
    if (!ownLeafKeys(keys)) {
        Serial.println("⚠️ No mesh key yet, so no other gateway can take this report.");
        return false;
    }
    Serial.println("🔁 Reporting through another gateway (no cellular link).");
    leafFallbackFlags = sbinmesh::DATA_NO_CELLULAR;
    const sbinmesh::LeafConfig config = makeLeafConfig(keys);
    const sbinmesh::LeafExchange exchange = sbinmesh::runLeafExchange(config, fallbackListenSeconds() * 1000UL);
    leafFallbackFlags = 0;

    if (exchange.heardBeacon) {
        // The beacon set the clock: no drift is left to take off it.
        clockFromServer = false;
    }
    if (exchange.heardBeacon && exchange.nextWakeEpoch > 0) {
        nextWakeEpoch = exchange.nextWakeEpoch;
        preferences.begin("credentials", false);
        preferences.putULong64("nextWake", nextWakeEpoch);
        preferences.end();
    }
    Serial.println(exchange.delivered ? "✅ Report delivered through another gateway."
                                      : "⚠️ No other gateway took the report.");
    return exchange.delivered;
}
