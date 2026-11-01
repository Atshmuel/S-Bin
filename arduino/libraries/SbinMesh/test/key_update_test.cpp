// Tests of the key rotation without redoing the leaves (SbinMeshKeyUpdate and the
// gateway's beacons for the generation before). Run ./run.sh.
#include <initializer_list>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

#include "SbinMeshAuth.h"
#include "SbinMeshKeyUpdate.h"

using namespace sbinmesh;

static int checks = 0;
static int failures = 0;
#define CHECK(condition)                                                          \
    do {                                                                          \
        checks++;                                                                 \
        if (!(condition)) {                                                       \
            failures++;                                                           \
            printf("FAIL line %d: %s\n", __LINE__, #condition);                   \
        }                                                                         \
    } while (0)

static void fromHex(const char* hex, uint8_t* out, size_t length) {
    for (size_t i = 0; i < length; i++) {
        unsigned value = 0;
        sscanf(hex + 2 * i, "%2x", &value);
        out[i] = static_cast<uint8_t>(value);
    }
}

static Key keyFromHex(const char* hex) {
    Key key;
    fromHex(hex, key.bytes, KEY_LENGTH);
    return key;
}

static Key rangeKey(uint8_t first) {
    Key key;
    for (size_t i = 0; i < KEY_LENGTH; i++) key.bytes[i] = static_cast<uint8_t>(first + i);
    return key;
}

static bool sameKey(const Key& a, const Key& b) {
    return memcmp(a.bytes, b.bytes, KEY_LENGTH) == 0;
}

// The vector computed independently in Python.
static const char* OLD_LEAF_KEY = "ec03733de0bf2c674dfc3e02c081c88c503009e4964933e52b28b7905cb8f3fa";
static const char* IV = "a0a1a2a3a4a5a6a7a8a9aaab";
static const char* SEALED =
    "c0f0f638de78bee98112a5d0ff907d967af73ec11aebf59e73c3b7ac4087162f5a7ab288765eb60a97ad977d53c0179d28120a39a91ce99795352b924f3c94eeed";
static const char* TAG = "7582027ff937ac47659fa80d5b8b17de";

static const uint8_t LEAF_A[MAC_LENGTH] = {0x28, 0x84, 0x85, 0x38, 0x66, 0x44};
static const uint8_t LEAF_B[MAC_LENGTH] = {0x44, 0x1D, 0x64, 0xBD, 0x63, 0x6C};
static const uint8_t GATEWAY_MAC[MAC_LENGTH] = {0xA4, 0xCB, 0x8F, 0xF5, 0x2B, 0x38};

static void testKeyIds() {
    CHECK(keyIdIsNewer(3, 2));
    CHECK(!keyIdIsNewer(2, 3));
    CHECK(!keyIdIsNewer(5, 5));
    CHECK(keyIdIsNewer(1, 255));     // the IDs wrap from 255 to 1
    CHECK(!keyIdIsNewer(255, 1));
    CHECK(keyIdIsNewer(100, 1));
    CHECK(!keyIdIsNewer(200, 1));    // more than half the range ahead is an old one
    CHECK(!keyIdIsNewer(0, 5));      // 0 is no key
    CHECK(keyIdIsNewer(5, 0));
    CHECK(!keyIdIsNewer(0, 0));
}

static KeyUpdatePacket vectorUpdate() {
    KeyUpdatePacket update = {};
    update.header.magic = PACKET_MAGIC;
    update.header.version = PROTOCOL_VERSION;
    update.header.type = PACKET_KEY_UPDATE;
    memcpy(update.header.origin, GATEWAY_MAC, MAC_LENGTH);
    memcpy(update.leafMac, LEAF_A, MAC_LENGTH);
    update.oldKeyId = 2;
    fromHex(IV, update.iv, JOIN_IV_LENGTH);
    fromHex(SEALED, update.sealed, JOIN_SEALED_LENGTH);
    fromHex(TAG, update.tag, JOIN_TAG_LENGTH);
    return update;
}

static void testSealAndOpen() {
    const Key oldLeaf = keyFromHex(OLD_LEAF_KEY);
    const Key newLeaf = rangeKey(0x40);
    const Key newBeacon = rangeKey(0x60);
    uint8_t iv[JOIN_IV_LENGTH];
    fromHex(IV, iv, sizeof(iv));

    KeyUpdatePacket made = {};
    CHECK(sealKeyUpdate(oldLeaf, LEAF_A, 2, iv, 3, newLeaf, newBeacon, made));
    uint8_t expectedSealed[JOIN_SEALED_LENGTH];
    uint8_t expectedTag[JOIN_TAG_LENGTH];
    fromHex(SEALED, expectedSealed, sizeof(expectedSealed));
    fromHex(TAG, expectedTag, sizeof(expectedTag));
    CHECK(memcmp(made.sealed, expectedSealed, sizeof(expectedSealed)) == 0);
    CHECK(memcmp(made.tag, expectedTag, sizeof(expectedTag)) == 0);
    CHECK(!sealKeyUpdate(oldLeaf, LEAF_A, 2, iv, 0, newLeaf, newBeacon, made));  // no key ID 0

    JoinedKeys keys = {};
    CHECK(openKeyUpdate(oldLeaf, LEAF_A, 2, vectorUpdate(), keys));
    CHECK(keys.keyId == 3);
    CHECK(sameKey(keys.leafKey, newLeaf));
    CHECK(sameKey(keys.beaconKey, newBeacon));

    // Only the leaf it is for, holding the generation it names, opens it.
    JoinedKeys other = {};
    CHECK(!openKeyUpdate(oldLeaf, LEAF_B, 2, vectorUpdate(), other));
    CHECK(!openKeyUpdate(oldLeaf, LEAF_A, 3, vectorUpdate(), other));
    CHECK(!openKeyUpdate(rangeKey(0x10), LEAF_A, 2, vectorUpdate(), other));
    for (size_t position : {size_t{0}, size_t{32}, JOIN_SEALED_LENGTH - 1}) {
        KeyUpdatePacket changed = vectorUpdate();
        changed.sealed[position] ^= 0x01;
        CHECK(!openKeyUpdate(oldLeaf, LEAF_A, 2, changed, other));
    }
    KeyUpdatePacket changed = vectorUpdate();
    changed.iv[0] ^= 1;
    CHECK(!openKeyUpdate(oldLeaf, LEAF_A, 2, changed, other));
    changed = vectorUpdate();
    changed.tag[0] ^= 1;
    CHECK(!openKeyUpdate(oldLeaf, LEAF_A, 2, changed, other));
    changed = vectorUpdate();
    changed.oldKeyId = 1;
    CHECK(!openKeyUpdate(oldLeaf, LEAF_A, 1, changed, other));

    // Never a step back: an update to a generation that is not later is refused.
    KeyUpdatePacket backwards = {};
    CHECK(sealKeyUpdate(oldLeaf, LEAF_A, 2, iv, 2, newLeaf, newBeacon, backwards));
    CHECK(!openKeyUpdate(oldLeaf, LEAF_A, 2, backwards, other));
    CHECK(sealKeyUpdate(oldLeaf, LEAF_A, 2, iv, 1, newLeaf, newBeacon, backwards));
    CHECK(!openKeyUpdate(oldLeaf, LEAF_A, 2, backwards, other));
    CHECK(sizeof(KeyUpdatePacket) == 121);
}

static MeshAuth rotatedGateway(const Key& oldOrg, const Key& newOrg) {
    MeshAuth gateway;
    gateway.useOrganizationKey(newOrg, 3, &oldOrg, 2);
    return gateway;
}

static MeshAuth leafOf(const Key& org, const uint8_t* mac, uint8_t keyId) {
    MeshAuth leaf;
    leaf.useLeafKeys(mac, deriveLeafKey(org, mac), deriveBeaconKey(org), keyId);
    return leaf;
}

static BeaconPacket blankBeacon() {
    BeaconPacket beacon = {};
    beacon.header.magic = PACKET_MAGIC;
    beacon.header.version = PROTOCOL_VERSION;
    beacon.header.type = PACKET_BEACON;
    memcpy(beacon.header.origin, GATEWAY_MAC, MAC_LENGTH);
    beacon.epochMs = 1793286000000ULL;
    beacon.nextWakeEpoch = 1793329200;
    beacon.meshWindowSeconds = 10;
    return beacon;
}

static void testBeaconsForBothGenerations() {
    const Key oldOrg = rangeKey(1);
    const Key newOrg = rangeKey(101);
    const MeshAuth gateway = rotatedGateway(oldOrg, newOrg);
    MeshAuth oldLeaf = leafOf(oldOrg, LEAF_A, 2);
    MeshAuth newLeaf = leafOf(newOrg, LEAF_A, 3);

    CHECK(gateway.hasPreviousKey() && gateway.previousKeyId() == 2);
    CHECK(gateway.isPreviousKeyId(2) && !gateway.isPreviousKeyId(3) && !gateway.isPreviousKeyId(9));

    const BeaconPacket beacon = blankBeacon();
    uint8_t current[sizeof(BeaconPacket) + TAG_LENGTH];
    uint8_t previous[sizeof(BeaconPacket) + TAG_LENGTH];
    memcpy(current, &beacon, sizeof(beacon));
    memcpy(previous, &beacon, sizeof(beacon));
    CHECK(gateway.signBeaconFor(current, sizeof(beacon), 3) == sizeof(current));
    CHECK(gateway.signBeaconFor(previous, sizeof(beacon), 2) == sizeof(previous));
    CHECK(gateway.signBeaconFor(previous, sizeof(beacon), 9) == 0);   // a generation it does not hold

    // Each leaf hears the beacon of its own generation, and only that one.
    CHECK(oldLeaf.verify(previous, sizeof(previous)) == AuthResult::OK);
    CHECK(oldLeaf.verify(current, sizeof(current)) == AuthResult::UNKNOWN_KEY_ID);
    CHECK(newLeaf.verify(current, sizeof(current)) == AuthResult::OK);
    CHECK(newLeaf.verify(previous, sizeof(previous)) == AuthResult::UNKNOWN_KEY_ID);

    // signBeacon is still the current generation's.
    uint8_t plain[sizeof(BeaconPacket) + TAG_LENGTH];
    memcpy(plain, &beacon, sizeof(beacon));
    CHECK(gateway.signBeacon(plain, sizeof(beacon)) == sizeof(plain));
    CHECK(newLeaf.verify(plain, sizeof(plain)) == AuthResult::OK);

    // A gateway that holds one generation has no previous to beacon for.
    MeshAuth single;
    single.useOrganizationKey(newOrg, 3);
    CHECK(!single.hasPreviousKey());
    CHECK(single.signBeaconFor(plain, sizeof(beacon), 2) == 0);
}

static void testGatewayMakesTheUpdate() {
    const Key oldOrg = rangeKey(1);
    const Key newOrg = rangeKey(101);
    const MeshAuth gateway = rotatedGateway(oldOrg, newOrg);
    uint8_t iv[JOIN_IV_LENGTH];
    for (size_t i = 0; i < sizeof(iv); i++) iv[i] = static_cast<uint8_t>(0x30 + i);

    KeyUpdatePacket update = {};
    CHECK(gateway.makeKeyUpdate(LEAF_A, 2, iv, update));
    CHECK(memcmp(update.leafMac, LEAF_A, MAC_LENGTH) == 0 && update.oldKeyId == 2);

    // The leaf opens it with the key it had and gets exactly the new generation's keys.
    JoinedKeys keys = {};
    CHECK(openKeyUpdate(deriveLeafKey(oldOrg, LEAF_A), LEAF_A, 2, update, keys));
    CHECK(keys.keyId == 3);
    CHECK(sameKey(keys.leafKey, deriveLeafKey(newOrg, LEAF_A)));
    CHECK(sameKey(keys.beaconKey, deriveBeaconKey(newOrg)));

    // Another leaf's key, or the new generation's, does not open it.
    JoinedKeys other = {};
    CHECK(!openKeyUpdate(deriveLeafKey(oldOrg, LEAF_B), LEAF_A, 2, update, other));
    CHECK(!openKeyUpdate(deriveLeafKey(newOrg, LEAF_A), LEAF_A, 3, update, other));

    // Only for the generation before: not for the current one, or one it never held.
    CHECK(!gateway.makeKeyUpdate(LEAF_A, 3, iv, update));
    CHECK(!gateway.makeKeyUpdate(LEAF_A, 9, iv, update));
    MeshAuth single;
    single.useOrganizationKey(newOrg, 3);
    CHECK(!single.makeKeyUpdate(LEAF_A, 2, iv, update));
    MeshAuth leaf = leafOf(oldOrg, LEAF_A, 2);
    CHECK(!leaf.makeKeyUpdate(LEAF_A, 2, iv, update));  // a leaf makes no updates
}

static void testWhoTakesAnUpdate() {
    const Key oldOrg = rangeKey(1);
    const Key newOrg = rangeKey(101);
    const MeshAuth gateway = rotatedGateway(oldOrg, newOrg);
    uint8_t iv[JOIN_IV_LENGTH] = {};
    KeyUpdatePacket update = {};
    CHECK(gateway.makeKeyUpdate(LEAF_A, 2, iv, update));
    update.header.magic = PACKET_MAGIC;
    update.header.version = PROTOCOL_VERSION;
    update.header.type = PACKET_KEY_UPDATE;
    uint8_t frame[sizeof(KeyUpdatePacket)];
    memcpy(frame, &update, sizeof(update));

    MeshAuth leafA = leafOf(oldOrg, LEAF_A, 2);
    MeshAuth leafB = leafOf(oldOrg, LEAF_B, 2);
    MeshAuth joining;
    joining.useJoining(LEAF_A);
    MeshAuth receivingGateway = rotatedGateway(oldOrg, newOrg);
    CHECK(leafA.verify(frame, sizeof(frame)) == AuthResult::OK);          // the leaf it names
    CHECK(leafB.verify(frame, sizeof(frame)) == AuthResult::NOT_FOR_ME);
    CHECK(joining.verify(frame, sizeof(frame)) == AuthResult::NOT_FOR_ME);
    CHECK(receivingGateway.verify(frame, sizeof(frame)) == AuthResult::NOT_FOR_ME);
    CHECK(leafA.verify(frame, sizeof(frame) - 1) == AuthResult::BAD_LENGTH);
}

int main() {
    testKeyIds();
    testSealAndOpen();
    testBeaconsForBothGenerations();
    testGatewayMakesTheUpdate();
    testWhoTakesAnUpdate();
    printf("%d checks, %d failed\n", checks, failures);
    return failures == 0 ? 0 : 1;
}
