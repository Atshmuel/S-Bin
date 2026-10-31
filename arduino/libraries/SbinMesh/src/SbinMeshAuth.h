#pragma once

#include <stddef.h>
#include <stdint.h>

#include "SbinMeshProtocol.h"

// Authentication of the mesh's packets (2m). Every beacon, DATA and ACK ends
// with a tag: HMAC-SHA256 over the packet, cut to TAG_LENGTH bytes, with the
// fields a relay changes on the way zeroed (hops and ttl; a beacon's hop count
// and parent). A packet without the right tag is dropped before anything reads it.
//
// Who holds what:
//   - the server makes a secret for each organization and gives it to the
//     organization's gateways (the organization key);
//   - a leaf holds only its own key, derived from that secret and its MAC, and
//     the beacon key, so a stolen leaf can speak only as itself;
//   - beacons are signed with the beacon key, DATA and ACKs with the leaf's own.
//
// Replay: a gateway's beacons carry a random nonce for its mesh window, the
// DATA answering one echoes it inside the tag, and the gateway accepts only
// this window's and the previous window's. No counter has to survive a power loss.
//
// This file has no Arduino dependency, so the tests run on a computer.

namespace sbinmesh {

constexpr size_t KEY_LENGTH = 32;

struct Key {
    uint8_t bytes[KEY_LENGTH];
};

// HMAC-SHA256: SbinMeshHmac.cpp on the ESP32 (the tests bring their own).
void hmacSha256(const uint8_t* key, size_t keyLength, const uint8_t* data, size_t dataLength,
                uint8_t out[32]);

// The keys a leaf gets, from the organization key. The server derives the same
// ones (server/utils/meshKeys.js), HMAC-SHA256(organizationKey, label + MAC)
// for a leaf and HMAC-SHA256(organizationKey, label) for the beacons.
Key deriveLeafKey(const Key& organizationKey, const uint8_t mac[MAC_LENGTH]);
Key deriveBeaconKey(const Key& organizationKey);

// The tag of a packet's first bodyLength bytes (the struct, without a tag).
void computeTag(const Key& key, const uint8_t* packet, size_t bodyLength, uint8_t out[TAG_LENGTH]);

enum class AuthResult : uint8_t {
    OK = 0,
    NO_KEY,           // this node holds no key yet
    BAD_LENGTH,       // not a packet of its type with a tag
    UNKNOWN_KEY_ID,   // signed with a key generation this node does not hold
    BAD_TAG,          // not signed with the right key, or altered
    STALE_NONCE,      // genuine, but answers a mesh window that is over
    NOT_FOR_ME,       // a packet this node's role does not take
};
constexpr size_t AUTH_RESULT_COUNT = 7;
const char* authResultName(AuthResult result);

// A node's keys, and the signing and checking that use them. A gateway holds the
// organization key (the previous one stays valid after a rotation); a leaf
// holds its derived keys.
class MeshAuth {
public:
    void useOrganizationKey(const Key& key, uint8_t keyId,
                            const Key* previous = nullptr, uint8_t previousKeyId = 0);
    void useLeafKeys(const uint8_t ownMac[MAC_LENGTH], const Key& leafKey, const Key& beaconKey,
                     uint8_t keyId);
    // A leaf that has no keys yet and is asking to join (SbinMeshJoin.h): it
    // cannot check a beacon, so it takes any well-formed one for its timing, and
    // takes the reply to its JOIN, which is sealed and checked by its own tag.
    // It signs nothing; once it has keys it uses useLeafKeys().
    void useJoining(const uint8_t ownMac[MAC_LENGTH]);
    bool hasKey() const { return role_ != Role::None; }
    uint8_t keyId() const { return keyId_; }

    // A gateway's mesh window: the nonce its beacons carry and DATA must echo.
    void startWindow(uint32_t nonce);
    uint32_t windowNonce() const { return nonce_; }

    // Each sets the packet's key ID, appends the tag after its bodyLength bytes
    // (the buffer needs TAG_LENGTH spare bytes) and returns the new length, or 0
    // when this node's role cannot sign it.
    size_t signBeacon(uint8_t* packet, size_t bodyLength) const;               // a gateway
    size_t signAck(uint8_t* packet, size_t bodyLength, uint8_t keyId) const;   // a gateway, with the key of the DATA it answers
    size_t signData(uint8_t* packet, size_t bodyLength) const;                 // a leaf

    // Checks a received frame; anything but OK is counted.
    AuthResult verify(const uint8_t* frame, size_t length);
    uint32_t dropped(AuthResult why) const { return counts_[static_cast<size_t>(why)]; }
    void resetCounts();

private:
    enum class Role : uint8_t { None, Gateway, Leaf, Joining };

    AuthResult check(const uint8_t* frame, size_t length) const;
    bool organizationKeyFor(uint8_t keyId, Key& out) const;
    size_t sign(uint8_t* packet, size_t bodyLength, const Key& key, uint8_t keyId) const;
    bool nonceAccepted(uint32_t nonce) const;

    Role role_ = Role::None;
    uint8_t keyId_ = 0;
    Key organizationKey_ = {};
    Key previousKey_ = {};
    uint8_t previousKeyId_ = 0;
    bool hasPrevious_ = false;
    uint8_t ownMac_[MAC_LENGTH] = {};
    Key leafKey_ = {};
    Key beaconKey_ = {};
    uint32_t nonce_ = 0;
    uint32_t previousNonce_ = 0;
    bool hasNonce_ = false;
    bool hasPreviousNonce_ = false;
    uint32_t counts_[AUTH_RESULT_COUNT] = {};
};

// A beacon's time against the leaf's own clock: with a clock, one more than
// toleranceMs away is a replayed or forged beacon. Without a clock (a cold
// join) there is nothing to compare with.
bool beaconTimeIsFresh(bool clockValid, int64_t beaconEpochMs, int64_t nowEpochMs, int64_t toleranceMs);

}  // namespace sbinmesh
