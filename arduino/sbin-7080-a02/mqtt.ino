#include "globals.h"

namespace {
// The private broker, with TLS; the device logs in with its MAC and device key.
constexpr uint16_t MQTT_PORT = 8883;
// A report with its diagnostics runs to about 1 KB.
constexpr uint16_t MQTT_BUFFER_SIZE = 2048;
constexpr unsigned long MQTT_RETRY_INTERVAL_MS = 5000;
// A report period outside this range is not a plausible schedule.
constexpr uint64_t MIN_SLOT_PERIOD_SECONDS = 60;
constexpr uint64_t MAX_SLOT_PERIOD_SECONDS = 24ULL * 60ULL * 60ULL;

String acknowledgementTopic;
String commandTopic;
String instructionCheckTopic;
String logTopic;
String relayTopic;
String joinTopic;
unsigned long lastMqttAttemptAt = 0;

// The relay upload currently waiting for the server's relay_result.
String waitingRelayLeafMac;
uint32_t waitingRelayMessageId = 0;
uint32_t relayResultCounter = 0;
bool relayResultAccepted = false;

// The JOIN currently waiting for the server's join_result, and what it said.
String waitingJoinLeafMac;
String waitingJoinNonce;
uint32_t joinResultCounter = 0;
sbinmesh::JoinReplyPacket joinResult = {};
}

// Services MQTT (delivering replies to mqttCallback) for waitMs.
void serviceMqttFor(unsigned long waitMs) {
    const unsigned long startedAt = millis();
    while (millis() - startedAt < waitMs) {
        mqttClient.loop();
        delay(50);
    }
}

// Services MQTT until mqttCallback moves counter past previousValue (the
// awaited reply arrived) or timeoutMs passes; returns whether it arrived.
bool waitForMqttReply(const uint32_t& counter, uint32_t previousValue, unsigned long timeoutMs) {
    const unsigned long startedAt = millis();
    while (counter == previousValue && millis() - startedAt < timeoutMs) {
        mqttClient.loop();
        delay(50);
    }
    return counter != previousValue;
}

void setupMqtt() {
    acknowledgementTopic = "bins/ack/" + DeviceMac;
    commandTopic = "bins/command/" + DeviceMac;
    instructionCheckTopic = "bins/" + DeviceMac + "/update/instructions";
    logTopic = "bins/" + DeviceMac + "/update/log";
    relayTopic = "bins/" + DeviceMac + "/update/relay";
    joinTopic = "bins/" + DeviceMac + "/update/join";

    gsmClient.setCertificate(SBIN_CA_FILE);
    mqttClient.setServer(SBIN_SERVER_HOST, MQTT_PORT);
    mqttClient.setCallback(mqttCallback);
    mqttClient.setKeepAlive(60);
    mqttClient.setSocketTimeout(15);
    if (!mqttClient.setBufferSize(MQTT_BUFFER_SIZE)) {
        Serial.println("❌ Failed to allocate the MQTT packet buffer.");
    }
}

void maintainMqttConnection() {
    // The broker takes only registered devices: the device key is the password.
    if (mqttClient.connected() || deviceKey.length() == 0) {
        return;
    }
    if (millis() - lastMqttAttemptAt < MQTT_RETRY_INTERVAL_MS) {
        return;
    }

    lastMqttAttemptAt = millis();
    String clientId = "BinClient-" + DeviceMac;
    Serial.print("Connecting to MQTT...");

    if (!mqttClient.connect(clientId.c_str(), DeviceMac.c_str(), deviceKey.c_str())) {
        Serial.print(" failed, state=");
        Serial.println(mqttClient.state());
        // Refused credentials: once a boot, ask the server whether this device was deleted.
        static bool statusChecked = false;
        const int state = mqttClient.state();
        if (!statusChecked && (state == MQTT_CONNECT_BAD_CREDENTIALS || state == MQTT_CONNECT_UNAUTHORIZED)) {
            statusChecked = true;
            checkDeviceAfterRefusedLogin();
        }
        return;
    }

    Serial.println(" connected.");
    if (!mqttClient.subscribe(acknowledgementTopic.c_str())) {
        Serial.println("❌ Failed to subscribe to device acknowledgements.");
    }
    if (!mqttClient.subscribe(commandTopic.c_str())) {
        Serial.println("❌ Failed to subscribe to device commands.");
    }
}

bool requestInstructionCheck(unsigned long timeoutMs) {
    if (!mqttClient.connected() || deviceKey.length() == 0) {
        Serial.println("⚠️ Cannot check for server instructions; using the sleep fallback.");
        return false;
    }

    StaticJsonDocument<128> doc;
    doc["deviceKey"] = deviceKey;
    char payload[160];
    size_t payloadLength = serializeJson(doc, payload, sizeof(payload));
    if (payloadLength == 0 ||
        !mqttPublish(instructionCheckTopic.c_str(), payload, false)) {
        Serial.println("⚠️ Could not request server instructions; using the sleep fallback.");
        return false;
    }

    const uint32_t previousCheckCount = instructionCheckCounter;
    Serial.printf("Checking for server instructions (up to %lu seconds)...\n", timeoutMs / 1000);

    if (!waitForMqttReply(instructionCheckCounter, previousCheckCount, timeoutMs)) {
        Serial.println("⚠️ No instruction response before timeout; returning to sleep.");
        return false;
    }
    if (!instructionResponseValid) {
        Serial.println("⚠️ Server instruction response was invalid; using the sleep fallback.");
        return false;
    }

    return true;
}

bool publishInstructionResult(
    const String& instructionId,
    const String& status,
    const String& result
) {
    if (!mqttClient.connected() || deviceKey.length() == 0) {
        Serial.println("⚠️ Cannot report instruction result; instruction will be retried.");
        return false;
    }

    StaticJsonDocument<320> doc;
    doc["deviceKey"] = deviceKey;
    doc["instructionId"] = instructionId;
    doc["status"] = status;
    doc["result"] = result;

    char payload[384];
    size_t payloadLength = serializeJson(doc, payload, sizeof(payload));
    if (payloadLength == 0 || !mqttPublish(
            ("bins/" + DeviceMac + "/update/instruction-result").c_str(),
            payload,
            false)) {
        Serial.println("⚠️ Failed to publish instruction result; instruction will be retried.");
        return false;
    }

    waitingInstructionResultId = instructionId;
    const uint32_t previousAckCount = instructionResultAckCounter;
    const bool confirmed = waitForMqttReply(instructionResultAckCounter, previousAckCount, 2000UL);
    waitingInstructionResultId = "";

    if (!confirmed) {
        Serial.println("⚠️ No server confirmation for instruction result; it will be retried.");
        return false;
    }
    return true;
}

// Parses `bytes` bytes written as hex digit pairs, each pair followed by
// `separator` except the last (0 for none), e.g. a MAC or an ObjectId.
bool parseHexBytes(const char* text, uint8_t* out, size_t bytes, char separator) {
    for (size_t i = 0; i < bytes; i++) {
        for (uint8_t half = 0; half < 2; half++) {
            const char c = *text++;
            uint8_t digit;
            if (c >= '0' && c <= '9') digit = c - '0';
            else if (c >= 'a' && c <= 'f') digit = c - 'a' + 10;
            else if (c >= 'A' && c <= 'F') digit = c - 'A' + 10;
            else return false;
            out[i] = half == 0 ? digit << 4 : out[i] | digit;
        }
        if (separator != 0 && i + 1 < bytes && *text++ != separator) {
            return false;
        }
    }
    return *text == '\0';
}

sbinmesh::InstructionType leafInstructionType(const char* type) {
    if (strcmp(type, "report_now") == 0) return sbinmesh::INSTRUCTION_REPORT_NOW;
    if (strcmp(type, "calibrate_empty_bin") == 0) return sbinmesh::INSTRUCTION_CALIBRATE_EMPTY_BIN;
    if (strcmp(type, "calibrate_scale") == 0) return sbinmesh::INSTRUCTION_CALIBRATE_SCALE;
    if (strcmp(type, "become_leaf") == 0) return sbinmesh::INSTRUCTION_BECOME_LEAF;
    return sbinmesh::INSTRUCTION_NONE;
}

// Replaces the held leaf commands with the instruction check's list; a
// malformed entry is skipped, so the others still reach their leaves.
void storeLeafInstructions(JsonArrayConst instructions) {
    LeafInstruction parsed[MAX_LEAF_INSTRUCTIONS];
    uint8_t count = 0;
    for (JsonObjectConst instruction : instructions) {
        if (count >= MAX_LEAF_INSTRUCTIONS) {
            break;
        }
        const char* leafMac = instruction["leafMac"] | "";
        const char* id = instruction["id"] | "";
        LeafInstruction& entry = parsed[count];
        entry.type = leafInstructionType(instruction["type"] | "");
        JsonVariantConst grams = instruction["payload"]["grams"];
        entry.value = grams.is<uint32_t>() ? grams.as<uint32_t>() : 0;
        if (entry.type == sbinmesh::INSTRUCTION_NONE ||
            !parseHexBytes(leafMac, entry.leafMac, sbinmesh::MAC_LENGTH, ':') ||
            !parseHexBytes(id, entry.id, sbinmesh::INSTRUCTION_ID_LENGTH, 0)) {
            Serial.printf("⚠️ Skipping an invalid leaf command for %s.\n", leafMac);
            continue;
        }
        count++;
    }
    setLeafInstructions(parsed, count);
}

// The server's result text for a leaf's command result (see ResultCode).
String leafResultText(const sbinmesh::DataPacket& data) {
    switch (data.resultCode) {
        case sbinmesh::RESULT_REPORT_SENT:
            return "additional_report_published";
        case sbinmesh::RESULT_EMPTY_DEPTH:
            return "empty_depth_mm_" + String(data.resultValue);
        case sbinmesh::RESULT_CALIBRATION_FAILED:
            return "empty_bin_calibration_failed";
        case sbinmesh::RESULT_SCALE_CALIBRATED:
            return "scale_calibrated_" + String(data.resultExtra) + "_reads_" + String(data.resultValue);
        case sbinmesh::RESULT_SCALE_NOT_RESPONDING:
            return "scale_not_responding";
        case sbinmesh::RESULT_BECAME_LEAF:
            return "became_leaf";
        case sbinmesh::RESULT_SCALE_ERROR:
            switch (data.resultValue) {
                case sbinmesh::SCALE_ERROR_UNSTABLE: return "scale_unstable";
                case sbinmesh::SCALE_ERROR_NOT_ZEROED: return "scale_not_zeroed";
                case sbinmesh::SCALE_ERROR_NO_LOAD_CHANGE: return "scale_no_load_change";
                case sbinmesh::SCALE_ERROR_INVALID_WEIGHT: return "scale_invalid_weight";
                default: return "scale_error";
            }
        default:
            return "unsupported_instruction_type";
    }
}

const char* leafScaleText(uint8_t scaleState) {
    switch (scaleState) {
        case sbinmesh::SCALE_STATE_OK: return "ok";
        case sbinmesh::SCALE_STATE_UNCALIBRATED: return "uncalibrated";
        case sbinmesh::SCALE_STATE_FAILED: return "failed";
        default: return nullptr;
    }
}

// Uploads one leaf reading on this gateway's relay topic and waits for the
// server's relay_result. The server vouches for the leaf through this
// gateway's device key and creates the leaf bin in this organization.
RelayUploadResult publishRelayRecord(const RelayRecord& record, unsigned long timeoutMs) {
    if (!mqttClient.connected() || deviceKey.length() == 0) {
        return RELAY_NO_REPLY;
    }

    const sbinmesh::DataPacket& data = record.data;
    char leafMac[18];
    sbinmesh::formatMac(data.header.origin, leafMac);
    const bool sensorOk = (data.flags & sbinmesh::DATA_SENSOR_OK) != 0;

    StaticJsonDocument<1536> doc;
    doc["deviceKey"] = deviceKey;
    doc["leafMac"] = leafMac;
    doc["messageId"] = data.header.messageId;
    doc["hops"] = record.hops;
    doc["rssi"] = record.rssi;
    if (record.measuredAtEpoch > 0) {
        doc["measuredAt"] = record.measuredAtEpoch;
    }
    JsonObject reading = doc["record"].to<JsonObject>();
    reading["health"] = healthFromFailureCounts(
        data.sensorFailureCycles, data.pmuFailureCycles, data.gpsFailureCycles);
    reading["sensorOk"] = sensorOk;
    if (sensorOk) {
        reading["level"] = data.level;
    }
    reading["battery"] = data.battery;
    // A leaf without a scale sends no state, and the server keeps no weight.
    const char* scale = leafScaleText(data.scaleState);
    reading["weight"] = scale != nullptr && data.scaleState == sbinmesh::SCALE_STATE_OK ? data.weightGrams : 0;
    if (scale != nullptr) {
        reading["scale"] = scale;
    }
    if (data.flags & sbinmesh::DATA_HAS_LOCATION) {
        reading["location"][0] = data.latitude;
        reading["location"][1] = data.longitude;
    }
    JsonArray faults = reading["faults"].to<JsonArray>();
    addFaults(faults, data.sensorFailureCycles, data.pmuFailureCycles, data.gpsFailureCycles,
              (data.flags & sbinmesh::DATA_CALIBRATION_FAILED) != 0, data.distanceMm);
    // A gateway reporting through this one says why it cannot itself.
    if (data.flags & sbinmesh::DATA_SIM_MISSING) {
        faults.add<JsonObject>()["code"] = "sim_missing";
    }
    if (data.flags & sbinmesh::DATA_NO_CELLULAR) {
        faults.add<JsonObject>()["code"] = "cellular_unavailable";
    }
    if (faults.size() == 0) {
        reading.remove("faults");
    }
    if (data.lastAwakeSeconds > 0) {
        reading["lastAwakeSeconds"] = data.lastAwakeSeconds;
    }
    if (data.driftPpm != 0) {
        reading["driftPpm"] = data.driftPpm;
    }
    addLeafDiagnostics(reading["diagnostics"].to<JsonObject>(), data.diagnostics);
    if (data.resultStatus == sbinmesh::RESULT_COMPLETED || data.resultStatus == sbinmesh::RESULT_FAILED) {
        char instructionId[sbinmesh::INSTRUCTION_ID_LENGTH * 2 + 1];
        for (size_t i = 0; i < sbinmesh::INSTRUCTION_ID_LENGTH; i++) {
            snprintf(instructionId + i * 2, 3, "%02x", data.resultId[i]);
        }
        JsonObject result = doc["instructionResult"].to<JsonObject>();
        result["instructionId"] = instructionId;
        result["status"] = data.resultStatus == sbinmesh::RESULT_COMPLETED ? "completed" : "failed";
        result["result"] = leafResultText(data);
    }

    char payload[1536];
    const size_t payloadLength = serializeJson(doc, payload, sizeof(payload));
    if (payloadLength == 0 || payloadLength >= sizeof(payload) ||
        !mqttPublish(relayTopic.c_str(), payload)) {
        Serial.printf("❌ Could not publish the relayed reading of %s.\n", leafMac);
        return RELAY_NO_REPLY;
    }

    waitingRelayLeafMac = leafMac;
    waitingRelayMessageId = data.header.messageId;
    const uint32_t previousResultCount = relayResultCounter;
    const bool replied = waitForMqttReply(relayResultCounter, previousResultCount, timeoutMs);
    waitingRelayLeafMac = "";
    if (!replied) {
        return RELAY_NO_REPLY;
    }
    Serial.printf("%s Relayed reading %08lX of %s.\n",
                  relayResultAccepted ? "✅ Server stored" : "⚠️ Server rejected",
                  static_cast<unsigned long>(data.header.messageId), leafMac);
    return relayResultAccepted ? RELAY_ACCEPTED : RELAY_REJECTED;
}

// Passes a leaf's JOIN to the server and waits for its join_result (the leaf's
// keys sealed under its join code, or a refusal), returned as the reply packet
// to hand to the leaf, apart from the header.
RelayUploadResult publishJoinRequest(const sbinmesh::JoinPacket& join, sbinmesh::JoinReplyPacket& reply,
                                     unsigned long timeoutMs) {
    if (!mqttClient.connected() || deviceKey.length() == 0) {
        return RELAY_NO_REPLY;
    }
    char leafMac[18];
    sbinmesh::formatMac(join.header.origin, leafMac);
    char orgId[sbinmesh::ORG_ID_LENGTH * 2 + 1];
    char codeId[sbinmesh::JOIN_CODE_ID_LENGTH * 2 + 1];
    char nonce[sbinmesh::JOIN_NONCE_LENGTH * 2 + 1];
    char proof[sbinmesh::JOIN_PROOF_LENGTH * 2 + 1];
    auto hex = [](const uint8_t* bytes, size_t length, char* out) {
        for (size_t i = 0; i < length; i++) {
            snprintf(out + i * 2, 3, "%02x", bytes[i]);
        }
    };
    hex(join.orgId, sizeof(join.orgId), orgId);
    hex(join.codeId, sizeof(join.codeId), codeId);
    hex(join.nonce, sizeof(join.nonce), nonce);
    hex(join.proof, sizeof(join.proof), proof);

    StaticJsonDocument<512> doc;
    doc["deviceKey"] = deviceKey;
    doc["leafMac"] = leafMac;
    doc["orgId"] = orgId;
    doc["codeId"] = codeId;
    doc["nonce"] = nonce;
    doc["proof"] = proof;
    char payload[512];
    const size_t payloadLength = serializeJson(doc, payload, sizeof(payload));
    if (payloadLength == 0 || payloadLength >= sizeof(payload) || !mqttPublish(joinTopic.c_str(), payload)) {
        Serial.printf("❌ Could not publish the JOIN of %s.\n", leafMac);
        return RELAY_NO_REPLY;
    }

    waitingJoinLeafMac = leafMac;
    waitingJoinNonce = nonce;
    const uint32_t previousResultCount = joinResultCounter;
    const bool replied = waitForMqttReply(joinResultCounter, previousResultCount, timeoutMs);
    waitingJoinLeafMac = "";
    waitingJoinNonce = "";
    if (!replied) {
        return RELAY_NO_REPLY;
    }
    reply = joinResult;
    Serial.printf("%s the JOIN of %s.\n",
                  reply.status == sbinmesh::JOIN_ACCEPTED ? "✅ Server accepted" : "⚠️ Server refused", leafMac);
    return reply.status == sbinmesh::JOIN_ACCEPTED ? RELAY_ACCEPTED : RELAY_REJECTED;
}

bool publishTelemetry(const DeviceReading& reading) {
    if (!mqttClient.connected() || !hasGpsFix || deviceKey.length() == 0) {
        return false;
    }

    int level = calculateFillLevel(reading.distanceMm);
    bool sensorOk = level >= 0;

    StaticJsonDocument<1536> doc;
    doc["deviceKey"] = deviceKey;
    // The mesh key's generation this gateway holds (0: none); the server sends
    // the key in its ack when it differs.
    doc["meshKeyId"] = meshKeyGeneration();
    doc["sensorOk"] = sensorOk;
    if (sensorOk) {
        doc["level"] = level;
    }
    doc["battery"] = reading.batteryPercent;
    if (lastAwakeSeconds > 0) {
        doc["lastAwakeSeconds"] = lastAwakeSeconds;
    }
    if (driftMeasured) {
        doc["driftPpm"] = driftPpm;
    }
    if (hasClockError) {
        doc["clockErrorSeconds"] = clockErrorSeconds;
    }
    doc["health"] = reading.health;
    doc["weight"] = reading.weightGrams;
    doc["scale"] = reading.scaleState;
    doc["location"][0] = latitude;
    doc["location"][1] = longitude;
    JsonArray faults = doc["faults"].to<JsonArray>();
    addOwnFaults(faults, reading.distanceMm);
    if (faults.size() == 0) {
        doc.remove("faults");
    }
    addDiagnostics(doc["diagnostics"].to<JsonObject>(), reading);

    char payload[1536];
    size_t payloadLength = serializeJson(doc, payload, sizeof(payload));
    if (payloadLength == 0 || payloadLength >= sizeof(payload) - 1) {
        Serial.println("❌ Failed to serialize telemetry.");
        return false;
    }
    if (payloadLength + strlen(logTopic.c_str()) + 7 > mqttClient.getBufferSize()) {
        Serial.printf(
            "❌ Telemetry packet too large: payload=%u bytes, MQTT buffer=%u bytes.\n",
            static_cast<unsigned>(payloadLength),
            mqttClient.getBufferSize()
        );
        return false;
    }
    if (!mqttPublish(logTopic.c_str(), payload)) {
        Serial.println("❌ MQTT client rejected telemetry publish.");
        return false;
    }

    Serial.println("Telemetry published: " + String(payload));
    return true;
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
    StaticJsonDocument<1536> doc;
    // const: ArduinoJson copies the strings instead of rewriting the buffer.
    DeserializationError error = deserializeJson(doc, static_cast<const byte*>(payload), length);
    if (error) {
        Serial.print("❌ Invalid MQTT message: ");
        Serial.println(error.c_str());
        return;
    }

    String receivedTopic(topic);
    if (receivedTopic == acknowledgementTopic) {
        if (doc["deviceKey"].is<const char*>()) {
            deviceKey = doc["deviceKey"].as<String>();
            if (deviceKey.length() > 0) {
                saveDeviceKey(deviceKey);
                Serial.println("✅ Device key received and saved.");
            }
        }

        if (doc["meshKey"].is<const char*>() && doc["meshKeyId"].is<int>()) {
            storeMeshKeyFromServer(doc["meshKey"].as<const char*>(), doc["meshKeyId"].as<int>());
        }

        // First, so the wake time below is checked against a corrected clock.
        if (doc["nextWakeEpoch"].is<uint64_t>() && doc["sleepDurationSeconds"].is<uint32_t>()) {
            correctClockFromServer(static_cast<time_t>(
                doc["nextWakeEpoch"].as<uint64_t>() - doc["sleepDurationSeconds"].as<uint32_t>()));
        }
        if (doc["nextWakeEpoch"].is<uint64_t>()) {
            uint64_t serverNextWakeEpoch = doc["nextWakeEpoch"].as<uint64_t>();
            if (serverNextWakeEpoch > static_cast<uint64_t>(time(nullptr))) {
                nextWakeEpoch = serverNextWakeEpoch;
                preferences.begin("credentials", false);
                preferences.putULong64("nextWake", nextWakeEpoch);
                preferences.end();
                scheduleAckCounter++;
                Serial.printf(
                    "✅ Next report scheduled at UTC epoch %llu.\n",
                    static_cast<unsigned long long>(nextWakeEpoch)
                );
            } else {
                Serial.println("⚠️ Server sent an invalid or expired nextWakeEpoch.");
            }
        }
        if (doc["followingWakeEpoch"].is<uint64_t>()) {
            uint64_t serverFollowingWakeEpoch = doc["followingWakeEpoch"].as<uint64_t>();
            if (serverFollowingWakeEpoch > nextWakeEpoch) {
                followingWakeEpoch = serverFollowingWakeEpoch;
                // Remember the report period so the next beacons can continue
                // the slot pattern even after a cycle without a server reply.
                const uint64_t period = followingWakeEpoch - nextWakeEpoch;
                if (doc["nextWakeEpoch"].as<uint64_t>() == nextWakeEpoch &&
                    period >= MIN_SLOT_PERIOD_SECONDS && period <= MAX_SLOT_PERIOD_SECONDS &&
                    period != slotPeriodSeconds) {
                    slotPeriodSeconds = static_cast<uint32_t>(period);
                    preferences.begin("credentials", false);
                    preferences.putUInt("slotPeriod", slotPeriodSeconds);
                    preferences.end();
                }
            } else {
                Serial.println("⚠️ Server sent a followingWakeEpoch that is not after nextWakeEpoch.");
            }
        }
        if (doc["sleepDurationSeconds"].is<uint32_t>()) {
            scheduledSleepDurationSeconds = doc["sleepDurationSeconds"].as<uint32_t>();
            preferences.begin("credentials", false);
            preferences.putUInt("sleepDuration", scheduledSleepDurationSeconds);
            preferences.end();
        }
        if (doc["meshAwakeWindowSeconds"].is<uint32_t>()) {
            uint32_t serverMeshAwakeWindowSeconds = doc["meshAwakeWindowSeconds"].as<uint32_t>();
            if (serverMeshAwakeWindowSeconds == 0 ||
                serverMeshAwakeWindowSeconds > MAX_MESH_AWAKE_WINDOW_SECONDS) {
                Serial.println("⚠️ Server sent an invalid meshAwakeWindowSeconds.");
            } else if (serverMeshAwakeWindowSeconds != meshAwakeWindowSeconds) {
                meshAwakeWindowSeconds = serverMeshAwakeWindowSeconds;
                preferences.begin("credentials", false);
                preferences.putUInt("meshAwake", meshAwakeWindowSeconds);
                preferences.end();
                Serial.printf(
                    "📡 Mesh awake window set to %lu seconds.\n",
                    static_cast<unsigned long>(meshAwakeWindowSeconds)
                );
            }
        }
        if (doc["status"] == "instruction_check") {
            JsonArrayConst instructions = doc["instructions"].as<JsonArrayConst>();
            pendingInstructionCount = 0;
            instructionResponseValid = instructions.size() <= MAX_PENDING_INSTRUCTIONS;
            for (JsonObjectConst instruction : instructions) {
                if (pendingInstructionCount >= MAX_PENDING_INSTRUCTIONS ||
                    !instruction["id"].is<const char*>() ||
                    !instruction["type"].is<const char*>()) {
                    instructionResponseValid = false;
                    break;
                }
                pendingInstructions[pendingInstructionCount].id = instruction["id"].as<String>();
                pendingInstructions[pendingInstructionCount].type = instruction["type"].as<String>();
                JsonVariantConst durationSeconds = instruction["payload"]["durationSeconds"];
                pendingInstructions[pendingInstructionCount].durationSeconds =
                    durationSeconds.is<uint32_t>() ? durationSeconds.as<uint32_t>() : 0;
                JsonVariantConst grams = instruction["payload"]["grams"];
                pendingInstructions[pendingInstructionCount].grams =
                    grams.is<uint32_t>() ? grams.as<uint32_t>() : 0;
                if (pendingInstructions[pendingInstructionCount].id.length() == 0 ||
                    pendingInstructions[pendingInstructionCount].type.length() == 0) {
                    instructionResponseValid = false;
                    break;
                }
                pendingInstructionCount++;
            }
            if (instructionResponseValid) {
                storeLeafInstructions(doc["leafInstructions"].as<JsonArrayConst>());
            }
            instructionCheckCounter++;
            if (pendingInstructionCount > 0) {
                Serial.printf(
                    "📥 Server returned %u pending instruction(s).\n",
                    pendingInstructionCount
                );
            }
        }
        if (doc["status"] == "instruction_result" &&
            doc["accepted"] == true &&
            doc["instructionId"].is<const char*>() &&
            waitingInstructionResultId == doc["instructionId"].as<String>()) {
            instructionResultAckCounter++;
        }
        if (doc["status"] == "join_result" &&
            doc["leafMac"].is<const char*>() &&
            doc["nonce"].is<const char*>() &&
            waitingJoinLeafMac.equalsIgnoreCase(doc["leafMac"].as<const char*>()) &&
            waitingJoinNonce.equalsIgnoreCase(doc["nonce"].as<const char*>())) {
            joinResult = {};
            parseHexBytes(doc["nonce"].as<const char*>(), joinResult.nonce, sbinmesh::JOIN_NONCE_LENGTH, 0);
            parseHexBytes(doc["leafMac"].as<const char*>(), joinResult.leafMac, sbinmesh::MAC_LENGTH, ':');
            joinResult.status = sbinmesh::JOIN_REFUSED;
            if (doc["accepted"] == true && doc["iv"].is<const char*>() && doc["ciphertext"].is<const char*>() &&
                doc["tag"].is<const char*>() &&
                parseHexBytes(doc["iv"].as<const char*>(), joinResult.iv, sbinmesh::JOIN_IV_LENGTH, 0) &&
                parseHexBytes(doc["ciphertext"].as<const char*>(), joinResult.sealed, sbinmesh::JOIN_SEALED_LENGTH, 0) &&
                parseHexBytes(doc["tag"].as<const char*>(), joinResult.tag, sbinmesh::JOIN_TAG_LENGTH, 0)) {
                joinResult.status = sbinmesh::JOIN_ACCEPTED;
            } else if (doc["reason"].is<const char*>()) {
                Serial.printf("⚠️ JOIN refused by the server: %s.\n", doc["reason"].as<const char*>());
            }
            joinResultCounter++;
        }
        if (doc["status"] == "relay_result" &&
            doc["leafMac"].is<const char*>() &&
            doc["messageId"].is<uint32_t>() &&
            doc["messageId"].as<uint32_t>() == waitingRelayMessageId &&
            waitingRelayLeafMac.equalsIgnoreCase(doc["leafMac"].as<const char*>())) {
            relayResultAccepted = doc["accepted"] == true;
            if (!relayResultAccepted && doc["reason"].is<const char*>()) {
                Serial.printf("⚠️ Relay rejected by the server: %s.\n",
                              doc["reason"].as<const char*>());
            }
            relayResultCounter++;
        }
        return;
    }

    if (receivedTopic == commandTopic && doc["command"] == "reset") {
        Serial.println("Reset command received; clearing device settings.");
        clearDeviceSettings();
        delay(1000);
        ESP.restart();
    }
}
