// Tests of a leaf relaying for another leaf (SbinMeshRelay and the relaying mode of
// the auth check). Run ./run.sh.
#include <stddef.h>
#include <stdio.h>
#include <string.h>

#include "SbinMeshAuth.h"
#include "SbinMeshKeyUpdate.h"
#include "SbinMeshRelay.h"

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

static const uint8_t GATEWAY_MAC[MAC_LENGTH] = {0xA4, 0xCB, 0x8F, 0xF5, 0x2B, 0x38};
static const uint8_t RELAY_MAC[MAC_LENGTH] = {0x28, 0x84, 0x85, 0x38, 0x66, 0x44};
static const uint8_t CHILD_MAC[MAC_LENGTH] = {0x44, 0x1D, 0x64, 0xBD, 0x63, 0x6C};
static const uint8_t OTHER_MAC[MAC_LENGTH] = {0x02, 0xEE, 0x00, 0x00, 0x00, 0x09};
static const uint8_t ZERO_MAC[MAC_LENGTH] = {};
static const uint8_t BROADCAST[MAC_LENGTH] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
constexpr uint32_t NONCE = 0xABCD1234;

static Key rangeKey(uint8_t first) {
    Key key;
    for (size_t i = 0; i < KEY_LENGTH; i++) key.bytes[i] = static_cast<uint8_t>(first + i);
    return key;
}

static MeshAuth leafOf(const Key& org, const uint8_t* mac, uint8_t keyId) {
    MeshAuth leaf;
    leaf.useLeafKeys(mac, deriveLeafKey(org, mac), deriveBeaconKey(org), keyId);
    return leaf;
}

static void fillHeader(PacketHeader& header, PacketType type, const uint8_t* origin, uint32_t messageId = 0x11223344) {
    header.magic = PACKET_MAGIC;
    header.version = PROTOCOL_VERSION;
    header.type = type;
    header.networkId = 0x12345678;
    memcpy(header.origin, origin, MAC_LENGTH);
    header.messageId = messageId;
    header.hops = 0;
    header.ttl = DEFAULT_TTL;
}

struct Frame {
    uint8_t bytes[MAX_FRAME_SIZE] = {};
    size_t length = 0;
};

static Frame beaconFrom(const MeshAuth& gateway) {
    BeaconPacket beacon = {};
    fillHeader(beacon.header, PACKET_BEACON, GATEWAY_MAC);
    beacon.hopsToGateway = 0;
    beacon.beaconSeq = 3;
    beacon.epochMs = 1793286000000ULL;
    beacon.nextWakeEpoch = 1793329200;
    beacon.meshWindowSeconds = 10;
    beacon.cycleNonce = NONCE;
    Frame frame;
    memcpy(frame.bytes, &beacon, sizeof(beacon));
    frame.length = gateway.signBeacon(frame.bytes, sizeof(beacon));
    return frame;
}

static Frame dataFrom(const MeshAuth& leaf, const uint8_t* origin) {
    DataPacket data = {};
    fillHeader(data.header, PACKET_DATA, origin);
    data.beaconNonce = NONCE;
    data.flags = DATA_SENSOR_OK;
    data.level = 42;
    Frame frame;
    memcpy(frame.bytes, &data, sizeof(data));
    frame.length = leaf.signData(frame.bytes, sizeof(data));
    return frame;
}

static Frame ackFor(const MeshAuth& gateway, const uint8_t* leafMac) {
    AckPacket ack = {};
    fillHeader(ack.header, PACKET_ACK, GATEWAY_MAC);
    memcpy(ack.ackedOrigin, leafMac, MAC_LENGTH);
    ack.ackedMessageId = 0x11223344;
    ack.status = ACK_STORED;
    ack.instructionType = INSTRUCTION_REPORT_NOW;
    Frame frame;
    memcpy(frame.bytes, &ack, sizeof(ack));
    frame.length = gateway.signAck(frame.bytes, sizeof(ack), 1);
    return frame;
}

static void testBeaconRebroadcast() {
    const Key org = rangeKey(1);
    MeshAuth gateway;
    gateway.useOrganizationKey(org, 1);
    gateway.startWindow(NONCE);
    MeshAuth relay = leafOf(org, RELAY_MAC, 1);
    MeshAuth child = leafOf(org, CHILD_MAC, 1);

    const Frame beacon = beaconFrom(gateway);
    CHECK(relay.verify(beacon.bytes, beacon.length) == AuthResult::OK);

    uint8_t out[MAX_FRAME_SIZE];
    const ForwardAction action = prepareForward(beacon.bytes, beacon.length, RELAY_MAC, GATEWAY_MAC, out);
    CHECK(action.kind == ForwardKind::BEACON && action.length == beacon.length);
    CHECK(memcmp(action.destination, BROADCAST, MAC_LENGTH) == 0);

    const BeaconPacket* sent = reinterpret_cast<const BeaconPacket*>(out);
    CHECK(sent->hopsToGateway == 1 && sent->header.hops == 1 && sent->header.ttl == DEFAULT_TTL - 1);
    CHECK(memcmp(sent->parentMac, RELAY_MAC, MAC_LENGTH) == 0);
    CHECK(memcmp(sent->header.origin, GATEWAY_MAC, MAC_LENGTH) == 0);   // still the gateway's beacon
    CHECK(sent->cycleNonce == NONCE && sent->nextWakeEpoch == 1793329200 && sent->epochMs == 1793286000000ULL);

    // The leaf out of range checks the gateway's signature on what the relay sent.
    CHECK(child.verify(out, action.length) == AuthResult::OK);
    // Changing what the signature covers still breaks it.
    out[offsetof(BeaconPacket, nextWakeEpoch)] ^= 1;
    CHECK(child.verify(out, action.length) == AuthResult::BAD_TAG);

    // A relay's rebroadcast is not rebroadcast again, and the original is untouched.
    uint8_t again[MAX_FRAME_SIZE];
    uint8_t good[MAX_FRAME_SIZE];
    prepareForward(beacon.bytes, beacon.length, RELAY_MAC, GATEWAY_MAC, good);
    CHECK(prepareForward(good, beacon.length, OTHER_MAC, GATEWAY_MAC, again).kind == ForwardKind::NONE);
    CHECK(reinterpret_cast<const BeaconPacket*>(beacon.bytes)->hopsToGateway == 0);
}

static void testDataGoesUp() {
    const Key org = rangeKey(2);
    MeshAuth gateway;
    gateway.useOrganizationKey(org, 1);
    gateway.startWindow(NONCE);
    MeshAuth relay = leafOf(org, RELAY_MAC, 1);
    MeshAuth child = leafOf(org, CHILD_MAC, 1);

    const Frame data = dataFrom(child, CHILD_MAC);
    // A relay takes another leaf's DATA only when it relays; the gateway checks it at the end.
    CHECK(relay.verify(data.bytes, data.length) == AuthResult::NOT_FOR_ME);
    relay.setRelaying(true);
    CHECK(relay.verify(data.bytes, data.length) == AuthResult::FORWARD);
    CHECK(relay.dropped(AuthResult::FORWARD) == 0 && relay.dropped(AuthResult::NOT_FOR_ME) == 1);  // a forward is no drop

    uint8_t out[MAX_FRAME_SIZE];
    const ForwardAction action = prepareForward(data.bytes, data.length, RELAY_MAC, GATEWAY_MAC, out);
    CHECK(action.kind == ForwardKind::UP && action.length == data.length);
    CHECK(memcmp(action.destination, GATEWAY_MAC, MAC_LENGTH) == 0);
    const DataPacket* sent = reinterpret_cast<const DataPacket*>(out);
    CHECK(sent->header.hops == 1 && sent->header.ttl == DEFAULT_TTL - 1);
    CHECK(memcmp(sent->header.origin, CHILD_MAC, MAC_LENGTH) == 0);      // still the child's reading
    CHECK(gateway.verify(out, action.length) == AuthResult::OK);           // its tag still holds

    // The relay can make nothing: another leaf's reading under a forged origin fails at the gateway.
    uint8_t forged[MAX_FRAME_SIZE];
    memcpy(forged, out, action.length);
    memcpy(reinterpret_cast<DataPacket*>(forged)->header.origin, OTHER_MAC, MAC_LENGTH);
    CHECK(gateway.verify(forged, action.length) == AuthResult::BAD_TAG);
    forged[offsetof(DataPacket, level)] ^= 0x10;
    CHECK(gateway.verify(forged, action.length) != AuthResult::OK);

    // No gateway heard yet: nowhere to send it.
    CHECK(prepareForward(data.bytes, data.length, RELAY_MAC, ZERO_MAC, out).kind == ForwardKind::NONE);
    // A gateway never relays, a plain leaf neither.
    MeshAuth otherGateway;
    otherGateway.useOrganizationKey(org, 1);
    otherGateway.setRelaying(true);
    CHECK(otherGateway.verify(data.bytes, data.length) != AuthResult::FORWARD);
}

static void testAckGoesDown() {
    const Key org = rangeKey(3);
    MeshAuth gateway;
    gateway.useOrganizationKey(org, 1);
    MeshAuth relay = leafOf(org, RELAY_MAC, 1);
    relay.setRelaying(true);
    MeshAuth child = leafOf(org, CHILD_MAC, 1);

    const Frame ack = ackFor(gateway, CHILD_MAC);
    CHECK(ack.length == sizeof(AckPacket) + TAG_LENGTH);
    CHECK(relay.verify(ack.bytes, ack.length) == AuthResult::FORWARD);

    uint8_t out[MAX_FRAME_SIZE];
    const ForwardAction action = prepareForward(ack.bytes, ack.length, RELAY_MAC, GATEWAY_MAC, out);
    CHECK(action.kind == ForwardKind::DOWN && memcmp(action.destination, CHILD_MAC, MAC_LENGTH) == 0);
    CHECK(child.verify(out, action.length) == AuthResult::OK);               // signed by the gateway, intact
    CHECK(reinterpret_cast<const AckPacket*>(out)->instructionType == INSTRUCTION_REPORT_NOW);

    // An ACK for the relay itself is its own, not passed on.
    const Frame own = ackFor(gateway, RELAY_MAC);
    CHECK(relay.verify(own.bytes, own.length) == AuthResult::OK);
    CHECK(prepareForward(own.bytes, own.length, RELAY_MAC, GATEWAY_MAC, out).kind == ForwardKind::NONE);
    // And a relay that does not relay ignores an ACK for someone else.
    MeshAuth plain = leafOf(org, RELAY_MAC, 1);
    CHECK(plain.verify(ack.bytes, ack.length) == AuthResult::NOT_FOR_ME);
}

static void testKeyUpdateGoesDown() {
    const Key oldOrg = rangeKey(4);
    const Key newOrg = rangeKey(104);
    MeshAuth gateway;
    gateway.useOrganizationKey(newOrg, 3, &oldOrg, 2);
    MeshAuth relay = leafOf(oldOrg, RELAY_MAC, 2);
    relay.setRelaying(true);
    MeshAuth child = leafOf(oldOrg, CHILD_MAC, 2);

    uint8_t iv[JOIN_IV_LENGTH] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12};
    KeyUpdatePacket update = {};
    CHECK(gateway.makeKeyUpdate(CHILD_MAC, 2, iv, update));
    fillHeader(update.header, PACKET_KEY_UPDATE, GATEWAY_MAC);
    uint8_t frame[sizeof(update)];
    memcpy(frame, &update, sizeof(update));

    CHECK(relay.verify(frame, sizeof(frame)) == AuthResult::FORWARD);
    uint8_t out[MAX_FRAME_SIZE];
    const ForwardAction action = prepareForward(frame, sizeof(frame), RELAY_MAC, GATEWAY_MAC, out);
    CHECK(action.kind == ForwardKind::DOWN && memcmp(action.destination, CHILD_MAC, MAC_LENGTH) == 0);
    CHECK(child.verify(out, action.length) == AuthResult::OK);
    JoinedKeys keys = {};
    CHECK(openKeyUpdate(deriveLeafKey(oldOrg, CHILD_MAC), CHILD_MAC, 2,
                        *reinterpret_cast<const KeyUpdatePacket*>(out), keys));
    CHECK(keys.keyId == 3);
}

static void testLimits() {
    const Key org = rangeKey(5);
    MeshAuth gateway;
    gateway.useOrganizationKey(org, 1);
    gateway.startWindow(NONCE);
    MeshAuth child = leafOf(org, CHILD_MAC, 1);
    const Frame data = dataFrom(child, CHILD_MAC);
    uint8_t out[MAX_FRAME_SIZE];

    // One relay only: what was passed on once is not passed on again.
    uint8_t passed[MAX_FRAME_SIZE];
    const ForwardAction first = prepareForward(data.bytes, data.length, RELAY_MAC, GATEWAY_MAC, passed);
    CHECK(first.kind == ForwardKind::UP);
    CHECK(prepareForward(passed, first.length, OTHER_MAC, GATEWAY_MAC, out).kind == ForwardKind::NONE);

    // Out of time, this node's own, a wrong length, a type it does not carry.
    Frame expired = data;
    reinterpret_cast<PacketHeader*>(expired.bytes)->ttl = 0;
    CHECK(prepareForward(expired.bytes, expired.length, RELAY_MAC, GATEWAY_MAC, out).kind == ForwardKind::NONE);
    CHECK(prepareForward(data.bytes, data.length, CHILD_MAC, GATEWAY_MAC, out).kind == ForwardKind::NONE);
    CHECK(prepareForward(data.bytes, data.length - 1, RELAY_MAC, GATEWAY_MAC, out).kind == ForwardKind::NONE);
    CHECK(prepareForward(data.bytes, sizeof(PacketHeader) - 1, RELAY_MAC, GATEWAY_MAC, out).kind == ForwardKind::NONE);
    Frame join = data;
    reinterpret_cast<PacketHeader*>(join.bytes)->type = PACKET_JOIN;
    join.length = sizeof(JoinPacket);
    CHECK(prepareForward(join.bytes, join.length, RELAY_MAC, GATEWAY_MAC, out).kind == ForwardKind::NONE);
    Frame junk = data;
    junk.bytes[offsetof(PacketHeader, type)] = 99;
    CHECK(prepareForward(junk.bytes, junk.length, RELAY_MAC, GATEWAY_MAC, out).kind == ForwardKind::NONE);
    CHECK(prepareForward(data.bytes, data.length + 1 <= MAX_FRAME_SIZE ? data.length + 1 : data.length, RELAY_MAC, GATEWAY_MAC, out).kind
          == (data.length + 1 <= MAX_FRAME_SIZE ? ForwardKind::NONE : ForwardKind::UP));
}

static void testMemoryAndBudget() {
    RelayMemory memory;
    CHECK(!memory.seen(CHILD_MAC, 7));
    CHECK(memory.seen(CHILD_MAC, 7));                 // a retry or a copy
    CHECK(!memory.seen(CHILD_MAC, 8));
    CHECK(!memory.seen(OTHER_MAC, 7));                // another sender's same ID
    for (uint32_t id = 100; id < 100 + 40; id++) memory.seen(CHILD_MAC, id);
    CHECK(!memory.seen(CHILD_MAC, 7));                // the ring forgot the oldest
    memory.reset();
    CHECK(!memory.seen(CHILD_MAC, 100));

    RelayBudget budget;
    for (uint16_t i = 0; i < RelayBudget::UP; i++) CHECK(budget.take(ForwardKind::UP));
    CHECK(!budget.take(ForwardKind::UP));
    CHECK(budget.take(ForwardKind::DOWN) && budget.take(ForwardKind::BEACON));   // each kind has its own
    CHECK(!budget.take(ForwardKind::NONE));
    budget.reset();
    CHECK(budget.take(ForwardKind::UP));
}

int main() {
    testBeaconRebroadcast();
    testDataGoesUp();
    testAckGoesDown();
    testKeyUpdateGoesDown();
    testLimits();
    testMemoryAndBudget();
    printf("%d checks, %d failed\n", checks, failures);
    return failures == 0 ? 0 : 1;
}
