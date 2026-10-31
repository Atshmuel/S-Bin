#include "SbinMeshAuth.h"

#include <stddef.h>
#include <string.h>

namespace sbinmesh {

namespace {
// Keep these in step with the server's utils/meshKeys.js.
constexpr char LEAF_KEY_LABEL[] = "S-Bin mesh leaf key v1";
constexpr char BEACON_KEY_LABEL[] = "S-Bin mesh beacon key v1";
constexpr size_t HMAC_LENGTH = 32;
static_assert(HMAC_LENGTH == KEY_LENGTH, "a derived key is one HMAC");

// Equal in constant time: a wrong tag takes as long to reject as a nearly right one.
bool sameBytes(const uint8_t* a, const uint8_t* b, size_t length) {
    uint8_t difference = 0;
    for (size_t i = 0; i < length; i++) {
        difference |= static_cast<uint8_t>(a[i] ^ b[i]);
    }
    return difference == 0;
}

bool tagIsValid(const Key& key, const uint8_t* frame, size_t length) {
    const size_t bodyLength = length - TAG_LENGTH;
    uint8_t expected[TAG_LENGTH];
    computeTag(key, frame, bodyLength, expected);
    return sameBytes(expected, frame + bodyLength, TAG_LENGTH);
}
}  // namespace

Key deriveLeafKey(const Key& organizationKey, const uint8_t mac[MAC_LENGTH]) {
    constexpr size_t labelLength = sizeof(LEAF_KEY_LABEL) - 1;
    uint8_t input[labelLength + MAC_LENGTH];
    memcpy(input, LEAF_KEY_LABEL, labelLength);
    memcpy(input + labelLength, mac, MAC_LENGTH);
    Key key;
    hmacSha256(organizationKey.bytes, KEY_LENGTH, input, sizeof(input), key.bytes);
    return key;
}

Key deriveBeaconKey(const Key& organizationKey) {
    Key key;
    hmacSha256(organizationKey.bytes, KEY_LENGTH,
               reinterpret_cast<const uint8_t*>(BEACON_KEY_LABEL), sizeof(BEACON_KEY_LABEL) - 1,
               key.bytes);
    return key;
}

void computeTag(const Key& key, const uint8_t* packet, size_t bodyLength, uint8_t out[TAG_LENGTH]) {
    memset(out, 0, TAG_LENGTH);
    if (bodyLength < sizeof(PacketHeader) || bodyLength > MAX_FRAME_SIZE - TAG_LENGTH) {
        return;
    }
    uint8_t body[MAX_FRAME_SIZE];
    memcpy(body, packet, bodyLength);
    // What a relay changes on the way stays out of the tag, so forwarding needs no re-signing.
    body[offsetof(PacketHeader, hops)] = 0;
    body[offsetof(PacketHeader, ttl)] = 0;
    if (body[offsetof(PacketHeader, type)] == PACKET_BEACON && bodyLength >= sizeof(BeaconPacket)) {
        body[offsetof(BeaconPacket, hopsToGateway)] = 0;
        memset(body + offsetof(BeaconPacket, parentMac), 0, MAC_LENGTH);
    }
    uint8_t full[HMAC_LENGTH];
    hmacSha256(key.bytes, KEY_LENGTH, body, bodyLength, full);
    memcpy(out, full, TAG_LENGTH);
}

const char* authResultName(AuthResult result) {
    switch (result) {
        case AuthResult::OK: return "ok";
        case AuthResult::NO_KEY: return "no key";
        case AuthResult::BAD_LENGTH: return "bad length";
        case AuthResult::UNKNOWN_KEY_ID: return "unknown key id";
        case AuthResult::BAD_TAG: return "bad tag";
        case AuthResult::STALE_NONCE: return "stale nonce";
        case AuthResult::NOT_FOR_ME: return "not for me";
    }
    return "?";
}

void MeshAuth::useOrganizationKey(const Key& key, uint8_t keyId, const Key* previous,
                                  uint8_t previousKeyId) {
    role_ = Role::Gateway;
    organizationKey_ = key;
    keyId_ = keyId;
    hasPrevious_ = previous != nullptr;
    if (previous != nullptr) {
        previousKey_ = *previous;
        previousKeyId_ = previousKeyId;
    }
}

void MeshAuth::useLeafKeys(const uint8_t ownMac[MAC_LENGTH], const Key& leafKey,
                           const Key& beaconKey, uint8_t keyId) {
    role_ = Role::Leaf;
    memcpy(ownMac_, ownMac, MAC_LENGTH);
    leafKey_ = leafKey;
    beaconKey_ = beaconKey;
    keyId_ = keyId;
}

void MeshAuth::useJoining(const uint8_t ownMac[MAC_LENGTH]) {
    role_ = Role::Joining;
    memcpy(ownMac_, ownMac, MAC_LENGTH);
    keyId_ = 0;
}

void MeshAuth::startWindow(uint32_t nonce) {
    previousNonce_ = nonce_;
    hasPreviousNonce_ = hasNonce_;
    nonce_ = nonce;
    hasNonce_ = true;
}

bool MeshAuth::nonceAccepted(uint32_t nonce) const {
    return (hasNonce_ && nonce == nonce_) || (hasPreviousNonce_ && nonce == previousNonce_);
}

bool MeshAuth::organizationKeyFor(uint8_t keyId, Key& out) const {
    if (keyId == keyId_) {
        out = organizationKey_;
        return true;
    }
    if (hasPrevious_ && keyId == previousKeyId_) {
        out = previousKey_;
        return true;
    }
    return false;
}

size_t MeshAuth::sign(uint8_t* packet, size_t bodyLength, const Key& key, uint8_t keyId) const {
    packet[offsetof(PacketHeader, keyId)] = keyId;
    computeTag(key, packet, bodyLength, packet + bodyLength);
    return bodyLength + TAG_LENGTH;
}

size_t MeshAuth::signBeacon(uint8_t* packet, size_t bodyLength) const {
    if (role_ != Role::Gateway || bodyLength != sizeof(BeaconPacket)) {
        return 0;
    }
    return sign(packet, bodyLength, deriveBeaconKey(organizationKey_), keyId_);
}

size_t MeshAuth::signAck(uint8_t* packet, size_t bodyLength, uint8_t keyId) const {
    Key organizationKey;
    if (role_ != Role::Gateway || bodyLength != sizeof(AckPacket) ||
        !organizationKeyFor(keyId, organizationKey)) {
        return 0;
    }
    const AckPacket* ack = reinterpret_cast<const AckPacket*>(packet);
    return sign(packet, bodyLength, deriveLeafKey(organizationKey, ack->ackedOrigin), keyId);
}

size_t MeshAuth::signData(uint8_t* packet, size_t bodyLength) const {
    if (role_ != Role::Leaf || bodyLength != sizeof(DataPacket)) {
        return 0;
    }
    return sign(packet, bodyLength, leafKey_, keyId_);
}

AuthResult MeshAuth::check(const uint8_t* frame, size_t length) const {
    if (role_ == Role::None) {
        return AuthResult::NO_KEY;
    }
    if (length < sizeof(PacketHeader)) {
        return AuthResult::BAD_LENGTH;
    }
    const PacketHeader* header = reinterpret_cast<const PacketHeader*>(frame);
    Key organizationKey;

    switch (header->type) {
        case PACKET_BEACON: {
            if (length != sizeof(BeaconPacket) + TAG_LENGTH) {
                return AuthResult::BAD_LENGTH;
            }
            if (role_ == Role::Joining) {
                return AuthResult::OK;
            }
            Key beaconKey;
            if (role_ == Role::Gateway) {
                if (!organizationKeyFor(header->keyId, organizationKey)) {
                    return AuthResult::UNKNOWN_KEY_ID;
                }
                beaconKey = deriveBeaconKey(organizationKey);
            } else {
                if (header->keyId != keyId_) {
                    return AuthResult::UNKNOWN_KEY_ID;
                }
                beaconKey = beaconKey_;
            }
            return tagIsValid(beaconKey, frame, length) ? AuthResult::OK : AuthResult::BAD_TAG;
        }
        case PACKET_DATA: {
            if (length != sizeof(DataPacket) + TAG_LENGTH) {
                return AuthResult::BAD_LENGTH;
            }
            if (role_ != Role::Gateway) {
                return AuthResult::NOT_FOR_ME;
            }
            if (!organizationKeyFor(header->keyId, organizationKey)) {
                return AuthResult::UNKNOWN_KEY_ID;
            }
            if (!tagIsValid(deriveLeafKey(organizationKey, header->origin), frame, length)) {
                return AuthResult::BAD_TAG;
            }
            // After the tag, so a stale nonce means a genuine packet that is old.
            const DataPacket* data = reinterpret_cast<const DataPacket*>(frame);
            return nonceAccepted(data->beaconNonce) ? AuthResult::OK : AuthResult::STALE_NONCE;
        }
        case PACKET_ACK: {
            if (length != sizeof(AckPacket) + TAG_LENGTH) {
                return AuthResult::BAD_LENGTH;
            }
            const AckPacket* ack = reinterpret_cast<const AckPacket*>(frame);
            if (role_ != Role::Leaf || memcmp(ack->ackedOrigin, ownMac_, MAC_LENGTH) != 0) {
                return AuthResult::NOT_FOR_ME;
            }
            if (header->keyId != keyId_) {
                return AuthResult::UNKNOWN_KEY_ID;
            }
            return tagIsValid(leafKey_, frame, length) ? AuthResult::OK : AuthResult::BAD_TAG;
        }
        case PACKET_JOIN: {
            if (length != sizeof(JoinPacket)) {
                return AuthResult::BAD_LENGTH;
            }
            // Not signed (the leaf has no key); the server checks its proof.
            return role_ == Role::Gateway ? AuthResult::OK : AuthResult::NOT_FOR_ME;
        }
        case PACKET_JOIN_REPLY: {
            if (length != sizeof(JoinReplyPacket)) {
                return AuthResult::BAD_LENGTH;
            }
            const JoinReplyPacket* reply = reinterpret_cast<const JoinReplyPacket*>(frame);
            return role_ == Role::Joining && memcmp(reply->leafMac, ownMac_, MAC_LENGTH) == 0
                ? AuthResult::OK
                : AuthResult::NOT_FOR_ME;
        }
        default:
            return AuthResult::BAD_LENGTH;
    }
}

AuthResult MeshAuth::verify(const uint8_t* frame, size_t length) {
    const AuthResult result = check(frame, length);
    if (result != AuthResult::OK) {
        counts_[static_cast<size_t>(result)]++;
    }
    return result;
}

void MeshAuth::resetCounts() {
    memset(counts_, 0, sizeof(counts_));
}

bool beaconTimeIsFresh(bool clockValid, int64_t beaconEpochMs, int64_t nowEpochMs, int64_t toleranceMs) {
    if (!clockValid) {
        return true;
    }
    const int64_t difference = beaconEpochMs - nowEpochMs;
    return (difference < 0 ? -difference : difference) <= toleranceMs;
}

}  // namespace sbinmesh
