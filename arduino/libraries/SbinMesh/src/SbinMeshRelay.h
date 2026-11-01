#pragma once

#include <stddef.h>
#include <stdint.h>

#include "SbinMeshProtocol.h"

// A leaf that relays for another leaf out of the gateway's range (2n). One relay
// sits between a leaf and its gateway, so a frame is forwarded once at most:
//
//   - a gateway's BEACON is rebroadcast with hopsToGateway 1 and this node as its
//     parent, so a leaf out of range hears the window and learns the time and the slot;
//   - the leaf's DATA goes up to the gateway the beacon came from;
//   - the gateway's ACK (with a command) and a KEY_UPDATE go down to the leaf they name.
//
// The signatures do not cover hops, ttl, a beacon's hopsToGateway or its parent
// (SbinMeshAuth.h), so none of this needs a key: a relay holds only its own leaf
// key and the beacon key, cannot make or change what it carries, and can only drop
// or delay it. The destination checks every tag. Because nothing is checked here,
// what is passed on is limited: exact lengths, one hop, a time to live, packets
// seen before are dropped, and a window's worth at most (RelayBudget).
//
// No Arduino dependency, so the tests run on a computer.

namespace sbinmesh {

enum class ForwardKind : uint8_t {
    NONE,     // not passed on
    BEACON,   // broadcast
    UP,       // to the gateway
    DOWN,     // to a leaf
};

struct ForwardAction {
    ForwardKind kind;
    size_t length;                      // of the frame to send, in `out`
    uint8_t destination[MAC_LENGTH];    // unicast target (all 0xFF for a beacon)
};

// Decides whether a frame heard by a relay is passed on and, if so, prepares it in
// `out` (the same bytes with hops, ttl and a beacon's route fields changed).
// `ownMac` is this relay; `parentMac` the gateway whose beacon it follows (all zero
// before it heard one, when DATA cannot go up).
ForwardAction prepareForward(const uint8_t* frame, size_t length, const uint8_t ownMac[MAC_LENGTH],
                             const uint8_t parentMac[MAC_LENGTH], uint8_t out[MAX_FRAME_SIZE]);

// The last frames passed on, by sender and message ID, so a retry or a copy heard
// twice is passed on once. A ring: the oldest is forgotten first.
class RelayMemory {
public:
    // True when this pair was passed on before; otherwise remembers it.
    bool seen(const uint8_t origin[MAC_LENGTH], uint32_t messageId);
    void reset();

private:
    static constexpr size_t SIZE = 32;
    struct Entry {
        uint8_t origin[MAC_LENGTH];
        uint32_t messageId;
        bool used;
    };
    Entry entries_[SIZE] = {};
    size_t next_ = 0;
};

// What a relay passes on in one window at most, by kind: junk it cannot check must
// not keep it forwarding (and awake).
class RelayBudget {
public:
    static constexpr uint16_t BEACONS = 40;
    static constexpr uint16_t UP = 48;
    static constexpr uint16_t DOWN = 48;

    void reset() { beacons_ = up_ = down_ = 0; }
    // True, and counted, while the kind is within its limit.
    bool take(ForwardKind kind);

private:
    uint16_t beacons_ = 0;
    uint16_t up_ = 0;
    uint16_t down_ = 0;
};

}  // namespace sbinmesh
