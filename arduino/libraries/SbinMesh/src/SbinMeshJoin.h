#pragma once

#include <stddef.h>
#include <stdint.h>

#include "SbinMeshAuth.h"
#include "SbinMeshProtocol.h"

// How a leaf without keys gets them (the JOIN). The add-device page gives the
// leaf's setup a one-time join code of 128 random bits, which never goes over
// the air. The leaf proves it holds the code, the server answers with the
// leaf's two keys sealed under a key made from it, and a gateway passes both
// on. The server makes the same values (server/utils/joinCodes.js): keep the
// labels in step, the tests share its vectors. Only HMAC-SHA256 is used.
//
//   joinKey = HMAC(code, "S-Bin join key v1")
//   codeId  = first 4 bytes of HMAC(joinKey, "S-Bin join id v1")
//   proof   = first 16 bytes of HMAC(joinKey, "S-Bin join proof v1" + MAC + orgId + nonce)
//   reply   = keyId + leafKey + beaconKey, XORed with a keystream of three blocks
//             HMAC(HMAC(joinKey, "S-Bin join enc v1"), IV + i), and a tag
//             (first 16 bytes of HMAC(HMAC(joinKey, "S-Bin join mac v1"),
//             "S-Bin join reply v1" + MAC + nonce + IV + sealed))
//
// No Arduino dependency, so the tests run on a computer.

namespace sbinmesh {

constexpr size_t JOIN_CODE_LENGTH = 16;

// The code as the setup page gives it: 32 hexadecimal characters.
bool parseJoinCode(const char* text, uint8_t code[JOIN_CODE_LENGTH]);

Key deriveJoinKey(const uint8_t code[JOIN_CODE_LENGTH]);
void joinCodeId(const Key& joinKey, uint8_t out[JOIN_CODE_ID_LENGTH]);
void joinProof(const Key& joinKey, const uint8_t mac[MAC_LENGTH], const uint8_t orgId[ORG_ID_LENGTH],
               const uint8_t nonce[JOIN_NONCE_LENGTH], uint8_t out[JOIN_PROOF_LENGTH]);

struct JoinedKeys {
    uint8_t keyId;
    Key leafKey;
    Key beaconKey;
};

// The keys in a reply to this leaf's JOIN (its MAC and nonce), or false when
// the reply is not accepted, was changed, or is for another JOIN. The tag is
// checked before anything is decrypted.
bool openJoinReply(const Key& joinKey, const uint8_t ownMac[MAC_LENGTH],
                   const uint8_t nonce[JOIN_NONCE_LENGTH], const JoinReplyPacket& reply, JoinedKeys& out);

}  // namespace sbinmesh
