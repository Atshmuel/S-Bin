#pragma once

#include <Arduino.h>
#include <esp_now.h>

#include "SbinClockDrift.h"
#include "SbinDiagnostics.h"
#include "SbinMeshAuth.h"
#include "SbinMeshProtocol.h"

// ESP-NOW Long Range radio for S-Bin mesh nodes. One MeshRadio per device;
// all sends must come from a single task (the mesh task on gateways, the main
// loop on leaves). Received frames are already filtered to this node's
// network, protocol version and a minimum length, and receive() hands on only
// those with a valid tag (see SbinMeshAuth.h).

namespace sbinmesh {

struct ReceivedFrame {
    uint8_t data[MAX_FRAME_SIZE];
    uint16_t length;
    uint8_t sender[MAC_LENGTH];   // neighbour that transmitted it; not necessarily the origin
    int8_t rssi;                  // dBm at this node
    uint32_t receivedAtMs;        // millis() when it arrived
    // Heard by a relaying leaf, for another node: its tag was not checked (the relay holds
    // no key for it). Only the relay's forwarding may look at it.
    bool unverified;

    const PacketHeader& header() const {
        return *reinterpret_cast<const PacketHeader*>(data);
    }
    // Returns the packet as T, or nullptr when the frame has the wrong type or size, or
    // was not checked (a relay's forwarding reads those through data).
    template <typename T>
    const T* as(PacketType type) const {
        return !unverified && header().type == type && length >= sizeof(T)
            ? reinterpret_cast<const T*>(data)
            : nullptr;
    }
};

// First 4 bytes of SHA-256(ownerId): nodes of other organizations are ignored.
uint32_t networkIdFor(const char* ownerId);

void formatMac(const uint8_t mac[MAC_LENGTH], char out[18]);
bool macEquals(const uint8_t a[MAC_LENGTH], const uint8_t b[MAC_LENGTH]);

// Remembers recent (origin, messageId) pairs so retries and copies arriving
// over another path are recognised.
class DuplicateFilter {
public:
    // Returns true when the pair was already seen; otherwise remembers it.
    bool checkAndRemember(const uint8_t origin[MAC_LENGTH], uint32_t messageId);

private:
    static constexpr uint8_t SIZE = 32;
    struct Entry {
        uint8_t origin[MAC_LENGTH];
        uint32_t messageId;
        bool used;
    };
    Entry entries_[SIZE] = {};
    uint8_t next_ = 0;
};

class MeshRadio {
public:
    // Wi-Fi station mode with 802.11 LR only, fixed channel, ESP-NOW and the
    // broadcast peer. Must not run while the Wi-Fi setup portal is active.
    bool begin(const char* ownerId);
    void end();

    // The keys that sign and check this node's packets; without them every
    // received packet is dropped. The pointer must outlive the radio.
    void setAuth(MeshAuth* auth) { auth_ = auth; }

    const uint8_t* macAddress() const { return mac_; }
    uint32_t networkId() const { return networkId_; }

    // Fills a header for a new packet originated by this node.
    void initHeader(PacketHeader& header, PacketType type) const;
    static uint32_t newMessageId();

    // Broadcast to every neighbour; there is no delivery confirmation.
    bool broadcast(const void* packet, size_t length);
    // Unicast with ESP-NOW's link-level acknowledgement and retries. Returns
    // true only when the neighbour confirmed reception.
    bool sendTo(const uint8_t mac[MAC_LENGTH], const void* packet, size_t length,
                uint32_t timeoutMs = 200);

    // Waits up to timeoutMs for the next frame from this node's network that
    // passes its authentication; the others are dropped (and counted by the
    // MeshAuth) without reaching the caller.
    bool receive(ReceivedFrame& frame, uint32_t timeoutMs);

    // Bench tests only: frames sent by this neighbour are dropped on arrival, so two nodes
    // that hear each other can be made to act as if they were out of range.
    void ignoreSender(const uint8_t mac[MAC_LENGTH]) {
        memcpy(ignoredSender_, mac, MAC_LENGTH);
        ignoresSender_ = true;
    }

private:
    bool ensurePeer(const uint8_t mac[MAC_LENGTH]);

    static void onReceive(const esp_now_recv_info_t* info, const uint8_t* data, int length);
    static void onSent(const esp_now_send_info_t* info, esp_now_send_status_t status);

    bool running_ = false;
    uint8_t mac_[MAC_LENGTH] = {};
    uint32_t networkId_ = 0;
    void* receiveQueue_ = nullptr;   // QueueHandle_t
    void* sendDone_ = nullptr;       // SemaphoreHandle_t
    volatile bool waitingForSend_ = false;
    volatile bool lastSendDelivered_ = false;
    uint8_t pendingDestination_[MAC_LENGTH] = {};
    MeshAuth* auth_ = nullptr;
    bool warnedNoKey_ = false;
    uint8_t ignoredSender_[MAC_LENGTH] = {};
    bool ignoresSender_ = false;
};

}  // namespace sbinmesh
