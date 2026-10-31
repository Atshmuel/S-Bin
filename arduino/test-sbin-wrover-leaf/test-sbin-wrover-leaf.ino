// S-Bin simulated mesh leaf for an ESP32-WROVER test board.
// TEST ONLY: remove this sketch once real leaf boards run the LilyGO firmware.
//
// Stands in for a bin without a SIM until the SIM-less LilyGO arrives. It has
// no Wi-Fi uplink and no real sensors: every cycle it wakes on the schedule it
// learned from a gateway beacon, sends a fake reading over ESP-NOW LR, waits
// for the gateway's ACK and deep-sleeps until the next slot. The cycle itself
// is the library's (SbinMeshLeaf.h); this sketch only fakes the measurements
// and the commands.
//
// Its packets are signed and the gateway's checked (2m) with keys that come,
// in this order, from mesh_keys.h (made for this board by
// server/scripts/mesh-keys.mjs, see mesh_keys.example.h), from flash (where a
// JOIN leaves them), or from a JOIN: it asks a gateway for them with the
// one-time code in join_code.h (server/scripts/join-code.mjs, see
// join_code.example.h), the way a real leaf does with the code its setup page took.
//
// Board: "ESP32 Dev Module" (esp32:esp32:esp32), or the LilyGO S3 (the SIM is
// not used). Serial monitor: 115200 baud.

#if __has_include("mesh_keys.h")
#include "mesh_keys.h"
#define HAS_BENCH_KEYS 1
#else
#define HAS_BENCH_KEYS 0
#endif
#if __has_include("join_code.h")
#include "join_code.h"
#define HAS_JOIN_CODE 1
#else
#define HAS_JOIN_CODE 0
#endif
#if !HAS_BENCH_KEYS && !HAS_JOIN_CODE
#error "No keys: make mesh_keys.h (server/scripts/mesh-keys.mjs) or join_code.h (server/scripts/join-code.mjs)."
#endif

#include <SbinMesh.h>
#include <SbinMeshLeaf.h>
#include <esp_attr.h>
#include <esp_sleep.h>
#include <string.h>

using namespace sbinmesh;

namespace {
// Must match the organization ID entered in the gateway's setup portal; nodes
// of other organizations ignore each other.
constexpr char ORGANIZATION_ID[] = "699760a44e48dff9a082101e";

// This sketch's version, reported in its diagnostics (bump it for every flash).
constexpr uint8_t FIRMWARE_VERSION[3] = {2, 0, 0};

#if defined(ARDUINO_USB_CDC_ON_BOOT) && ARDUINO_USB_CDC_ON_BOOT
// An S3's native USB port disappears at every deep sleep (the WROVER's USB
// chip keeps its port), so on that build every boot waits this long for a
// Serial Monitor to (re)connect, or the first lines are lost. On battery it
// just times out; it uses up at most this much of the wake guard.
constexpr uint32_t USB_LOG_RECONNECT_WAIT_MS = 3000;
#endif
}  // namespace

RTC_DATA_ATTR uint8_t fakeLevel = 10;
RTC_DATA_ATTR uint8_t fakeBattery = 100;

namespace {
void fillFakeReading(DataPacket& reading) {
    fakeLevel = static_cast<uint8_t>((fakeLevel + 7) % 101);
    fakeBattery = fakeBattery <= 20 ? 100 : static_cast<uint8_t>(fakeBattery - 1);

    reading.flags = DATA_SENSOR_OK;  // no location: the gateway's is used
    reading.level = fakeLevel;
    reading.battery = fakeBattery;
    reading.distanceMm = static_cast<int16_t>(1000 - fakeLevel * 8);
    // This board has no battery gauge, sensor or scale: those diagnostics stay out.
}

// Simulated: this leaf has no sensor or scale.
void runSimulatedInstruction(const AckPacket& ack, DataPacket& reading) {
    switch (ack.instructionType) {
        case INSTRUCTION_REPORT_NOW:
            // The fresh reading is the extra report.
            reading.resultStatus = RESULT_COMPLETED;
            reading.resultCode = RESULT_REPORT_SENT;
            break;
        case INSTRUCTION_CALIBRATE_EMPTY_BIN:
            reading.resultStatus = RESULT_COMPLETED;
            reading.resultCode = RESULT_EMPTY_DEPTH;
            reading.resultValue = 1000;
            break;
        case INSTRUCTION_CALIBRATE_SCALE:
            reading.resultStatus = RESULT_FAILED;
            reading.resultCode = RESULT_SCALE_NOT_RESPONDING;
            break;
        default:
            reading.resultStatus = RESULT_FAILED;
            reading.resultCode = RESULT_UNSUPPORTED;
            break;
    }
}

LeafConfig makeConfig(const LeafKeys& keys) {
    LeafConfig config = {};
    config.organizationId = ORGANIZATION_ID;
    memcpy(config.firmwareVersion, FIRMWARE_VERSION, sizeof(FIRMWARE_VERSION));
    config.keys = keys;
    config.hooks.fillReading = fillFakeReading;
    config.hooks.runInstruction = runSimulatedInstruction;
    return config;
}

// The keys of this board: the bench header's, the ones a JOIN left in flash, or
// a JOIN now. Sleeps and tries again when a JOIN gets no keys.
LeafKeys findKeys() {
    LeafKeys keys = {};
#if HAS_BENCH_KEYS
    memcpy(keys.mac, MESH_KEY_MAC, MAC_LENGTH);
    memcpy(keys.leafKey, MESH_LEAF_KEY, KEY_LENGTH);
    memcpy(keys.beaconKey, MESH_BEACON_KEY, KEY_LENGTH);
    keys.keyId = MESH_KEY_ID;
#else
    if (!loadJoinedKeys(keys)) {
#if HAS_JOIN_CODE
        constexpr uint32_t JOIN_LISTEN_MS = 13UL * 60UL * 60UL * 1000UL + 30UL * 60UL * 1000UL;
        constexpr uint64_t RETRY_SLEEP_SECONDS = 15ULL * 60ULL;
        const JoinConfig join = {ORGANIZATION_ID, JOIN_CODE};
        if (joinMesh(join, keys, JOIN_LISTEN_MS) != JoinOutcome::JOINED) {
            Serial.println("⚠️ Not joined; sleeping before trying again.");
            Serial.flush();
            esp_sleep_enable_timer_wakeup(RETRY_SLEEP_SECONDS * 1000000ULL);
            esp_deep_sleep_start();
        }
        Serial.println("✅ Joined the mesh: the keys are saved.");
#endif
    }
#endif
    return keys;
}
}  // namespace

void setup() {
    Serial.begin(115200);
#if defined(ARDUINO_USB_CDC_ON_BOOT) && ARDUINO_USB_CDC_ON_BOOT
    const uint32_t usbWaitStartedAt = millis();
    while (!Serial && millis() - usbWaitStartedAt < USB_LOG_RECONNECT_WAIT_MS) {
        delay(10);
    }
#endif
    Serial.println("\n=== S-Bin WROVER simulated mesh leaf ===");
    if (strcmp(ORGANIZATION_ID, "PUT_YOUR_ORGANIZATION_ID_HERE") == 0) {
        Serial.println("❌ Set ORGANIZATION_ID in the sketch to the gateway's organization ID.");
    }
    // The config must outlive the cycle, which never returns.
    static LeafConfig leafConfig;
    leafConfig = makeConfig(findKeys());
    runLeafCycle(leafConfig);
}

void loop() {}
