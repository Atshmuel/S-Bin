// Tests of the JOIN (SbinMeshJoin and the auth exceptions it needs). Run ./run.sh.
#include <initializer_list>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

#include "SbinMeshAuth.h"
#include "SbinMeshJoin.h"

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

// The same vectors as the server's tests (server/tests/joinCodes.test.js),
// computed independently in Python.
static const char* CODE = "0102030405060708090a0b0c0d0e0f10";
static const char* JOIN_KEY = "5c94c0e2876675462e62df6874e9072fb92115daf3c11a340d21faaf047e0b06";
static const char* CODE_ID = "f5fcaba3";
static const char* ORG_ID = "699760a44e48dff9a082101e";
static const char* NONCE = "0102030405060708";
static const char* PROOF = "67e62c0a9ebcd28ab187e30c63baeaaa";
static const char* LEAF_KEY = "ec03733de0bf2c674dfc3e02c081c88c503009e4964933e52b28b7905cb8f3fa";
static const char* BEACON_KEY = "89ff271e100fda114251b8fa137674bb0351fe9fd2a0d616fbfbd120c1f5e7ad";
static const char* IV = "a0a1a2a3a4a5a6a7a8a9aaab";
static const char* SEALED =
    "23901d6bd46fcc37a2997468388f40cd41ab1b53c6ca75b2bd7d606994b699709f672f3acf2aa56c67fdd9d69041406d58d8607c5fa26416be6d2452358e885bec";
static const char* REPLY_TAG = "a51ea5148b9eb13dd08a909a8d2e5ba3";

static const uint8_t LEAF_A[MAC_LENGTH] = {0x28, 0x84, 0x85, 0x38, 0x66, 0x44};
static const uint8_t LEAF_B[MAC_LENGTH] = {0x44, 0x1D, 0x64, 0xBD, 0x63, 0x6C};
static const uint8_t GATEWAY_MAC[MAC_LENGTH] = {0xA4, 0xCB, 0x8F, 0xF5, 0x2B, 0x38};

static Key keyFromHex(const char* hex) {
    Key key;
    fromHex(hex, key.bytes, KEY_LENGTH);
    return key;
}

static JoinReplyPacket vectorReply() {
    JoinReplyPacket reply = {};
    reply.header.magic = PACKET_MAGIC;
    reply.header.version = PROTOCOL_VERSION;
    reply.header.type = PACKET_JOIN_REPLY;
    memcpy(reply.header.origin, GATEWAY_MAC, MAC_LENGTH);
    memcpy(reply.leafMac, LEAF_A, MAC_LENGTH);
    fromHex(NONCE, reply.nonce, JOIN_NONCE_LENGTH);
    reply.status = JOIN_ACCEPTED;
    fromHex(IV, reply.iv, JOIN_IV_LENGTH);
    fromHex(SEALED, reply.sealed, JOIN_SEALED_LENGTH);
    fromHex(REPLY_TAG, reply.tag, JOIN_TAG_LENGTH);
    return reply;
}

static void testCodeAndProof() {
    uint8_t code[JOIN_CODE_LENGTH];
    CHECK(parseJoinCode(CODE, code));
    CHECK(!parseJoinCode("0102030405060708090a0b0c0d0e0f1", code));    // 31 characters
    CHECK(!parseJoinCode("0102030405060708090a0b0c0d0e0f1g", code));   // not hexadecimal
    CHECK(!parseJoinCode(nullptr, code));
    CHECK(parseJoinCode("0102030405060708090A0B0C0D0E0F10", code));    // either case

    parseJoinCode(CODE, code);
    const Key joinKey = deriveJoinKey(code);
    uint8_t expectedKey[KEY_LENGTH];
    fromHex(JOIN_KEY, expectedKey, KEY_LENGTH);
    CHECK(memcmp(joinKey.bytes, expectedKey, KEY_LENGTH) == 0);

    uint8_t id[JOIN_CODE_ID_LENGTH];
    uint8_t expectedId[JOIN_CODE_ID_LENGTH];
    joinCodeId(joinKey, id);
    fromHex(CODE_ID, expectedId, JOIN_CODE_ID_LENGTH);
    CHECK(memcmp(id, expectedId, sizeof(id)) == 0);

    uint8_t org[ORG_ID_LENGTH];
    uint8_t nonce[JOIN_NONCE_LENGTH];
    uint8_t expectedProof[JOIN_PROOF_LENGTH];
    uint8_t proof[JOIN_PROOF_LENGTH];
    fromHex(ORG_ID, org, sizeof(org));
    fromHex(NONCE, nonce, sizeof(nonce));
    fromHex(PROOF, expectedProof, sizeof(expectedProof));
    joinProof(joinKey, LEAF_A, org, nonce, proof);
    CHECK(memcmp(proof, expectedProof, sizeof(proof)) == 0);

    // For one MAC, organization and nonce.
    joinProof(joinKey, LEAF_B, org, nonce, proof);
    CHECK(memcmp(proof, expectedProof, sizeof(proof)) != 0);
    nonce[7] ^= 1;
    joinProof(joinKey, LEAF_A, org, nonce, proof);
    CHECK(memcmp(proof, expectedProof, sizeof(proof)) != 0);
}

static void testReply() {
    const Key joinKey = keyFromHex(JOIN_KEY);
    uint8_t nonce[JOIN_NONCE_LENGTH];
    fromHex(NONCE, nonce, sizeof(nonce));

    JoinedKeys keys = {};
    CHECK(openJoinReply(joinKey, LEAF_A, nonce, vectorReply(), keys));
    CHECK(keys.keyId == 2);
    const Key leafKey = keyFromHex(LEAF_KEY);
    const Key beaconKey = keyFromHex(BEACON_KEY);
    CHECK(memcmp(keys.leafKey.bytes, leafKey.bytes, KEY_LENGTH) == 0);
    CHECK(memcmp(keys.beaconKey.bytes, beaconKey.bytes, KEY_LENGTH) == 0);

    // Not for another leaf, another JOIN, another code, or when anything changed.
    JoinedKeys other = {};
    CHECK(!openJoinReply(joinKey, LEAF_B, nonce, vectorReply(), other));
    uint8_t otherNonce[JOIN_NONCE_LENGTH];
    memcpy(otherNonce, nonce, sizeof(otherNonce));
    otherNonce[0] ^= 1;
    CHECK(!openJoinReply(joinKey, LEAF_A, otherNonce, vectorReply(), other));
    Key otherKey = joinKey;
    otherKey.bytes[0] ^= 1;
    CHECK(!openJoinReply(otherKey, LEAF_A, nonce, vectorReply(), other));
    for (size_t position : {size_t{0}, size_t{30}, JOIN_SEALED_LENGTH - 1}) {
        JoinReplyPacket changed = vectorReply();
        changed.sealed[position] ^= 0x80;
        CHECK(!openJoinReply(joinKey, LEAF_A, nonce, changed, other));
    }
    JoinReplyPacket changed = vectorReply();
    changed.iv[3] ^= 1;
    CHECK(!openJoinReply(joinKey, LEAF_A, nonce, changed, other));
    changed = vectorReply();
    changed.tag[15] ^= 1;
    CHECK(!openJoinReply(joinKey, LEAF_A, nonce, changed, other));
    changed = vectorReply();
    changed.status = JOIN_REFUSED;
    CHECK(!openJoinReply(joinKey, LEAF_A, nonce, changed, other));
}

struct Frame {
    uint8_t bytes[MAX_FRAME_SIZE] = {};
    size_t length = 0;
};

static Frame frameOf(const void* packet, size_t length) {
    Frame frame;
    memcpy(frame.bytes, packet, length);
    frame.length = length;
    return frame;
}

static JoinPacket joinFrom(const uint8_t* leaf) {
    JoinPacket join = {};
    join.header.magic = PACKET_MAGIC;
    join.header.version = PROTOCOL_VERSION;
    join.header.type = PACKET_JOIN;
    memcpy(join.header.origin, leaf, MAC_LENGTH);
    return join;
}

static void testRadioRoles() {
    Key organizationKey;
    for (size_t i = 0; i < KEY_LENGTH; i++) organizationKey.bytes[i] = static_cast<uint8_t>(i);
    MeshAuth gateway;
    gateway.useOrganizationKey(organizationKey, 1);
    MeshAuth keyedLeaf;
    keyedLeaf.useLeafKeys(LEAF_A, deriveLeafKey(organizationKey, LEAF_A), deriveBeaconKey(organizationKey), 1);
    MeshAuth joining;
    joining.useJoining(LEAF_A);
    MeshAuth empty;

    const JoinPacket join = joinFrom(LEAF_A);
    const Frame joinFrame = frameOf(&join, sizeof(join));
    CHECK(gateway.verify(joinFrame.bytes, joinFrame.length) == AuthResult::OK);     // takes a JOIN, unsigned
    CHECK(keyedLeaf.verify(joinFrame.bytes, joinFrame.length) == AuthResult::NOT_FOR_ME);
    CHECK(joining.verify(joinFrame.bytes, joinFrame.length) == AuthResult::NOT_FOR_ME);
    CHECK(empty.verify(joinFrame.bytes, joinFrame.length) == AuthResult::NO_KEY);
    CHECK(gateway.verify(joinFrame.bytes, joinFrame.length - 1) == AuthResult::BAD_LENGTH);
    CHECK(gateway.verify(joinFrame.bytes, joinFrame.length + TAG_LENGTH) == AuthResult::BAD_LENGTH);

    // The reply is taken by the leaf it names, and only while it is joining.
    const JoinReplyPacket reply = vectorReply();
    const Frame replyFrame = frameOf(&reply, sizeof(reply));
    CHECK(joining.verify(replyFrame.bytes, replyFrame.length) == AuthResult::OK);
    MeshAuth joiningB;
    joiningB.useJoining(LEAF_B);
    CHECK(joiningB.verify(replyFrame.bytes, replyFrame.length) == AuthResult::NOT_FOR_ME);
    CHECK(gateway.verify(replyFrame.bytes, replyFrame.length) == AuthResult::NOT_FOR_ME);
    CHECK(keyedLeaf.verify(replyFrame.bytes, replyFrame.length) == AuthResult::NOT_FOR_ME);

    // A leaf that is joining takes a beacon it cannot check; nothing else.
    BeaconPacket beacon = {};
    beacon.header.magic = PACKET_MAGIC;
    beacon.header.version = PROTOCOL_VERSION;
    beacon.header.type = PACKET_BEACON;
    memcpy(beacon.header.origin, GATEWAY_MAC, MAC_LENGTH);
    uint8_t signedBeacon[sizeof(BeaconPacket) + TAG_LENGTH];
    memcpy(signedBeacon, &beacon, sizeof(beacon));
    CHECK(gateway.signBeacon(signedBeacon, sizeof(beacon)) == sizeof(signedBeacon));
    CHECK(joining.verify(signedBeacon, sizeof(signedBeacon)) == AuthResult::OK);
    CHECK(joining.verify(signedBeacon, sizeof(beacon)) == AuthResult::BAD_LENGTH);
    uint8_t dataLike[sizeof(DataPacket) + TAG_LENGTH] = {};
    dataLike[offsetof(PacketHeader, type)] = PACKET_DATA;
    CHECK(joining.verify(dataLike, sizeof(dataLike)) == AuthResult::NOT_FOR_ME);
    uint8_t ackLike[sizeof(AckPacket) + TAG_LENGTH] = {};
    ackLike[offsetof(PacketHeader, type)] = PACKET_ACK;
    CHECK(joining.verify(ackLike, sizeof(ackLike)) == AuthResult::NOT_FOR_ME);

    // It signs nothing, and the gateway still refuses what is not signed.
    DataPacket data = {};
    uint8_t buffer[sizeof(DataPacket) + TAG_LENGTH];
    memcpy(buffer, &data, sizeof(data));
    CHECK(joining.signData(buffer, sizeof(data)) == 0);
    CHECK(gateway.verify(buffer, sizeof(buffer)) != AuthResult::OK);
    CHECK(sizeof(JoinPacket) == 61 && sizeof(JoinReplyPacket) == 129);
}

int main() {
    testCodeAndProof();
    testReply();
    testRadioRoles();
    printf("%d checks, %d failed\n", checks, failures);
    return failures == 0 ? 0 : 1;
}
