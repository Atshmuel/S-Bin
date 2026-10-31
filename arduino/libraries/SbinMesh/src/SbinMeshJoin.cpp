#include "SbinMeshJoin.h"

#include <string.h>

namespace sbinmesh {

namespace {
constexpr char KEY_LABEL[] = "S-Bin join key v1";
constexpr char ID_LABEL[] = "S-Bin join id v1";
constexpr char PROOF_LABEL[] = "S-Bin join proof v1";
constexpr char ENC_LABEL[] = "S-Bin join enc v1";
constexpr char MAC_LABEL[] = "S-Bin join mac v1";
constexpr char REPLY_LABEL[] = "S-Bin join reply v1";
constexpr size_t KEYSTREAM_BLOCKS = 3;

size_t labelLength(const char* label) {
    return strlen(label);
}

int hexValue(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

// Compared in the same time whatever the first difference is.
bool sameBytes(const uint8_t* a, const uint8_t* b, size_t length) {
    uint8_t difference = 0;
    for (size_t i = 0; i < length; i++) {
        difference |= a[i] ^ b[i];
    }
    return difference == 0;
}

Key subKey(const Key& joinKey, const char* label) {
    Key key;
    hmacSha256(joinKey.bytes, KEY_LENGTH, reinterpret_cast<const uint8_t*>(label), labelLength(label), key.bytes);
    return key;
}
}  // namespace

bool parseJoinCode(const char* text, uint8_t code[JOIN_CODE_LENGTH]) {
    if (text == nullptr || strlen(text) != JOIN_CODE_LENGTH * 2) {
        return false;
    }
    for (size_t i = 0; i < JOIN_CODE_LENGTH; i++) {
        const int high = hexValue(text[2 * i]);
        const int low = hexValue(text[2 * i + 1]);
        if (high < 0 || low < 0) {
            return false;
        }
        code[i] = static_cast<uint8_t>(high << 4 | low);
    }
    return true;
}

Key deriveJoinKey(const uint8_t code[JOIN_CODE_LENGTH]) {
    Key key;
    hmacSha256(code, JOIN_CODE_LENGTH, reinterpret_cast<const uint8_t*>(KEY_LABEL), labelLength(KEY_LABEL), key.bytes);
    return key;
}

void joinCodeId(const Key& joinKey, uint8_t out[JOIN_CODE_ID_LENGTH]) {
    const Key full = subKey(joinKey, ID_LABEL);
    memcpy(out, full.bytes, JOIN_CODE_ID_LENGTH);
}

void joinProof(const Key& joinKey, const uint8_t mac[MAC_LENGTH], const uint8_t orgId[ORG_ID_LENGTH],
               const uint8_t nonce[JOIN_NONCE_LENGTH], uint8_t out[JOIN_PROOF_LENGTH]) {
    uint8_t input[sizeof(PROOF_LABEL) - 1 + MAC_LENGTH + ORG_ID_LENGTH + JOIN_NONCE_LENGTH];
    size_t length = 0;
    memcpy(input + length, PROOF_LABEL, labelLength(PROOF_LABEL));
    length += labelLength(PROOF_LABEL);
    memcpy(input + length, mac, MAC_LENGTH);
    length += MAC_LENGTH;
    memcpy(input + length, orgId, ORG_ID_LENGTH);
    length += ORG_ID_LENGTH;
    memcpy(input + length, nonce, JOIN_NONCE_LENGTH);
    length += JOIN_NONCE_LENGTH;
    uint8_t full[32];
    hmacSha256(joinKey.bytes, KEY_LENGTH, input, length, full);
    memcpy(out, full, JOIN_PROOF_LENGTH);
}

bool openJoinReply(const Key& joinKey, const uint8_t ownMac[MAC_LENGTH],
                   const uint8_t nonce[JOIN_NONCE_LENGTH], const JoinReplyPacket& reply, JoinedKeys& out) {
    if (reply.status != JOIN_ACCEPTED) {
        return false;
    }
    const Key macKey = subKey(joinKey, MAC_LABEL);
    uint8_t input[sizeof(REPLY_LABEL) - 1 + MAC_LENGTH + JOIN_NONCE_LENGTH + JOIN_IV_LENGTH + JOIN_SEALED_LENGTH];
    size_t length = 0;
    memcpy(input + length, REPLY_LABEL, labelLength(REPLY_LABEL));
    length += labelLength(REPLY_LABEL);
    memcpy(input + length, ownMac, MAC_LENGTH);
    length += MAC_LENGTH;
    memcpy(input + length, nonce, JOIN_NONCE_LENGTH);
    length += JOIN_NONCE_LENGTH;
    memcpy(input + length, reply.iv, JOIN_IV_LENGTH);
    length += JOIN_IV_LENGTH;
    memcpy(input + length, reply.sealed, JOIN_SEALED_LENGTH);
    length += JOIN_SEALED_LENGTH;
    uint8_t tag[32];
    hmacSha256(macKey.bytes, KEY_LENGTH, input, length, tag);
    if (!sameBytes(tag, reply.tag, JOIN_TAG_LENGTH)) {
        return false;
    }

    const Key encKey = subKey(joinKey, ENC_LABEL);
    uint8_t keystream[KEYSTREAM_BLOCKS * 32];
    for (size_t block = 0; block < KEYSTREAM_BLOCKS; block++) {
        uint8_t blockInput[JOIN_IV_LENGTH + 1];
        memcpy(blockInput, reply.iv, JOIN_IV_LENGTH);
        blockInput[JOIN_IV_LENGTH] = static_cast<uint8_t>(block);
        hmacSha256(encKey.bytes, KEY_LENGTH, blockInput, sizeof(blockInput), keystream + block * 32);
    }
    uint8_t plain[JOIN_SEALED_LENGTH];
    for (size_t i = 0; i < JOIN_SEALED_LENGTH; i++) {
        plain[i] = reply.sealed[i] ^ keystream[i];
    }
    out.keyId = plain[0];
    memcpy(out.leafKey.bytes, plain + 1, KEY_LENGTH);
    memcpy(out.beaconKey.bytes, plain + 1 + KEY_LENGTH, KEY_LENGTH);
    return out.keyId != 0;
}

}  // namespace sbinmesh
