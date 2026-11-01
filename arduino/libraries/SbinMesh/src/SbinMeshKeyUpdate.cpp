#include "SbinMeshKeyUpdate.h"

#include <string.h>

namespace sbinmesh {

namespace {
constexpr char ENC_LABEL[] = "S-Bin key update enc v1";
constexpr char MAC_LABEL[] = "S-Bin key update mac v1";
constexpr char UPDATE_LABEL[] = "S-Bin key update v1";
constexpr size_t KEYSTREAM_BLOCKS = 3;
constexpr uint8_t KEY_ID_COUNT = 255;

Key subKey(const Key& key, const char* label) {
    Key out;
    hmacSha256(key.bytes, KEY_LENGTH, reinterpret_cast<const uint8_t*>(label), strlen(label), out.bytes);
    return out;
}

void tagOf(const Key& oldLeafKey, const uint8_t mac[MAC_LENGTH], uint8_t oldKeyId,
           const uint8_t iv[JOIN_IV_LENGTH], const uint8_t sealed[JOIN_SEALED_LENGTH],
           uint8_t out[JOIN_TAG_LENGTH]) {
    const Key macKey = subKey(oldLeafKey, MAC_LABEL);
    uint8_t input[sizeof(UPDATE_LABEL) - 1 + MAC_LENGTH + 1 + JOIN_IV_LENGTH + JOIN_SEALED_LENGTH];
    size_t length = 0;
    memcpy(input + length, UPDATE_LABEL, strlen(UPDATE_LABEL));
    length += strlen(UPDATE_LABEL);
    memcpy(input + length, mac, MAC_LENGTH);
    length += MAC_LENGTH;
    input[length++] = oldKeyId;
    memcpy(input + length, iv, JOIN_IV_LENGTH);
    length += JOIN_IV_LENGTH;
    memcpy(input + length, sealed, JOIN_SEALED_LENGTH);
    length += JOIN_SEALED_LENGTH;
    uint8_t full[32];
    hmacSha256(macKey.bytes, KEY_LENGTH, input, length, full);
    memcpy(out, full, JOIN_TAG_LENGTH);
}

// XOR with the keystream: the same call seals and opens.
void applyKeystream(const Key& oldLeafKey, const uint8_t iv[JOIN_IV_LENGTH], const uint8_t* in, uint8_t* out) {
    const Key encKey = subKey(oldLeafKey, ENC_LABEL);
    uint8_t keystream[KEYSTREAM_BLOCKS * 32];
    for (size_t block = 0; block < KEYSTREAM_BLOCKS; block++) {
        uint8_t blockInput[JOIN_IV_LENGTH + 1];
        memcpy(blockInput, iv, JOIN_IV_LENGTH);
        blockInput[JOIN_IV_LENGTH] = static_cast<uint8_t>(block);
        hmacSha256(encKey.bytes, KEY_LENGTH, blockInput, sizeof(blockInput), keystream + block * 32);
    }
    for (size_t i = 0; i < JOIN_SEALED_LENGTH; i++) {
        out[i] = in[i] ^ keystream[i];
    }
}

bool sameBytes(const uint8_t* a, const uint8_t* b, size_t length) {
    uint8_t difference = 0;
    for (size_t i = 0; i < length; i++) {
        difference |= a[i] ^ b[i];
    }
    return difference == 0;
}
}  // namespace

bool keyIdIsNewer(uint8_t candidate, uint8_t than) {
    if (candidate == 0) {
        return false;
    }
    if (than == 0) {
        return true;
    }
    const uint8_t ahead = static_cast<uint8_t>((candidate + KEY_ID_COUNT - than) % KEY_ID_COUNT);
    return ahead >= 1 && ahead <= KEY_ID_COUNT / 2;
}

bool sealKeyUpdate(const Key& oldLeafKey, const uint8_t leafMac[MAC_LENGTH], uint8_t oldKeyId,
                   const uint8_t iv[JOIN_IV_LENGTH], uint8_t newKeyId, const Key& newLeafKey,
                   const Key& newBeaconKey, KeyUpdatePacket& out) {
    if (newKeyId == 0 || oldKeyId == 0) {
        return false;
    }
    uint8_t plain[JOIN_SEALED_LENGTH];
    plain[0] = newKeyId;
    memcpy(plain + 1, newLeafKey.bytes, KEY_LENGTH);
    memcpy(plain + 1 + KEY_LENGTH, newBeaconKey.bytes, KEY_LENGTH);
    memcpy(out.leafMac, leafMac, MAC_LENGTH);
    out.oldKeyId = oldKeyId;
    memcpy(out.iv, iv, JOIN_IV_LENGTH);
    applyKeystream(oldLeafKey, iv, plain, out.sealed);
    tagOf(oldLeafKey, leafMac, oldKeyId, iv, out.sealed, out.tag);
    return true;
}

bool openKeyUpdate(const Key& currentLeafKey, const uint8_t ownMac[MAC_LENGTH], uint8_t currentKeyId,
                   const KeyUpdatePacket& update, JoinedKeys& out) {
    if (update.oldKeyId != currentKeyId || currentKeyId == 0) {
        return false;
    }
    uint8_t expected[JOIN_TAG_LENGTH];
    tagOf(currentLeafKey, ownMac, update.oldKeyId, update.iv, update.sealed, expected);
    if (!sameBytes(expected, update.tag, JOIN_TAG_LENGTH)) {
        return false;
    }
    uint8_t plain[JOIN_SEALED_LENGTH];
    applyKeystream(currentLeafKey, update.iv, update.sealed, plain);
    if (!keyIdIsNewer(plain[0], currentKeyId)) {
        return false;
    }
    out.keyId = plain[0];
    memcpy(out.leafKey.bytes, plain + 1, KEY_LENGTH);
    memcpy(out.beaconKey.bytes, plain + 1 + KEY_LENGTH, KEY_LENGTH);
    return true;
}

}  // namespace sbinmesh
