#include "SbinMeshRelay.h"

#include <string.h>

namespace sbinmesh {

namespace {
ForwardAction nothing() {
    ForwardAction action = {};
    action.kind = ForwardKind::NONE;
    return action;
}

bool isZero(const uint8_t mac[MAC_LENGTH]) {
    for (size_t i = 0; i < MAC_LENGTH; i++) {
        if (mac[i] != 0) {
            return false;
        }
    }
    return true;
}
}  // namespace

ForwardAction prepareForward(const uint8_t* frame, size_t length, const uint8_t ownMac[MAC_LENGTH],
                             const uint8_t parentMac[MAC_LENGTH], uint8_t out[MAX_FRAME_SIZE]) {
    if (length < sizeof(PacketHeader) || length > MAX_FRAME_SIZE) {
        return nothing();
    }
    const PacketHeader* header = reinterpret_cast<const PacketHeader*>(frame);
    // Already passed on once (one relay only), out of time, or this node's own.
    if (header->hops != 0 || header->ttl == 0 || memcmp(header->origin, ownMac, MAC_LENGTH) == 0) {
        return nothing();
    }

    ForwardAction action = nothing();
    memcpy(out, frame, length);
    PacketHeader* sent = reinterpret_cast<PacketHeader*>(out);

    switch (header->type) {
        case PACKET_BEACON: {
            if (length != sizeof(BeaconPacket) + TAG_LENGTH) {
                return nothing();
            }
            const BeaconPacket* beacon = reinterpret_cast<const BeaconPacket*>(frame);
            if (beacon->hopsToGateway != 0) {  // a gateway's own, not another relay's
                return nothing();
            }
            BeaconPacket* rebroadcast = reinterpret_cast<BeaconPacket*>(out);
            rebroadcast->hopsToGateway = 1;
            memcpy(rebroadcast->parentMac, ownMac, MAC_LENGTH);
            action.kind = ForwardKind::BEACON;
            memset(action.destination, 0xFF, MAC_LENGTH);
            break;
        }
        case PACKET_DATA: {
            if (length != sizeof(DataPacket) + TAG_LENGTH || isZero(parentMac)) {
                return nothing();
            }
            action.kind = ForwardKind::UP;
            memcpy(action.destination, parentMac, MAC_LENGTH);
            break;
        }
        case PACKET_ACK: {
            if (length != sizeof(AckPacket) + TAG_LENGTH) {
                return nothing();
            }
            const AckPacket* ack = reinterpret_cast<const AckPacket*>(frame);
            if (memcmp(ack->ackedOrigin, ownMac, MAC_LENGTH) == 0) {
                return nothing();
            }
            action.kind = ForwardKind::DOWN;
            memcpy(action.destination, ack->ackedOrigin, MAC_LENGTH);
            break;
        }
        case PACKET_KEY_UPDATE: {
            if (length != sizeof(KeyUpdatePacket)) {
                return nothing();
            }
            const KeyUpdatePacket* update = reinterpret_cast<const KeyUpdatePacket*>(frame);
            if (memcmp(update->leafMac, ownMac, MAC_LENGTH) == 0) {
                return nothing();
            }
            action.kind = ForwardKind::DOWN;
            memcpy(action.destination, update->leafMac, MAC_LENGTH);
            break;
        }
        default:
            return nothing();
    }
    sent->hops = 1;
    sent->ttl = static_cast<uint8_t>(header->ttl - 1);
    action.length = length;
    return action;
}

bool RelayMemory::seen(const uint8_t origin[MAC_LENGTH], uint32_t messageId, uint32_t nowMs) {
    for (Entry& entry : entries_) {
        if (entry.used && entry.messageId == messageId && memcmp(entry.origin, origin, MAC_LENGTH) == 0) {
            if (nowMs - entry.atMs < DUPLICATE_WINDOW_MS) {
                return true;
            }
            entry.atMs = nowMs;  // a retry: passed on again, and remembered from now
            return false;
        }
    }
    Entry& slot = entries_[next_];
    memcpy(slot.origin, origin, MAC_LENGTH);
    slot.messageId = messageId;
    slot.atMs = nowMs;
    slot.used = true;
    next_ = (next_ + 1) % SIZE;
    return false;
}

void RelayMemory::reset() {
    memset(entries_, 0, sizeof(entries_));
    next_ = 0;
}

bool RelayBudget::take(ForwardKind kind) {
    uint16_t* count = nullptr;
    uint16_t limit = 0;
    switch (kind) {
        case ForwardKind::BEACON: count = &beacons_; limit = BEACONS; break;
        case ForwardKind::UP: count = &up_; limit = UP; break;
        case ForwardKind::DOWN: count = &down_; limit = DOWN; break;
        case ForwardKind::NONE: return false;
    }
    if (*count >= limit) {
        return false;
    }
    (*count)++;
    return true;
}

}  // namespace sbinmesh
