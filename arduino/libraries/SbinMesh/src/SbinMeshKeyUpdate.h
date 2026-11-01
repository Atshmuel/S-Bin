#pragma once

#include <stddef.h>
#include <stdint.h>

#include "SbinMeshAuth.h"
#include "SbinMeshJoin.h"
#include "SbinMeshProtocol.h"

// A key rotation without redoing the leaves. The organization key's new
// generation reaches the gateways with their next report; a leaf still holds the
// generation before and hears only that generation's beacons, so a gateway
// beacons for both while it holds both. A leaf that answers with the old
// generation is given the new keys in a KEY_UPDATE, sealed under the leaf key it
// has now (so only it can open them, and an update is useless to anyone else).
// Only HMAC-SHA256 is used, as for the JOIN (SbinMeshJoin.h):
//
//   encKey = HMAC(oldLeafKey, "S-Bin key update enc v1")
//   macKey = HMAC(oldLeafKey, "S-Bin key update mac v1")
//   sealed = (newKeyId + newLeafKey + newBeaconKey) XOR a keystream of three
//            blocks HMAC(encKey, IV + i)
//   tag    = first 16 bytes of HMAC(macKey, "S-Bin key update v1" + MAC + oldKeyId + IV + sealed)
//
// No Arduino dependency, so the tests run on a computer.

namespace sbinmesh {

// Key IDs run 1 to 255 and wrap; 0 is no key. True when `candidate` is a later
// generation than `than` (up to half the range ahead), so an old update is never
// taken for a newer one.
bool keyIdIsNewer(uint8_t candidate, uint8_t than);

// The gateway's side: fills the update's leaf MAC, old key ID, IV, sealed keys and
// tag (the header is the caller's). False for a key ID of 0.
bool sealKeyUpdate(const Key& oldLeafKey, const uint8_t leafMac[MAC_LENGTH], uint8_t oldKeyId,
                   const uint8_t iv[JOIN_IV_LENGTH], uint8_t newKeyId, const Key& newLeafKey,
                   const Key& newBeaconKey, KeyUpdatePacket& out);

// The leaf's side: the new keys, or false when the update is not for this leaf
// and the generation it holds, was changed, or is not a later generation.
bool openKeyUpdate(const Key& currentLeafKey, const uint8_t ownMac[MAC_LENGTH], uint8_t currentKeyId,
                   const KeyUpdatePacket& update, JoinedKeys& out);

}  // namespace sbinmesh
