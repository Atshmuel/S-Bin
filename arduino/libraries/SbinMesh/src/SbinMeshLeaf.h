#pragma once

#include <stdint.h>

#include "SbinMeshAuth.h"
#include "SbinMeshProtocol.h"

// A mesh leaf's whole wake, shared by every leaf firmware: it wakes on the
// schedule it learned from a gateway's beacons (or listens for one, a cold
// join), sends its queued readings, runs the commands the ACKs carry (also one
// that follows the reading's ACK within the gateway's window) and deep-sleeps
// until the next slot. The clock, the sleep-clock drift, the
// guard and the queue live here; a board only measures, through its hooks.
//
// The state that survives deep sleep is in RTC memory and is lost on power
// loss or a reset (a cold join); the drift is also kept in flash.

namespace sbinmesh {

struct LeafKeys {
    uint8_t mac[MAC_LENGTH];   // the board the keys were made for
    uint8_t leafKey[KEY_LENGTH];
    uint8_t beaconKey[KEY_LENGTH];
    uint8_t keyId;
};

struct LeafHooks {
    // Fills a reading's measurements (flags, level, battery, distance, weight,
    // location); the header, schedule and diagnostics are filled already.
    void (*fillReading)(DataPacket& reading);
    // Runs a command from an ACK and sets its result on the fresh reading taken
    // for it (resultStatus, resultCode, resultValue, resultExtra).
    void (*runInstruction)(const AckPacket& ack, DataPacket& reading);
    // Optional: after the readings went out to a gateway (the clock is set from
    // its beacon), before the next sleep is worked out, so slow work (a GPS
    // fix) does not make the leaf late for its slot.
    void (*afterDelivery)();
    // Optional: last thing before the deep sleep (rails off, logs flushed).
    void (*beforeSleep)();
};

struct LeafConfig {
    const char* organizationId;
    uint8_t firmwareVersion[3];
    LeafKeys keys;
    LeafHooks hooks;
};

// One wake, from the boot to the deep sleep; it never returns.
[[noreturn]] void runLeafCycle(const LeafConfig& config);

struct LeafExchange {
    bool heardBeacon;
    bool delivered;          // every queued reading was ACKed
    uint32_t nextWakeEpoch;  // the slot the beacon announced, 0 without one
};

// One delivery as a leaf, for a gateway whose own link is failing but which
// tries it again this wake (without a modem, a wake is runLeafCycle): listens
// up to listenMs for another gateway's beacon, sends the queued readings and
// returns, leaving the sleep to the caller. A reading not delivered stays
// queued (in RTC memory) for the next try.
LeafExchange runLeafExchange(const LeafConfig& config, uint32_t listenMs);

}  // namespace sbinmesh
