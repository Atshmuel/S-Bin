#pragma once

#include <stddef.h>
#include <stdint.h>

// Wire format shared by every S-Bin mesh node. All packets are packed and
// little-endian (every supported node is an ESP32), and fit in one ESP-NOW
// frame (250 bytes). Bump PROTOCOL_VERSION on any incompatible change.

namespace sbinmesh {

constexpr uint16_t PACKET_MAGIC = 0x4253;  // "SB"
// 4: DATA carries the leaf's diagnostics (LeafDiagnostics).
// 5: every packet ends with an 8-byte authentication tag (SbinMeshAuth.h); the
// header names the key, a beacon carries a nonce for its mesh window and DATA
// echoes it.
constexpr uint8_t PROTOCOL_VERSION = 5;
constexpr uint8_t RADIO_CHANNEL = 1;
constexpr uint8_t DEFAULT_TTL = 4;
constexpr size_t MAX_FRAME_SIZE = 250;
constexpr size_t MAC_LENGTH = 6;
// The tag after each packet's struct: HMAC-SHA256, cut to this many bytes.
constexpr size_t TAG_LENGTH = 8;
// The longest report interval is a day, 25 hours on the day clocks go back; a
// wake time further ahead than this is stale (saved while a clock was wrong).
constexpr uint32_t MAX_WAKE_AHEAD_SECONDS = 26UL * 60UL * 60UL;

enum PacketType : uint8_t {
    PACKET_BEACON = 1,
    PACKET_DATA = 2,
    PACKET_ACK = 3,
    // A leaf without keys joins the mesh (SbinMeshJoin.h). Neither carries the
    // 8-byte tag: the leaf has no key yet, and the reply is sealed by its own tag.
    PACKET_JOIN = 4,
    PACKET_JOIN_REPLY = 5,
};

enum AckStatus : uint8_t {
    ACK_STORED = 1,      // the gateway took custody of the reading
    ACK_DUPLICATE = 2,   // already stored earlier; the sender can drop it
    ACK_REJECTED = 3,    // will never be accepted; the sender should drop it
};

// A server command's id (a MongoDB ObjectId, as its 12 bytes).
constexpr size_t INSTRUCTION_ID_LENGTH = 12;

// Commands a gateway hands to a leaf in the ACK to the leaf's reading.
enum InstructionType : uint8_t {
    INSTRUCTION_NONE = 0,
    INSTRUCTION_REPORT_NOW = 1,
    INSTRUCTION_CALIBRATE_EMPTY_BIN = 2,
    INSTRUCTION_CALIBRATE_SCALE = 3,   // value: the known weight in grams
    INSTRUCTION_BECOME_LEAF = 4,       // a gateway reporting through another stops being one
};

enum ResultStatus : uint8_t {
    RESULT_NONE = 0,                   // no command result in this packet
    RESULT_COMPLETED = 1,
    RESULT_FAILED = 2,
};

// What a leaf's command produced; the gateway turns it into the server's
// result text (in brackets).
enum ResultCode : uint8_t {
    RESULT_REPORT_SENT = 1,            // additional_report_published
    RESULT_EMPTY_DEPTH = 2,            // empty_depth_mm_<value>
    RESULT_CALIBRATION_FAILED = 3,     // empty_bin_calibration_failed
    RESULT_SCALE_CALIBRATED = 4,       // scale_calibrated_<extra>_reads_<value>
    RESULT_SCALE_NOT_RESPONDING = 5,   // scale_not_responding
    RESULT_UNSUPPORTED = 6,            // unsupported_instruction_type
    RESULT_SCALE_ERROR = 7,            // the scale's code for value (ScaleError)
    RESULT_BECAME_LEAF = 8,            // became_leaf
};

// Why a leaf's scale command failed, as RESULT_SCALE_ERROR's value.
enum ScaleError : uint8_t {
    SCALE_ERROR_UNSTABLE = 1,          // scale_unstable
    SCALE_ERROR_NOT_ZEROED = 2,        // scale_not_zeroed
    SCALE_ERROR_NO_LOAD_CHANGE = 3,    // scale_no_load_change
    SCALE_ERROR_INVALID_WEIGHT = 4,    // scale_invalid_weight
};

// A leaf's scale, as the server's report field "scale".
enum ScaleState : uint8_t {
    SCALE_STATE_NONE = 0,              // no scale: the server keeps no weight
    SCALE_STATE_OK = 1,
    SCALE_STATE_UNCALIBRATED = 2,
    SCALE_STATE_FAILED = 3,
};

enum DataFlags : uint8_t {
    DATA_SENSOR_OK = 0x01,
    DATA_HAS_LOCATION = 0x02,
    DATA_CALIBRATION_FAILED = 0x04,
    // From a gateway that reports through another one (it cannot itself):
    DATA_SIM_MISSING = 0x08,           // no SIM card in it
    DATA_NO_CELLULAR = 0x10,           // its modem or the network failed
};

struct __attribute__((packed)) PacketHeader {
    uint16_t magic;
    uint8_t version;
    uint8_t type;
    uint32_t networkId;           // first 4 bytes of SHA-256(ownerId); a filter, not security
    uint8_t origin[MAC_LENGTH];   // node that created the packet
    uint32_t messageId;           // random per message; retries reuse it
    uint8_t hops;                 // radio hops travelled so far
    uint8_t ttl;                  // dropped when it reaches 0
    uint8_t keyId;                // which generation of the organization's key signed it
};

// Broadcast by gateways (hopsToGateway = 0) during the mesh window.
struct __attribute__((packed)) BeaconPacket {
    PacketHeader header;
    uint8_t hopsToGateway;
    uint32_t beaconSeq;           // increases every cycle; only fresh routes are used
    uint64_t epochMs;             // sender's UTC time, the leaves' time source
    uint32_t nextWakeEpoch;       // when leaves should wake next (UTC seconds)
    uint8_t meshWindowSeconds;
    uint8_t parentMac[MAC_LENGTH];  // all zero for a gateway
    // Random for each mesh window of the gateway; the DATA a leaf sends in
    // answer echoes it, so a recorded DATA is useless in a later window.
    uint32_t cycleNonce;
};

// Which of a leaf's optional diagnostics it measured.
enum DiagnosticFlags : uint8_t {
    DIAG_HAS_BATTERY_MV = 0x01,
    DIAG_HAS_CHIP_TEMP = 0x02,
    DIAG_HAS_DISTANCE_SPREAD = 0x04,
    DIAG_HAS_SCALE_SAMPLE = 0x08,
};

// What a leaf reports about itself; the gateway turns it into the server's
// "diagnostics" object. The reset reason is ESP-IDF's esp_reset_reason_t
// (see resetReasonName()).
struct __attribute__((packed)) LeafDiagnostics {
    uint8_t firmwareVersion[3];   // major, minor, patch
    uint8_t resetReason;
    uint8_t flags;                // DiagnosticFlags
    uint16_t batteryMv;
    int8_t chipTempC;
    int8_t beaconRssi;            // the gateway's beacon as the leaf heard it
    uint16_t guardSeconds;        // how long before its slot it woke
    uint8_t missedCycles;         // beacons missed in a row before this one
    uint16_t residualPpm;         // the drift its estimate missed
    uint8_t distanceSamples;
    uint16_t distanceSpreadMm;
    int32_t scaleRawCounts;
    uint32_t scaleSpreadCounts;
};

// One telemetry reading from a leaf. The gateway turns it into the server's
// JSON log, including the health string built from the failure counters.
struct __attribute__((packed)) DataPacket {
    PacketHeader header;
    uint32_t beaconNonce;         // the cycleNonce of the beacon this answers
    uint8_t flags;                // DataFlags
    uint8_t level;                // 0-100, valid when DATA_SENSOR_OK
    uint8_t battery;              // 0-100
    int16_t distanceMm;           // raw sensor distance, -1 when unavailable
    float latitude;               // valid when DATA_HAS_LOCATION
    float longitude;
    uint8_t sensorFailureCycles;
    uint8_t pmuFailureCycles;
    uint8_t gpsFailureCycles;
    uint16_t lastAwakeSeconds;    // previous cycle, 0 when unknown
    uint8_t meshAwakeWindowSeconds;
    int32_t driftPpm;
    // How long before this send the reading was taken: more than a cycle when
    // the leaf queued it after missing the gateway. An age rather than a time,
    // so it is right even before the leaf has learned the time.
    uint32_t ageSeconds;
    int32_t weightGrams;          // valid when scaleState is SCALE_STATE_OK
    uint8_t scaleState;           // ScaleState
    // The leaf's result for the last command it ran; it rides on one reading
    // (the one taken right after running it) until a gateway stores that.
    uint8_t resultId[INSTRUCTION_ID_LENGTH];
    uint8_t resultStatus;         // ResultStatus
    uint8_t resultCode;           // ResultCode
    int32_t resultValue;          // the depth in mm, or the grams read
    uint32_t resultExtra;         // the grams placed, for a scale calibration
    LeafDiagnostics diagnostics;
};

// Sent back hop by hop along the path the DATA came from.
struct __attribute__((packed)) AckPacket {
    PacketHeader header;
    uint8_t ackedOrigin[MAC_LENGTH];
    uint32_t ackedMessageId;
    uint8_t status;               // AckStatus
    // A command for the leaf, when its gateway holds one; the leaf runs it once
    // (it remembers the id) and returns the result in its next reading.
    uint8_t instructionId[INSTRUCTION_ID_LENGTH];
    uint8_t instructionType;      // InstructionType; none = no command
    uint32_t instructionValue;    // calibrate_scale: the known grams
};

constexpr size_t ORG_ID_LENGTH = 12;          // a MongoDB ObjectId
constexpr size_t JOIN_CODE_ID_LENGTH = 4;
constexpr size_t JOIN_NONCE_LENGTH = 8;
constexpr size_t JOIN_PROOF_LENGTH = 16;
constexpr size_t JOIN_IV_LENGTH = 12;
constexpr size_t JOIN_SEALED_LENGTH = 65;     // key ID, leaf key, beacon key
constexpr size_t JOIN_TAG_LENGTH = 16;

// A leaf without keys asks to join (header.origin is its MAC). It proves it
// holds the one-time join code without sending it; any gateway of the
// organization passes it to the server.
struct __attribute__((packed)) JoinPacket {
    PacketHeader header;
    uint8_t orgId[ORG_ID_LENGTH];
    uint8_t codeId[JOIN_CODE_ID_LENGTH];
    uint8_t nonce[JOIN_NONCE_LENGTH];     // random; the reply is bound to it
    uint8_t proof[JOIN_PROOF_LENGTH];
};

enum JoinStatus : uint8_t {
    JOIN_ACCEPTED = 1,
    JOIN_REFUSED = 2,                     // the server did not accept it; the rest is zero
};

// The server's answer, passed on by the gateway that relayed the JOIN: the leaf's
// keys sealed under a key made from the join code.
struct __attribute__((packed)) JoinReplyPacket {
    PacketHeader header;
    uint8_t leafMac[MAC_LENGTH];
    uint8_t nonce[JOIN_NONCE_LENGTH];
    uint8_t status;                       // JoinStatus
    uint8_t iv[JOIN_IV_LENGTH];
    uint8_t sealed[JOIN_SEALED_LENGTH];
    uint8_t tag[JOIN_TAG_LENGTH];
};

static_assert(sizeof(PacketHeader) == 21, "PacketHeader layout changed");
static_assert(sizeof(JoinPacket) <= MAX_FRAME_SIZE, "JoinPacket too large");
static_assert(sizeof(JoinReplyPacket) <= MAX_FRAME_SIZE, "JoinReplyPacket too large");
static_assert(sizeof(BeaconPacket) + TAG_LENGTH <= MAX_FRAME_SIZE, "BeaconPacket too large");
static_assert(sizeof(DataPacket) + TAG_LENGTH <= MAX_FRAME_SIZE, "DataPacket too large");
static_assert(sizeof(AckPacket) + TAG_LENGTH <= MAX_FRAME_SIZE, "AckPacket too large");

}  // namespace sbinmesh
