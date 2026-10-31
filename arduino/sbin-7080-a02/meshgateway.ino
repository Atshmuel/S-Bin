#include "globals.h"

// Mesh gateway: while the mesh window is open, a task on core 0 broadcasts
// beacons and takes custody of leaf readings, while setup()/loop() keep doing
// the blocking cellular work on core 1. Readings wait in RTC memory (they
// survive deep sleep) until the server confirms them over MQTT.

using namespace sbinmesh;

namespace {
constexpr uint8_t RELAY_QUEUE_SIZE = 16;
constexpr uint32_t BEACON_INTERVAL_MS = 500;
constexpr uint32_t MESH_TASK_STACK_BYTES = 8192;
// The server needs a few seconds per relayed reading (the broker both ways
// and several database writes).
constexpr unsigned long RELAY_RESULT_TIMEOUT_MS = 10000;
// A slow reply does not end the upload: the reading is sent again (the server
// recognises the repeat by its message ID) until the server stays silent this
// many times in a row...
constexpr uint8_t RELAY_MAX_SILENT_REPLIES = 3;
// ...or this cycle's uploads (after the report and after the window) have run
// this long together, so a slow server cannot keep the gateway awake.
constexpr unsigned long RELAY_UPLOAD_BUDGET_MS = 60000;
// A boot this close to the stored slot is the wake-up for that slot.
constexpr int64_t SLOT_MATCH_SECONDS = 600;
// A window away from the slot (a reset, a flash) holds its beacons until the
// server's schedule reply, at most this long: the stored wake time may be from
// an old schedule, and a leaf follows the first beacon it hears.
constexpr uint32_t MAX_BEACON_HOLD_MS = 30000;
// A command that reaches the gateway after a leaf's reading was ACKed (the
// instruction check runs once the report is done) is sent to the leaf in a
// second ACK, repeated this often, this many times, while the window is open.
constexpr uint8_t MAX_HEARD_LEAVES = 8;
constexpr uint8_t MAX_LATE_ACKS = 3;
constexpr uint32_t LATE_ACK_INTERVAL_MS = 1000;

MeshRadio meshRadio;
// The organization's key and this window's nonce (2m): every beacon and ACK
// sent is signed, every packet received is checked, by the radio's receive().
MeshAuth meshAuth;
DuplicateFilter duplicateFilter;
SemaphoreHandle_t relayQueueMutex = nullptr;
SemaphoreHandle_t meshWindowDone = nullptr;
volatile bool meshTaskRunning = false;
bool meshWindowStarted = false;
// Set by the mesh task when held beacons start, read by endMeshWindow().
volatile uint32_t meshWindowEndMs = 0;
uint64_t meshWindowSlotEpoch = 0;
bool beaconsHeld = false;
uint32_t beaconHoldAckCount = 0;
// The leaves heard in this window, by their latest reading. Only the mesh
// task touches them, and the window opening resets them before it starts.
struct HeardLeaf {
    uint8_t mac[MAC_LENGTH];
    uint32_t messageId;
    uint8_t keyId;
    bool answered;  // its ACK carried a command, or none is owed
    uint8_t lateAcks;
    uint32_t lastLateAckMs;
};
HeardLeaf heardLeaves[MAX_HEARD_LEAVES];
uint8_t heardLeafCount = 0;
// Relay upload time used this cycle, against RELAY_UPLOAD_BUDGET_MS.
unsigned long relayUploadSpentMs = 0;
// A leaf's command result went up this cycle: the server has finished that
// command, so the held list is out of date (see leafResultsUploaded()).
bool leafResultUploaded = false;
}

RTC_DATA_ATTR RelayRecord relayQueue[RELAY_QUEUE_SIZE];
// The server's latest list of commands for this gateway's leaves (see
// setLeafInstructions()); guarded by relayQueueMutex like the relay queue.
RTC_DATA_ATTR LeafInstruction leafInstructions[MAX_LEAF_INSTRUCTIONS];
RTC_DATA_ATTR uint8_t leafInstructionCount = 0;
RTC_DATA_ATTR uint8_t relayQueueCount = 0;
RTC_DATA_ATTR uint32_t beaconSeq = 0;

namespace {
bool sameReading(const RelayRecord& record, const uint8_t origin[MAC_LENGTH], uint32_t messageId) {
    return record.data.header.messageId == messageId &&
           macEquals(record.data.header.origin, origin);
}

// The mutex guarding the relay queue and the leaf commands, shared by the mesh
// task and the MQTT callbacks; false when it could not be created.
bool ensureMeshMutex() {
    if (relayQueueMutex == nullptr) {
        relayQueueMutex = xSemaphoreCreateMutex();
    }
    return relayQueueMutex != nullptr;
}

// Puts the leaf's pending command, if any, into its ACK.
void attachLeafInstruction(AckPacket& ack, const uint8_t leafMac[MAC_LENGTH]) {
    xSemaphoreTake(relayQueueMutex, portMAX_DELAY);
    for (uint8_t i = 0; i < leafInstructionCount; i++) {
        if (macEquals(leafInstructions[i].leafMac, leafMac)) {
            memcpy(ack.instructionId, leafInstructions[i].id, INSTRUCTION_ID_LENGTH);
            ack.instructionType = leafInstructions[i].type;
            ack.instructionValue = leafInstructions[i].value;
            break;
        }
    }
    xSemaphoreGive(relayQueueMutex);
}

void rememberHeardLeaf(const uint8_t mac[MAC_LENGTH], uint32_t messageId, uint8_t keyId, bool carriedCommand) {
    for (uint8_t i = 0; i < heardLeafCount; i++) {
        HeardLeaf& leaf = heardLeaves[i];
        if (!macEquals(leaf.mac, mac)) {
            continue;
        }
        if (leaf.messageId != messageId) {  // a newer reading, e.g. the result of the command
            leaf.messageId = messageId;
            leaf.keyId = keyId;
            leaf.lateAcks = 0;
            leaf.answered = carriedCommand;
        } else {
            leaf.answered = leaf.answered || carriedCommand;
        }
        return;
    }
    if (heardLeafCount < MAX_HEARD_LEAVES) {
        HeardLeaf& leaf = heardLeaves[heardLeafCount++];
        memcpy(leaf.mac, mac, MAC_LENGTH);
        leaf.messageId = messageId;
        leaf.keyId = keyId;
        leaf.answered = carriedCommand;
        leaf.lateAcks = 0;
        leaf.lastLateAckMs = 0;
    }
}

bool relayQueueContains(const uint8_t origin[MAC_LENGTH], uint32_t messageId) {
    xSemaphoreTake(relayQueueMutex, portMAX_DELAY);
    bool found = false;
    for (uint8_t i = 0; i < relayQueueCount && !found; i++) {
        found = sameReading(relayQueue[i], origin, messageId);
    }
    xSemaphoreGive(relayQueueMutex);
    return found;
}

void storeRelayRecord(const RelayRecord& record) {
    xSemaphoreTake(relayQueueMutex, portMAX_DELAY);
    if (relayQueueCount == RELAY_QUEUE_SIZE) {
        // Keep the newest readings; the oldest is the least useful.
        memmove(&relayQueue[0], &relayQueue[1], sizeof(RelayRecord) * (RELAY_QUEUE_SIZE - 1));
        relayQueueCount--;
        Serial.println("⚠️ Relay queue full; dropped the oldest leaf reading.");
    }
    relayQueue[relayQueueCount++] = record;
    xSemaphoreGive(relayQueueMutex);
}

void removeRelayRecord(const uint8_t origin[MAC_LENGTH], uint32_t messageId) {
    xSemaphoreTake(relayQueueMutex, portMAX_DELAY);
    for (uint8_t i = 0; i < relayQueueCount; i++) {
        if (sameReading(relayQueue[i], origin, messageId)) {
            memmove(&relayQueue[i], &relayQueue[i + 1], sizeof(RelayRecord) * (relayQueueCount - i - 1));
            relayQueueCount--;
            break;
        }
    }
    xSemaphoreGive(relayQueueMutex);
}

// The slot leaves should wake for next: the earliest known wake time after
// the slot this window belongs to. Before this cycle's server ack that is
// followingWakeEpoch; after it, the updated nextWakeEpoch.
uint32_t leafWakeEpochToAdvertise() {
    const uint64_t now = static_cast<uint64_t>(time(nullptr));
    const uint64_t after = max(meshWindowSlotEpoch, now);
    uint64_t best = 0;
    for (const uint64_t candidate : {nextWakeEpoch, followingWakeEpoch}) {
        if (candidate > after && candidate <= now + MAX_WAKE_AHEAD_SECONDS &&
            (best == 0 || candidate < best)) {
            best = candidate;
        }
    }
    // No fresh slot from the server (the last cycle got no reply, or a reset
    // cleared followingWakeEpoch): continue the stored slot pattern rather
    // than advertise 0 and send every leaf into a cold join.
    if (best == 0 && nextWakeEpoch > 0 && nextWakeEpoch <= after && slotPeriodSeconds > 0) {
        const uint64_t periodsAfter = (after - nextWakeEpoch) / slotPeriodSeconds + 1;
        best = nextWakeEpoch + periodsAfter * slotPeriodSeconds;
    }
    return static_cast<uint32_t>(best);
}

void sendBeacon() {
    if (!isSystemClockValid()) {
        return;  // leaves take their time from beacons; never send a bad one
    }
    BeaconPacket beacon = {};
    meshRadio.initHeader(beacon.header, PACKET_BEACON);
    beacon.hopsToGateway = 0;
    beacon.beaconSeq = beaconSeq;
    beacon.epochMs = static_cast<uint64_t>(epochMsNow());
    beacon.nextWakeEpoch = leafWakeEpochToAdvertise();
    beacon.meshWindowSeconds = static_cast<uint8_t>(meshAwakeWindowSeconds);
    beacon.cycleNonce = meshAuth.windowNonce();
    uint8_t frame[sizeof(BeaconPacket) + TAG_LENGTH];
    memcpy(frame, &beacon, sizeof(beacon));
    const size_t length = meshAuth.signBeacon(frame, sizeof(beacon));
    if (length > 0) {
        meshRadio.broadcast(frame, length);
    }
}

void handleMeshFrame(const ReceivedFrame& frame) {
    // Other gateways' beacons and stray ACKs are ignored by a gateway.
    const DataPacket* data = frame.as<DataPacket>(PACKET_DATA);
    if (data == nullptr) {
        return;
    }

    const uint8_t* origin = data->header.origin;
    const uint32_t messageId = data->header.messageId;
    const bool duplicate = duplicateFilter.checkAndRemember(origin, messageId) ||
                           relayQueueContains(origin, messageId);
    if (!duplicate) {
        RelayRecord record = {};
        record.data = *data;
        record.hops = static_cast<uint8_t>(data->header.hops + 1);
        record.rssi = frame.rssi;
        // The leaf sends the reading's age; this gateway's clock is network
        // time (no window opens without it), so the reading's UTC time is fixed
        // here and stays right however long the record waits for upload.
        const time_t now = time(nullptr);
        if (isSystemClockValid() && static_cast<time_t>(data->ageSeconds) < now) {
            record.measuredAtEpoch = static_cast<uint32_t>(now - data->ageSeconds);
        }
        storeRelayRecord(record);
    }

    AckPacket ack = {};
    meshRadio.initHeader(ack.header, PACKET_ACK);
    memcpy(ack.ackedOrigin, origin, MAC_LENGTH);
    ack.ackedMessageId = messageId;
    ack.status = duplicate ? ACK_DUPLICATE : ACK_STORED;
    attachLeafInstruction(ack, origin);
    // Signed with the key generation the reading used, so a leaf not yet given
    // a new key after a rotation can still check it.
    uint8_t ackFrame[sizeof(AckPacket) + TAG_LENGTH];
    memcpy(ackFrame, &ack, sizeof(ack));
    const size_t ackLength = meshAuth.signAck(ackFrame, sizeof(ack), data->header.keyId);
    const bool acked = ackLength > 0 && meshRadio.sendTo(frame.sender, ackFrame, ackLength);
    // Only a leaf heard directly can be answered again.
    if (macEquals(origin, frame.sender)) {
        rememberHeardLeaf(origin, messageId, data->header.keyId, ack.instructionType != INSTRUCTION_NONE);
    }

    char macText[18];
    formatMac(origin, macText);
    Serial.printf("%s Leaf %s reading %08lX (level %u%%, RSSI %d dBm, taken %lu s ago)%s%s%s.\n",
                  duplicate ? "🔁 Duplicate of" : "📥 Stored", macText,
                  static_cast<unsigned long>(messageId), data->level, frame.rssi,
                  static_cast<unsigned long>(data->ageSeconds),
                  data->resultStatus != RESULT_NONE ? ", with a command result" : "",
                  ack.instructionType != INSTRUCTION_NONE ? "; handed it a command" : "",
                  acked ? "" : "; ACK not confirmed");
}

// A command that arrived after a heard leaf's reading was ACKed goes to it in
// a second ACK for that reading; the leaf listens until the window closes.
void sendLateCommands() {
    if (leafInstructionCount == 0) {
        return;
    }
    for (uint8_t i = 0; i < heardLeafCount; i++) {
        HeardLeaf& leaf = heardLeaves[i];
        if (leaf.answered || leaf.lateAcks >= MAX_LATE_ACKS ||
            (leaf.lateAcks > 0 && millis() - leaf.lastLateAckMs < LATE_ACK_INTERVAL_MS)) {
            continue;
        }
        AckPacket ack = {};
        meshRadio.initHeader(ack.header, PACKET_ACK);
        memcpy(ack.ackedOrigin, leaf.mac, MAC_LENGTH);
        ack.ackedMessageId = leaf.messageId;
        ack.status = ACK_STORED;
        attachLeafInstruction(ack, leaf.mac);
        if (ack.instructionType == INSTRUCTION_NONE) {
            continue;
        }
        uint8_t ackFrame[sizeof(AckPacket) + TAG_LENGTH];
        memcpy(ackFrame, &ack, sizeof(ack));
        const size_t ackLength = meshAuth.signAck(ackFrame, sizeof(ack), leaf.keyId);
        const bool sent = ackLength > 0 && meshRadio.sendTo(leaf.mac, ackFrame, ackLength);
        leaf.lateAcks++;
        leaf.lastLateAckMs = millis();
        char macText[18];
        formatMac(leaf.mac, macText);
        Serial.printf("📬 Handed leaf %s a command after its reading (attempt %u)%s.\n", macText,
                      leaf.lateAcks, sent ? "" : "; ACK not confirmed");
    }
}

void meshGatewayTask(void*) {
    const uint32_t openedAt = millis();
    uint32_t lastBeaconAt = openedAt - BEACON_INTERVAL_MS;
    ReceivedFrame frame;
    while (static_cast<int32_t>(meshWindowEndMs - millis()) > 0) {
        if (beaconsHeld) {
            const bool scheduleReceived = scheduleAckCounter != beaconHoldAckCount;
            if (!scheduleReceived && millis() - openedAt < MAX_BEACON_HOLD_MS) {
                meshRadio.receive(frame, 50);  // nothing to answer before a beacon
                continue;
            }
            // The full window starts now; this only shortens the held end time.
            beaconsHeld = false;
            meshWindowEndMs = millis() + meshAwakeWindowSeconds * 1000UL;
            Serial.printf("📡 %s; beaconing for %lu s (leaves wake next at %lu).\n",
                          scheduleReceived ? "Server schedule received" : "No server schedule yet",
                          static_cast<unsigned long>(meshAwakeWindowSeconds),
                          static_cast<unsigned long>(leafWakeEpochToAdvertise()));
        }
        if (millis() - lastBeaconAt >= BEACON_INTERVAL_MS) {
            sendBeacon();
            lastBeaconAt = millis();
        }
        if (meshRadio.receive(frame, 50)) {
            handleMeshFrame(frame);
        }
        sendLateCommands();
    }
    meshRadio.end();
    Serial.printf("📡 Mesh window closed; %u leaf reading(s) waiting for upload.\n", relayQueueCount);
    // What the radio dropped for failing its check: a leaf set up with the
    // wrong key shows as bad tags, a recording replayed later as stale ones.
    const uint32_t badTags = meshAuth.dropped(AuthResult::BAD_TAG);
    const uint32_t staleNonces = meshAuth.dropped(AuthResult::STALE_NONCE);
    const uint32_t unknownKeys = meshAuth.dropped(AuthResult::UNKNOWN_KEY_ID);
    const uint32_t badLengths = meshAuth.dropped(AuthResult::BAD_LENGTH);
    if (badTags + staleNonces + unknownKeys + badLengths > 0) {
        Serial.printf("🛡️ Dropped mesh packets: %lu bad tag, %lu stale nonce, %lu unknown key ID, %lu bad length.\n",
                      static_cast<unsigned long>(badTags), static_cast<unsigned long>(staleNonces),
                      static_cast<unsigned long>(unknownKeys), static_cast<unsigned long>(badLengths));
    }
    meshTaskRunning = false;
    xSemaphoreGive(meshWindowDone);
    vTaskDelete(nullptr);
}
}

// Opens this cycle's mesh window, once the clock is synced at boot (every
// cycle is one boot: the board always deep-sleeps between cycles). Without
// network time this cycle (or the clock the server set,
// carried over) no window is opened: leaves would learn this gateway's
// drifted clock and wake at the wrong time.
void beginMeshWindow() {
    if (ownerId.length() == 0) {
        return;
    }
    if (!clockSynced) {
        Serial.println("⚠️ No network time this cycle; skipping the mesh window.");
        return;
    }
    if (meshKeyGeneration() == 0) {
        // Without the organization's key nothing it sends could be checked by a leaf.
        Serial.println("🔑 No mesh key yet; no mesh window this cycle (the server gives it with the first report).");
        return;
    }
    meshWindowStarted = true;
    ensureMeshMutex();
    if (meshWindowDone == nullptr) {
        meshWindowDone = xSemaphoreCreateBinary();
    }
    if (relayQueueMutex == nullptr || meshWindowDone == nullptr ||
        !meshRadio.begin(ownerId.c_str())) {
        Serial.println("❌ Mesh radio unavailable; no mesh window this cycle.");
        return;
    }
    applyMeshKeys(meshAuth);
    meshRadio.setAuth(&meshAuth);
    // A new random nonce for this window, once the radio is on (its random
    // numbers are only truly random then).
    meshAuth.startWindow(MeshRadio::newMessageId());
    meshAuth.resetCounts();
    clearMeshKeyRestartFlag();
    heardLeafCount = 0;

    const int64_t now = static_cast<int64_t>(time(nullptr));
    meshWindowSlotEpoch =
        isSystemClockValid() && llabs(static_cast<int64_t>(nextWakeEpoch) - now) <= SLOT_MATCH_SECONDS
            ? nextWakeEpoch
            : 0;
    beaconsHeld = meshWindowSlotEpoch == 0;
    beaconHoldAckCount = scheduleAckCounter;
    // Held, the window may start up to MAX_BEACON_HOLD_MS later; the task
    // sets the real end once it starts beaconing.
    meshWindowEndMs = millis() + (beaconsHeld ? MAX_BEACON_HOLD_MS : 0) + meshAwakeWindowSeconds * 1000UL;
    beaconSeq++;
    xSemaphoreTake(meshWindowDone, 0);
    meshTaskRunning = true;
    if (xTaskCreatePinnedToCore(meshGatewayTask, "meshGateway", MESH_TASK_STACK_BYTES,
                                nullptr, 2, nullptr, 0) != pdPASS) {
        meshTaskRunning = false;
        meshRadio.end();
        Serial.println("❌ Could not start the mesh task.");
        return;
    }
    if (beaconsHeld) {
        Serial.printf("📡 Mesh window open off the slot (beacon #%lu); holding beacons for the server's schedule.\n",
                      static_cast<unsigned long>(beaconSeq));
    } else {
        Serial.printf("📡 Mesh window open for %lu s (beacon #%lu, leaves wake next at %lu).\n",
                      static_cast<unsigned long>(meshAwakeWindowSeconds),
                      static_cast<unsigned long>(beaconSeq),
                      static_cast<unsigned long>(leafWakeEpochToAdvertise()));
    }
}

bool meshWindowStartedThisCycle() {
    return meshWindowStarted;
}

// Waits for the window to close, then uploads the readings received in it.
void endMeshWindow() {
    if (!meshWindowStarted) {
        return;
    }
    if (meshTaskRunning) {
        const uint32_t remainingMs = static_cast<int32_t>(meshWindowEndMs - millis()) > 0
            ? meshWindowEndMs - millis()
            : 0;
        xSemaphoreTake(meshWindowDone, pdMS_TO_TICKS(remainingMs + 5000));
    }
    meshWindowStarted = false;
    uploadRelayedReadings();
}

// Uploads queued leaf readings; each is removed only once the server answered.
void uploadRelayedReadings() {
    if (relayQueueMutex == nullptr || !mqttClient.connected() || deviceKey.length() == 0) {
        return;
    }
    const unsigned long startedAt = millis();
    uint8_t silentReplies = 0;
    while (true) {
        const unsigned long usedMs = relayUploadSpentMs + (millis() - startedAt);
        if (usedMs >= RELAY_UPLOAD_BUDGET_MS) {
            Serial.printf("⚠️ Relay upload time is up; %u leaf reading(s) stay queued.\n", relayQueueCount);
            break;
        }
        RelayRecord record;
        xSemaphoreTake(relayQueueMutex, portMAX_DELAY);
        const bool hasRecord = relayQueueCount > 0;
        if (hasRecord) {
            record = relayQueue[0];
        }
        xSemaphoreGive(relayQueueMutex);
        if (!hasRecord) {
            break;
        }

        const unsigned long timeoutMs = min(RELAY_RESULT_TIMEOUT_MS, RELAY_UPLOAD_BUDGET_MS - usedMs);
        const RelayUploadResult result = publishRelayRecord(record, timeoutMs);
        if (result == RELAY_NO_REPLY) {
            if (++silentReplies >= RELAY_MAX_SILENT_REPLIES) {
                Serial.println("⚠️ No relay result from the server; leaf readings stay queued.");
                break;
            }
            Serial.println("⏳ No relay result yet; sending the reading again.");
            continue;
        }
        silentReplies = 0;
        leafResultUploaded = leafResultUploaded || record.data.resultStatus != RESULT_NONE;
        removeRelayRecord(record.data.header.origin, record.data.header.messageId);
    }
    relayUploadSpentMs += millis() - startedAt;
}

bool leafResultsUploaded() {
    return leafResultUploaded;
}

// Replaces the leaf commands with the server's latest list (from the
// instruction check), which stays the reference: a command the server has
// finished or cancelled drops out at the next check.
void setLeafInstructions(const LeafInstruction* instructions, uint8_t count) {
    if (!ensureMeshMutex()) {
        return;
    }
    xSemaphoreTake(relayQueueMutex, portMAX_DELAY);
    leafInstructionCount = min(count, MAX_LEAF_INSTRUCTIONS);
    memcpy(leafInstructions, instructions, sizeof(LeafInstruction) * leafInstructionCount);
    xSemaphoreGive(relayQueueMutex);
    if (leafInstructionCount > 0) {
        Serial.printf("📥 Holding %u command(s) for leaves until their next reading.\n", leafInstructionCount);
    }
}
