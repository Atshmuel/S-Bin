#include "SbinMesh.h"

#include <WiFi.h>
#include <esp_now.h>
#include <esp_random.h>
#include <esp_wifi.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>
#include <mbedtls/sha256.h>
#include <string.h>

namespace sbinmesh {

namespace {
constexpr uint8_t BROADCAST_ADDRESS[MAC_LENGTH] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
constexpr UBaseType_t RECEIVE_QUEUE_DEPTH = 16;

// ESP-NOW callbacks are plain functions, so they reach the single radio here.
MeshRadio* activeRadio = nullptr;
}  // namespace

uint32_t networkIdFor(const char* ownerId) {
    uint8_t digest[32];
    mbedtls_sha256(reinterpret_cast<const unsigned char*>(ownerId), strlen(ownerId), digest, 0);
    uint32_t id;
    memcpy(&id, digest, sizeof(id));
    return id;
}

void formatMac(const uint8_t mac[MAC_LENGTH], char out[18]) {
    snprintf(out, 18, "%02X:%02X:%02X:%02X:%02X:%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
}

bool macEquals(const uint8_t a[MAC_LENGTH], const uint8_t b[MAC_LENGTH]) {
    return memcmp(a, b, MAC_LENGTH) == 0;
}

bool DuplicateFilter::checkAndRemember(const uint8_t origin[MAC_LENGTH], uint32_t messageId) {
    for (const Entry& entry : entries_) {
        if (entry.used && entry.messageId == messageId && macEquals(entry.origin, origin)) {
            return true;
        }
    }
    Entry& slot = entries_[next_];
    memcpy(slot.origin, origin, MAC_LENGTH);
    slot.messageId = messageId;
    slot.used = true;
    next_ = static_cast<uint8_t>((next_ + 1) % SIZE);
    return false;
}

bool MeshRadio::begin(const char* ownerId) {
    if (running_) {
        return true;
    }

    WiFi.mode(WIFI_STA);
    WiFi.disconnect();
    esp_wifi_set_ps(WIFI_PS_NONE);
    if (esp_wifi_set_protocol(WIFI_IF_STA, WIFI_PROTOCOL_LR) != ESP_OK ||
        esp_wifi_set_channel(RADIO_CHANNEL, WIFI_SECOND_CHAN_NONE) != ESP_OK) {
        Serial.println("❌ Could not switch the radio to 802.11 LR.");
        return false;
    }
    esp_wifi_get_mac(WIFI_IF_STA, mac_);
    networkId_ = networkIdFor(ownerId);

    if (receiveQueue_ == nullptr) {
        receiveQueue_ = xQueueCreate(RECEIVE_QUEUE_DEPTH, sizeof(ReceivedFrame));
    }
    if (sendDone_ == nullptr) {
        sendDone_ = xSemaphoreCreateBinary();
    }
    if (receiveQueue_ == nullptr || sendDone_ == nullptr) {
        Serial.println("❌ Could not allocate the mesh queues.");
        return false;
    }

    activeRadio = this;
    if (esp_now_init() != ESP_OK ||
        esp_now_register_recv_cb(onReceive) != ESP_OK ||
        esp_now_register_send_cb(onSent) != ESP_OK ||
        !ensurePeer(BROADCAST_ADDRESS)) {
        Serial.println("❌ ESP-NOW initialization failed.");
        esp_now_deinit();
        activeRadio = nullptr;
        return false;
    }

    running_ = true;
    char macText[18];
    formatMac(mac_, macText);
    Serial.printf("📡 Mesh radio ready: %s, LR channel %u, network %08lX.\n",
                  macText, RADIO_CHANNEL, static_cast<unsigned long>(networkId_));
    return true;
}

void MeshRadio::end() {
    if (!running_) {
        return;
    }
    esp_now_deinit();
    WiFi.mode(WIFI_OFF);  // the radio draws ~100 mA while it listens
    activeRadio = nullptr;
    running_ = false;
}

void MeshRadio::initHeader(PacketHeader& header, PacketType type) const {
    header.magic = PACKET_MAGIC;
    header.version = PROTOCOL_VERSION;
    header.type = type;
    header.networkId = networkId_;
    memcpy(header.origin, mac_, MAC_LENGTH);
    header.messageId = newMessageId();
    header.hops = 0;
    header.ttl = DEFAULT_TTL;
}

uint32_t MeshRadio::newMessageId() {
    // Hardware random number; with the radio on it is truly random, so IDs do
    // not repeat across reboots or power loss.
    uint32_t id;
    do {
        id = esp_random();
    } while (id == 0);
    return id;
}

bool MeshRadio::ensurePeer(const uint8_t mac[MAC_LENGTH]) {
    if (esp_now_is_peer_exist(mac)) {
        return true;
    }
    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, mac, MAC_LENGTH);
    peer.channel = RADIO_CHANNEL;
    peer.ifidx = WIFI_IF_STA;
    peer.encrypt = false;
    esp_err_t result = esp_now_add_peer(&peer);
    if (result == ESP_ERR_ESPNOW_FULL) {
        // Unicast peers are only needed for the current exchange; drop them all.
        esp_now_peer_info_t existing = {};
        bool fromHead = true;
        uint8_t toDelete[ESP_NOW_MAX_TOTAL_PEER_NUM][MAC_LENGTH];
        size_t deleteCount = 0;
        while (esp_now_fetch_peer(fromHead, &existing) == ESP_OK &&
               deleteCount < ESP_NOW_MAX_TOTAL_PEER_NUM) {
            fromHead = false;
            if (!macEquals(existing.peer_addr, BROADCAST_ADDRESS)) {
                memcpy(toDelete[deleteCount++], existing.peer_addr, MAC_LENGTH);
            }
        }
        for (size_t i = 0; i < deleteCount; i++) {
            esp_now_del_peer(toDelete[i]);
        }
        result = esp_now_add_peer(&peer);
    }
    return result == ESP_OK;
}

bool MeshRadio::broadcast(const void* packet, size_t length) {
    if (!running_ || length > MAX_FRAME_SIZE) {
        return false;
    }
    return esp_now_send(BROADCAST_ADDRESS, static_cast<const uint8_t*>(packet), length) == ESP_OK;
}

bool MeshRadio::sendTo(const uint8_t mac[MAC_LENGTH], const void* packet, size_t length,
                       uint32_t timeoutMs) {
    if (!running_ || length > MAX_FRAME_SIZE || !ensurePeer(mac)) {
        return false;
    }
    SemaphoreHandle_t done = static_cast<SemaphoreHandle_t>(sendDone_);
    xSemaphoreTake(done, 0);  // clear a stale signal
    memcpy(pendingDestination_, mac, MAC_LENGTH);
    lastSendDelivered_ = false;
    waitingForSend_ = true;
    if (esp_now_send(mac, static_cast<const uint8_t*>(packet), length) != ESP_OK) {
        waitingForSend_ = false;
        return false;
    }
    const bool completed = xSemaphoreTake(done, pdMS_TO_TICKS(timeoutMs)) == pdTRUE;
    waitingForSend_ = false;
    return completed && lastSendDelivered_;
}

bool MeshRadio::receive(ReceivedFrame& frame, uint32_t timeoutMs) {
    if (receiveQueue_ == nullptr) {
        return false;
    }
    // The tag is checked here, in the caller's task, and not in the radio's
    // callback, which must stay short.
    const uint32_t startedAt = millis();
    for (;;) {
        const uint32_t elapsed = millis() - startedAt;
        const uint32_t remaining = elapsed >= timeoutMs ? 0 : timeoutMs - elapsed;
        if (xQueueReceive(static_cast<QueueHandle_t>(receiveQueue_), &frame,
                          pdMS_TO_TICKS(remaining)) != pdTRUE) {
            return false;
        }
        if (auth_ != nullptr && auth_->hasKey()) {
            const AuthResult result = auth_->verify(frame.data, frame.length);
            if (result == AuthResult::OK) {
                return true;
            }
            if (result == AuthResult::FORWARD) {
                frame.unverified = true;
                return true;
            }
        } else if (!warnedNoKey_) {
            warnedNoKey_ = true;
            Serial.println("⚠️ No mesh key yet: every mesh packet is dropped.");
        }
        // Dropped; a flood of bad packets cannot hold the caller past its time.
        if (millis() - startedAt >= timeoutMs) {
            return false;
        }
    }
}

void MeshRadio::onReceive(const esp_now_recv_info_t* info, const uint8_t* data, int length) {
    MeshRadio* radio = activeRadio;
    if (radio == nullptr || info == nullptr || info->src_addr == nullptr || data == nullptr ||
        length < static_cast<int>(sizeof(PacketHeader)) ||
        length > static_cast<int>(MAX_FRAME_SIZE)) {
        return;
    }
    const PacketHeader* header = reinterpret_cast<const PacketHeader*>(data);
    if (header->magic != PACKET_MAGIC || header->version != PROTOCOL_VERSION ||
        header->networkId != radio->networkId_ || macEquals(header->origin, radio->mac_)) {
        return;
    }

    ReceivedFrame frame;
    memcpy(frame.data, data, static_cast<size_t>(length));
    frame.length = static_cast<uint16_t>(length);
    memcpy(frame.sender, info->src_addr, MAC_LENGTH);
    frame.rssi = info->rx_ctrl == nullptr ? 0 : static_cast<int8_t>(info->rx_ctrl->rssi);
    frame.receivedAtMs = millis();
    frame.unverified = false;
    if (radio->ignoresSender_ && macEquals(info->src_addr, radio->ignoredSender_)) {
        return;
    }
    // With the queue full the frame is dropped; the sender retries.
    xQueueSend(static_cast<QueueHandle_t>(radio->receiveQueue_), &frame, 0);
}

void MeshRadio::onSent(const esp_now_send_info_t* info, esp_now_send_status_t status) {
    MeshRadio* radio = activeRadio;
    if (radio == nullptr || !radio->waitingForSend_ || info == nullptr ||
        info->des_addr == nullptr || !macEquals(info->des_addr, radio->pendingDestination_)) {
        return;  // a broadcast, or a send nobody is waiting for
    }
    radio->lastSendDelivered_ = status == ESP_NOW_SEND_SUCCESS;
    xSemaphoreGive(static_cast<SemaphoreHandle_t>(radio->sendDone_));
}

}  // namespace sbinmesh
