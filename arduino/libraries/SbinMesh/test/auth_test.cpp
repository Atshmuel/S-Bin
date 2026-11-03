// Tests of the mesh packet authentication (SbinMeshAuth). Run ./run.sh.
#include <stdio.h>
#include <string.h>

#include "SbinMeshAuth.h"

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

static Key organizationKey(uint8_t seed) {
    Key key;
    for (size_t i = 0; i < KEY_LENGTH; i++) key.bytes[i] = static_cast<uint8_t>(seed + i);
    return key;
}

static const uint8_t GATEWAY_MAC[MAC_LENGTH] = {0xA4, 0xCB, 0x8F, 0xF5, 0x2B, 0x38};
static const uint8_t LEAF_A[MAC_LENGTH] = {0x28, 0x84, 0x85, 0x38, 0x66, 0x44};
static const uint8_t LEAF_B[MAC_LENGTH] = {0x44, 0x1D, 0x64, 0xBD, 0x63, 0x6C};

// A packet and room for its tag.
struct Frame {
    uint8_t bytes[MAX_FRAME_SIZE] = {};
    size_t length = 0;
};

static void fillHeader(PacketHeader& header, PacketType type, const uint8_t* origin) {
    header.magic = PACKET_MAGIC;
    header.version = PROTOCOL_VERSION;
    header.type = type;
    header.networkId = 0x12345678;
    memcpy(header.origin, origin, MAC_LENGTH);
    header.messageId = 0xCAFEF00D;
    header.hops = 0;
    header.ttl = DEFAULT_TTL;
}

static Frame signedBeacon(const MeshAuth& gateway, uint32_t nonce) {
    BeaconPacket beacon = {};
    fillHeader(beacon.header, PACKET_BEACON, GATEWAY_MAC);
    beacon.hopsToGateway = 0;
    beacon.beaconSeq = 7;
    beacon.epochMs = 1793286000000ULL;
    beacon.nextWakeEpoch = 1793329200;
    beacon.meshWindowSeconds = 10;
    beacon.cycleNonce = nonce;
    Frame frame;
    memcpy(frame.bytes, &beacon, sizeof(beacon));
    frame.length = gateway.signBeacon(frame.bytes, sizeof(beacon));
    return frame;
}

static Frame signedData(const MeshAuth& leaf, const uint8_t* origin, uint32_t nonce) {
    DataPacket data = {};
    fillHeader(data.header, PACKET_DATA, origin);
    data.beaconNonce = nonce;
    data.level = 42;
    data.battery = 99;
    Frame frame;
    memcpy(frame.bytes, &data, sizeof(data));
    frame.length = leaf.signData(frame.bytes, sizeof(data));
    return frame;
}

static Frame signedAck(const MeshAuth& gateway, const uint8_t* leafMac, uint8_t keyId) {
    AckPacket ack = {};
    fillHeader(ack.header, PACKET_ACK, GATEWAY_MAC);
    memcpy(ack.ackedOrigin, leafMac, MAC_LENGTH);
    ack.ackedMessageId = 0xCAFEF00D;
    ack.status = ACK_STORED;
    ack.instructionType = INSTRUCTION_CALIBRATE_SCALE;
    ack.instructionValue = 500;
    Frame frame;
    memcpy(frame.bytes, &ack, sizeof(ack));
    frame.length = gateway.signAck(frame.bytes, sizeof(ack), keyId);
    return frame;
}

static MeshAuth makeGateway(const Key& key, uint8_t keyId, const Key* previous = nullptr, uint8_t previousId = 0) {
    MeshAuth auth;
    auth.useOrganizationKey(key, keyId, previous, previousId);
    return auth;
}

static MeshAuth makeLeaf(const Key& organization, const uint8_t* mac, uint8_t keyId) {
    MeshAuth auth;
    auth.useLeafKeys(mac, deriveLeafKey(organization, mac), deriveBeaconKey(organization), keyId);
    return auth;
}

static void testHmacAndDerivation() {
    uint8_t out[32], expected[32];
    const uint8_t key1[20] = {0x0b, 0x0b, 0x0b, 0x0b, 0x0b, 0x0b, 0x0b, 0x0b, 0x0b, 0x0b,
                              0x0b, 0x0b, 0x0b, 0x0b, 0x0b, 0x0b, 0x0b, 0x0b, 0x0b, 0x0b};
    hmacSha256(key1, sizeof(key1), reinterpret_cast<const uint8_t*>("Hi There"), 8, out);
    fromHex("b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7", expected, 32);
    CHECK(memcmp(out, expected, 32) == 0);  // RFC 4231, test case 1

    const char* message = "what do ya want for nothing?";
    hmacSha256(reinterpret_cast<const uint8_t*>("Jefe"), 4, reinterpret_cast<const uint8_t*>(message),
               strlen(message), out);
    fromHex("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843", expected, 32);
    CHECK(memcmp(out, expected, 32) == 0);  // RFC 4231, test case 2

    // The derived keys against values computed independently in Python
    // (organization key 00 01 .. 1f).
    const Key org = organizationKey(0);
    fromHex("ec03733de0bf2c674dfc3e02c081c88c503009e4964933e52b28b7905cb8f3fa", expected, 32);
    CHECK(memcmp(deriveLeafKey(org, LEAF_A).bytes, expected, 32) == 0);
    fromHex("89ff271e100fda114251b8fa137674bb0351fe9fd2a0d616fbfbd120c1f5e7ad", expected, 32);
    CHECK(memcmp(deriveBeaconKey(org).bytes, expected, 32) == 0);
    CHECK(memcmp(deriveLeafKey(org, LEAF_A).bytes, deriveLeafKey(org, LEAF_B).bytes, 32) != 0);
}

static void testRoundTrips() {
    const Key org = organizationKey(1);
    MeshAuth gateway = makeGateway(org, 1);
    MeshAuth leaf = makeLeaf(org, LEAF_A, 1);
    gateway.startWindow(0xAAAA0001);

    const Frame beacon = signedBeacon(gateway, gateway.windowNonce());
    CHECK(beacon.length == sizeof(BeaconPacket) + TAG_LENGTH);
    CHECK(leaf.verify(beacon.bytes, beacon.length) == AuthResult::OK);
    CHECK(gateway.verify(beacon.bytes, beacon.length) == AuthResult::OK);  // a gateway checks beacons too

    const Frame data = signedData(leaf, LEAF_A, gateway.windowNonce());
    CHECK(data.length == sizeof(DataPacket) + TAG_LENGTH);
    CHECK(gateway.verify(data.bytes, data.length) == AuthResult::OK);

    const Frame ack = signedAck(gateway, LEAF_A, 1);
    CHECK(ack.length == sizeof(AckPacket) + TAG_LENGTH);
    CHECK(leaf.verify(ack.bytes, ack.length) == AuthResult::OK);
}

static bool isMutable(const Frame& frame, size_t index) {
    if (index == offsetof(PacketHeader, hops) || index == offsetof(PacketHeader, ttl)) return true;
    if (frame.bytes[offsetof(PacketHeader, type)] == PACKET_BEACON) {
        if (index == offsetof(BeaconPacket, hopsToGateway)) return true;
        if (index >= offsetof(BeaconPacket, parentMac) && index < offsetof(BeaconPacket, parentMac) + MAC_LENGTH) return true;
    }
    return false;
}

static void testTamperingAndRelayFields() {
    const Key org = organizationKey(2);
    MeshAuth gateway = makeGateway(org, 1);
    MeshAuth leaf = makeLeaf(org, LEAF_A, 1);
    gateway.startWindow(0xBBBB0001);

    const Frame frames[3] = {signedBeacon(gateway, gateway.windowNonce()),
                             signedData(leaf, LEAF_A, gateway.windowNonce()),
                             signedAck(gateway, LEAF_A, 1)};
    MeshAuth* receivers[3] = {&leaf, &gateway, &leaf};
    for (int which = 0; which < 3; which++) {
        MeshAuth& receiver = *receivers[which];
        const Frame& original = frames[which];
        CHECK(receiver.verify(original.bytes, original.length) == AuthResult::OK);
        for (size_t i = 0; i < original.length; i++) {
            for (int bit = 0; bit < 8; bit++) {
                Frame altered = original;
                altered.bytes[i] ^= static_cast<uint8_t>(1 << bit);
                const bool accepted = receiver.verify(altered.bytes, altered.length) == AuthResult::OK;
                // Only what a relay changes may be altered without breaking the tag.
                if (isMutable(original, i)) {
                    CHECK(accepted);
                } else {
                    CHECK(!accepted);
                }
            }
        }
        // Cut short or extended.
        CHECK(receiver.verify(original.bytes, original.length - 1) == AuthResult::BAD_LENGTH);
        Frame longer = original;
        CHECK(receiver.verify(longer.bytes, original.length + 1) == AuthResult::BAD_LENGTH);
        // Without its tag.
        CHECK(receiver.verify(original.bytes, original.length - TAG_LENGTH) == AuthResult::BAD_LENGTH);
    }
}

static void testWrongKeys() {
    const Key org = organizationKey(3);
    const Key otherOrganization = organizationKey(99);
    MeshAuth gateway = makeGateway(org, 1);
    MeshAuth leafA = makeLeaf(org, LEAF_A, 1);
    MeshAuth leafB = makeLeaf(org, LEAF_B, 1);
    gateway.startWindow(0xCCCC0001);
    const uint32_t nonce = gateway.windowNonce();

    // Another organization's node.
    MeshAuth strangerGateway = makeGateway(otherOrganization, 1);
    MeshAuth strangerLeaf = makeLeaf(otherOrganization, LEAF_A, 1);
    const Frame forgedBeacon = signedBeacon(strangerGateway, 1);
    CHECK(leafA.verify(forgedBeacon.bytes, forgedBeacon.length) == AuthResult::BAD_TAG);
    const Frame forgedData = signedData(strangerLeaf, LEAF_A, nonce);
    CHECK(gateway.verify(forgedData.bytes, forgedData.length) == AuthResult::BAD_TAG);

    // A stolen leaf (B) speaking as another leaf (A): its key is not A's.
    const Frame impersonation = signedData(leafB, LEAF_A, nonce);
    CHECK(gateway.verify(impersonation.bytes, impersonation.length) == AuthResult::BAD_TAG);
    // ... and signing an ACK with its own key for A's reading.
    AckPacket ack = {};
    fillHeader(ack.header, PACKET_ACK, GATEWAY_MAC);
    memcpy(ack.ackedOrigin, LEAF_A, MAC_LENGTH);
    ack.instructionType = INSTRUCTION_CALIBRATE_EMPTY_BIN;
    Frame fakeAck;
    memcpy(fakeAck.bytes, &ack, sizeof(ack));
    // A leaf cannot sign an ACK (only a gateway can); sign with B's key by hand.
    fakeAck.bytes[offsetof(PacketHeader, keyId)] = 1;
    computeTag(deriveLeafKey(org, LEAF_B), fakeAck.bytes, sizeof(ack), fakeAck.bytes + sizeof(ack));
    fakeAck.length = sizeof(ack) + TAG_LENGTH;
    CHECK(leafA.verify(fakeAck.bytes, fakeAck.length) == AuthResult::BAD_TAG);

    // An ACK for another leaf is not for this one.
    const Frame ackForB = signedAck(gateway, LEAF_B, 1);
    CHECK(leafA.verify(ackForB.bytes, ackForB.length) == AuthResult::NOT_FOR_ME);
    CHECK(leafB.verify(ackForB.bytes, ackForB.length) == AuthResult::OK);

    // Roles: a leaf takes no DATA, a gateway no ACK; neither can sign the other's packets.
    const Frame data = signedData(leafA, LEAF_A, nonce);
    CHECK(leafB.verify(data.bytes, data.length) == AuthResult::NOT_FOR_ME);
    const Frame ack2 = signedAck(gateway, LEAF_A, 1);
    CHECK(gateway.verify(ack2.bytes, ack2.length) == AuthResult::NOT_FOR_ME);
    BeaconPacket beacon = {};
    uint8_t buffer[MAX_FRAME_SIZE] = {};
    memcpy(buffer, &beacon, sizeof(beacon));
    CHECK(leafA.signBeacon(buffer, sizeof(beacon)) == 0);
    CHECK(gateway.signData(buffer, sizeof(DataPacket)) == 0);
}

static void testReplay() {
    const Key org = organizationKey(4);
    MeshAuth gateway = makeGateway(org, 1);
    MeshAuth leaf = makeLeaf(org, LEAF_A, 1);

    gateway.startWindow(111);
    const Frame recorded = signedData(leaf, LEAF_A, 111);
    CHECK(gateway.verify(recorded.bytes, recorded.length) == AuthResult::OK);
    // Heard again in the same window (a retry): the duplicate filter's job, not the tag's.
    CHECK(gateway.verify(recorded.bytes, recorded.length) == AuthResult::OK);

    gateway.startWindow(222);  // the next window: the old one is still the previous
    CHECK(gateway.verify(recorded.bytes, recorded.length) == AuthResult::OK);
    const Frame fresh = signedData(leaf, LEAF_A, 222);
    CHECK(gateway.verify(fresh.bytes, fresh.length) == AuthResult::OK);

    gateway.startWindow(333);  // two windows on: the recording is useless
    CHECK(gateway.verify(recorded.bytes, recorded.length) == AuthResult::STALE_NONCE);
    CHECK(gateway.verify(fresh.bytes, fresh.length) == AuthResult::OK);
    const Frame guess = signedData(leaf, LEAF_A, 12345);
    CHECK(gateway.verify(guess.bytes, guess.length) == AuthResult::STALE_NONCE);

    // A gateway that has not opened a window takes no DATA.
    MeshAuth idle = makeGateway(org, 1);
    CHECK(idle.verify(recorded.bytes, recorded.length) == AuthResult::STALE_NONCE);
    CHECK(gateway.dropped(AuthResult::STALE_NONCE) == 2);
}

static void testKeyRotation() {
    const Key oldKey = organizationKey(5);
    const Key newKey = organizationKey(6);
    MeshAuth gateway = makeGateway(newKey, 2, &oldKey, 1);
    MeshAuth staleLeaf = makeLeaf(oldKey, LEAF_A, 1);
    MeshAuth currentLeaf = makeLeaf(newKey, LEAF_B, 2);
    gateway.startWindow(7);

    // A leaf not yet given the new key still gets through, and its ACK is signed with the key it used.
    const Frame fromStale = signedData(staleLeaf, LEAF_A, 7);
    CHECK(gateway.verify(fromStale.bytes, fromStale.length) == AuthResult::OK);
    const Frame ackForStale = signedAck(gateway, LEAF_A, 1);
    CHECK(ackForStale.length > 0);
    CHECK(staleLeaf.verify(ackForStale.bytes, ackForStale.length) == AuthResult::OK);
    const Frame fromCurrent = signedData(currentLeaf, LEAF_B, 7);
    CHECK(gateway.verify(fromCurrent.bytes, fromCurrent.length) == AuthResult::OK);

    // Beacons use the newest key: the stale leaf cannot follow them until it is set up again.
    const Frame beacon = signedBeacon(gateway, 7);
    CHECK(staleLeaf.verify(beacon.bytes, beacon.length) == AuthResult::UNKNOWN_KEY_ID);
    CHECK(currentLeaf.verify(beacon.bytes, beacon.length) == AuthResult::OK);

    // A key generation the gateway never held, or no longer holds.
    MeshAuth ancientLeaf = makeLeaf(organizationKey(50), LEAF_A, 9);
    const Frame ancient = signedData(ancientLeaf, LEAF_A, 7);
    CHECK(gateway.verify(ancient.bytes, ancient.length) == AuthResult::UNKNOWN_KEY_ID);
    CHECK(gateway.signAck(const_cast<uint8_t*>(ancient.bytes), sizeof(AckPacket), 9) == 0);
}

static void testNoKeyAndCounts() {
    MeshAuth empty;
    const Key org = organizationKey(7);
    MeshAuth gateway = makeGateway(org, 1);
    gateway.startWindow(1);
    const Frame beacon = signedBeacon(gateway, 1);
    CHECK(!empty.hasKey());
    CHECK(empty.verify(beacon.bytes, beacon.length) == AuthResult::NO_KEY);
    CHECK(empty.dropped(AuthResult::NO_KEY) == 1);

    MeshAuth leaf = makeLeaf(org, LEAF_A, 1);
    Frame bad = beacon;
    bad.bytes[bad.length - 1] ^= 1;
    leaf.verify(bad.bytes, bad.length);
    leaf.verify(bad.bytes, bad.length);
    CHECK(leaf.dropped(AuthResult::BAD_TAG) == 2);
    leaf.verify(beacon.bytes, beacon.length);
    CHECK(leaf.dropped(AuthResult::BAD_TAG) == 2);  // accepted packets are not counted
    leaf.resetCounts();
    CHECK(leaf.dropped(AuthResult::BAD_TAG) == 0);

    CHECK(sizeof(PacketHeader) == 21);
    CHECK(sizeof(DataPacket) + TAG_LENGTH <= MAX_FRAME_SIZE);
}

static void testBeaconFreshness() {
    CHECK(beaconTimeIsFresh(false, 5000000, 0, 1000));      // no clock yet: nothing to compare
    CHECK(beaconTimeIsFresh(true, 100000, 99000, 2000));
    CHECK(beaconTimeIsFresh(true, 99000, 100000, 2000));
    CHECK(beaconTimeIsFresh(true, 102000, 100000, 2000));   // on the limit
    CHECK(!beaconTimeIsFresh(true, 102001, 100000, 2000));
    CHECK(!beaconTimeIsFresh(true, 1000000, 100000, 2000)); // a replayed beacon from the past
}

static void testBeaconTolerance() {
    const int64_t twelveHoursMs = 12LL * 3600 * 1000;
    CHECK(beaconToleranceMs(328, 10, 5, 0) == 343000);                       // right after a beacon
    CHECK(beaconToleranceMs(328, 10, 5, twelveHoursMs) == 343000 + 648000);  // 1.5% of 12 hours
    CHECK(beaconToleranceMs(328, 10, 5, -5) == 343000);
    CHECK(beaconToleranceMs(328, 10, 5, 10 * twelveHoursMs) == 343000 + 1200000);  // capped
    // The 2026-11-03 miss: a clock 420 s off was refused at 343 s and is taken now.
    CHECK(!beaconTimeIsFresh(true, 420000, 0, 343000));
    CHECK(beaconTimeIsFresh(true, 420000, 0, beaconToleranceMs(328, 10, 5, twelveHoursMs)));
    // A beacon an hour old is still refused, after a day's sleep too.
    CHECK(!beaconTimeIsFresh(true, 3600000, 0, beaconToleranceMs(328, 10, 5, 2 * twelveHoursMs)));
}

int main() {
    testHmacAndDerivation();
    testRoundTrips();
    testTamperingAndRelayFields();
    testWrongKeys();
    testReplay();
    testKeyRotation();
    testNoKeyAndCounts();
    testBeaconFreshness();
    testBeaconTolerance();
    printf("%d checks, %d failed\n", checks, failures);
    return failures == 0 ? 0 : 1;
}
