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

// The keys a leaf got by joining (SbinMeshJoin.h), kept in flash: the same
// struct a sketch passes in LeafConfig. False when there are none, or they are
// not for this board.
bool loadJoinedKeys(LeafKeys& keys);
// The keys in flash, when they are a later generation than the ones in `keys` (or
// `keys` has none): a rotation leaves the new keys there, and they must win over
// the older ones a sketch has (a bench header, the organization key a former
// gateway kept). True when `keys` was replaced.
bool loadNewerJoinedKeys(LeafKeys& keys);
void saveJoinedKeys(const LeafKeys& keys);
void forgetJoinedKeys();

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

// A leaf without keys asks a gateway for them (SbinMeshJoin.h): its organization
// ID and the one-time join code from its setup page (32 hex characters).
struct JoinConfig {
    const char* organizationId;
    const char* joinCode;
};

enum class JoinOutcome : uint8_t {
    JOINED,         // keys is filled and kept in flash (saveJoinedKeys)
    NO_ANSWER,      // no gateway window in time, or no answer to the JOIN: try again later
    REFUSED,        // the server did not accept it (code used, expired or wrong), as far as an unchecked reply says
    BAD_SETTINGS,   // the organization ID or the code is not valid
};

// Listens up to listenMs for a gateway's beacon (which it cannot check, so it only
// uses it to know a window is open), sends one JOIN per window and waits for the
// answer. On JOINED the gateway's window is usually still open, so a leaf cycle
// started at once cold-joins on its authenticated beacons and delivers its
// first reading in the same window.
JoinOutcome joinMesh(const JoinConfig& config, LeafKeys& keys, uint32_t listenMs);

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
