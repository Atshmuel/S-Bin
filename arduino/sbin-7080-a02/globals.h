#pragma once

#if !defined(ARDUINO_USB_CDC_ON_BOOT) || !ARDUINO_USB_CDC_ON_BOOT
#error "Enable USB CDC On Boot for T-SIM7080G-S3 V1; GPIO43/44 are used by the A02 UART."
#endif

#define XPOWERS_CHIP_AXP2101
#include <XPowersLib.h>

#define TINY_GSM_MODEM_SIM7080
#define TINY_GSM_RX_BUFFER 1024
#include <TinyGsmClient.h>

#include <Arduino.h>
#include <ArduinoJson.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <WebServer.h>
#include <WiFi.h>
#include <time.h>
#include <sys/time.h>
#include <esp_sleep.h>
#include <SbinMesh.h>
#include <SbinMeshLeaf.h>

// LilyGO T-SIM7080G-S3 V1 board pins
#define BOARD_MODEM_PWR_PIN 41
#define BOARD_MODEM_DTR_PIN 42
#define BOARD_MODEM_RXD_PIN 4
#define BOARD_MODEM_TXD_PIN 5

// AXP2101 PMU I2C pins on T-SIM7080G-S3 V1
#define PMU_I2C_SDA_PIN 15
#define PMU_I2C_SCL_PIN 7

// SIM7080 modem GPIO used to power the GNSS antenna
#define MODEM_GPS_ENABLE_GPIO 5
#define MODEM_GPS_ENABLE_LEVEL 1

// A02 sensor pins
#define SENSOR_RXD_PIN 44
#define SENSOR_TXD_PIN 43

// HX711 load-cell amplifier pins (powered from DC1)
#define SCALE_DOUT_PIN 2
#define SCALE_SCK_PIN 3

// The board deep-sleeps even with USB attached, so the USB port disappears
// between wakes (uploading to a sleeping board needs BOOT held while pressing
// RST). On USB power every boot waits this long for a Serial Monitor to
// (re)connect, so the first lines are not lost.
constexpr uint32_t USB_LOG_RECONNECT_WAIT_MS = 3000;

// This firmware's version, reported in every diagnostics block (semver; bump
// it by hand for every flash).
constexpr char FIRMWARE_VERSION[] = "2.4.0";
// The same as numbers, for a leaf's diagnostics (keep the two in step).
constexpr uint8_t FIRMWARE_VERSION_NUMBERS[3] = {2, 4, 0};

// The S-Bin servers (2i): registration over HTTPS, reports over MQTT with TLS
// on the private broker, both checked against SBIN_CA_FILE in the modem.
constexpr char SBIN_SERVER_HOST[] = "s-bins.duckdns.org";
constexpr char SBIN_CA_FILE[] = "sbinca.pem";

// What this device is (role.ino): decided once, from the SIM card, at its
// first setup and kept in flash. A leaf without a SIM reports through a
// gateway's mesh window; a leaf that finds a SIM after a restart becomes a
// gateway, but a gateway never turns into a leaf by itself.
enum DeviceRole : uint8_t {
    ROLE_UNKNOWN = 0,
    ROLE_GATEWAY = 1,
    ROLE_LEAF = 2,
};

enum SimCardState {
    SIM_PRESENT,
    SIM_ABSENT,
    SIM_UNKNOWN,  // the modem did not answer, or not clearly
};

enum RegistrationOutcome {
    REGISTRATION_DONE,
    REGISTRATION_REFUSED,  // wrong organization or code: the setup page opens again
    REGISTRATION_RETRY,
};

constexpr uint8_t MAX_PENDING_INSTRUCTIONS = 2;
constexpr uint32_t MAX_AWAKE_EXTENSION_SECONDS = 3600;
// How long the mesh window stays open each cycle for leaves to send their
// readings. The server sets it per organization in every schedule acknowledgement.
constexpr uint32_t DEFAULT_MESH_AWAKE_WINDOW_SECONDS = 10;
constexpr uint32_t MAX_MESH_AWAKE_WINDOW_SECONDS = 60;

struct DeviceInstruction {
    String id;
    String type;
    uint32_t durationSeconds = 0;
    uint32_t grams = 0;  // calibrate_scale: the known weight placed in the bin
};

enum ScaleResult {
    SCALE_OK,
    SCALE_NOT_RESPONDING,
    SCALE_UNSTABLE,
    SCALE_NOT_ZEROED,
    SCALE_NO_LOAD_CHANGE,
    SCALE_INVALID_WEIGHT,
};

extern const char apn[];

extern XPowersPMU PMU;
extern HardwareSerial SerialModem;
extern HardwareSerial SerialSensor;
extern TinyGsm modem;
extern PubSubClient mqttClient;
extern Preferences preferences;
extern DNSServer dnsServer;
extern WebServer configServer;

extern String DeviceMac;
extern String ownerId;
extern String deviceKey;
extern String registrationCode;
extern String joinCode;
extern float latitude;
extern float longitude;
extern bool hasGpsFix;
// A location from the setup page that GPS has not been scheduled around yet.
extern bool setupLocationPending;
extern bool lastCalibrationFailed;
extern bool gpsModeActive;
extern bool configurationPortalActive;
extern int binDepthMm;
extern bool pmuAvailable;
extern uint8_t sensorFailureCycles;
extern uint8_t pmuFailureCycles;
extern uint8_t gpsFailureCycles;
extern uint8_t scaleFailureCycles;
extern int32_t scaleZero;
extern bool scaleZeroSet;
extern float scaleCountsPerGram;
extern time_t lastGpsAttemptEpoch;
extern time_t lastGpsUpdateEpoch;
extern uint64_t nextWakeEpoch;
extern uint64_t followingWakeEpoch;
extern bool clockSynced;
extern bool clockFromServer;
extern uint32_t slotPeriodSeconds;
extern int32_t clockErrorSeconds;
extern bool hasClockError;
extern uint32_t scheduledSleepDurationSeconds;
extern uint32_t meshAwakeWindowSeconds;
extern uint32_t lastAwakeSeconds;
extern int32_t driftPpm;
extern bool driftMeasured;
extern bool clockDriftLoaded;
extern uint64_t sleepStartedEpoch;
extern uint32_t sleepLeadSeconds;
extern uint32_t scheduleAckCounter;
extern uint32_t instructionCheckCounter;
extern bool instructionResponseValid;
extern DeviceInstruction pendingInstructions[MAX_PENDING_INSTRUCTIONS];
extern uint8_t pendingInstructionCount;
extern uint32_t instructionResultAckCounter;
extern String waitingInstructionResultId;
extern unsigned long gpsAcquisitionStartedAt;
extern bool gpsAttemptDue;
extern bool gpsFixUpdatedThisCycle;

// One reading of the bin's sensor, battery and health, as a report sends it.
// The distance is the median of a few A02 samples; how many answered and how
// far apart they were go into the diagnostics.
struct DeviceReading {
    int distanceMm;
    uint8_t distanceSamples;
    int distanceSpreadMm;
    uint16_t batteryMillivolts;
    int batteryPercent;
    int32_t weightGrams;     // 0 unless scaleState is "ok"
    const char* scaleState;  // "ok", "uncalibrated" or "failed"
    String health;
};

// How long this cycle's stages took up to the report, in ms (0: did not run).
struct StageTimes {
    uint32_t modemMs;
    uint32_t networkMs;
    uint32_t slotWaitMs;
    uint32_t mqttMs;
    uint32_t gpsMs;
};
extern StageTimes stageTimes;
// The AXP2101's power-off and power-on source registers, read at boot.
extern uint8_t pmuOffSource;
extern uint8_t pmuOnSource;
// The last HX711 read's median raw counts and spread (see readScaleRaw()).
extern bool lastScaleSampled;
extern int32_t lastScaleRawCounts;
extern int32_t lastScaleSpreadCounts;
// MQTT payload bytes published this cycle and in the previous one.
extern uint32_t bytesSentThisCycle;
extern uint32_t bytesSentLastCycle;

bool mqttPublish(const char* topic, const char* payload, bool retained = false);
void readServingCell();
void addDiagnostics(JsonObject diagnostics, const DeviceReading& reading);
void addLeafDiagnostics(JsonObject diagnostics, const sbinmesh::LeafDiagnostics& leaf);

bool initializePowerManagement();
void readPmuPowerSources();
String pmuRailsText();
extern String pmuPowerSources;
DeviceReading takeReading(bool gpsTested, bool gpsOk, bool sensorTrusted);
uint16_t readBatteryMillivolts();
int readBatteryPercent();
String updateDeviceHealth(bool sensorOk, bool pmuOk, bool gpsTested, bool gpsOk, bool scaleTested, bool scaleOk);
void addOwnFaults(JsonArray faults, int distanceMm);
String healthFromFailureCounts(uint8_t sensorFailures, uint8_t pmuFailures, uint8_t gpsFailures);
void addFaults(
    JsonArray faults,
    uint8_t sensorFailures,
    uint8_t pmuFailures,
    uint8_t gpsFailures,
    bool calibrationFailed,
    int distanceMm
);

// A reading this gateway took custody of from a mesh leaf, kept in RTC memory
// until the server confirms it.
struct RelayRecord {
    sbinmesh::DataPacket data;
    uint8_t hops;   // radio hops the reading travelled to reach this gateway
    int8_t rssi;    // dBm of the last hop
    uint32_t measuredAtEpoch;  // UTC when the leaf took the reading, 0 when unknown
};

// A server command for a mesh leaf, kept in RTC memory until the ACK to the
// leaf's next reading hands it over.
struct LeafInstruction {
    uint8_t leafMac[sbinmesh::MAC_LENGTH];
    uint8_t id[sbinmesh::INSTRUCTION_ID_LENGTH];
    uint8_t type;      // sbinmesh::InstructionType
    uint32_t value;    // calibrate_scale: the known grams
};
constexpr uint8_t MAX_LEAF_INSTRUCTIONS = 4;

// A leaf without keys that asked to join in this window, and the server's
// answer to hand back (RAM: a JOIN is answered in the window it came in).
constexpr uint8_t MAX_JOIN_REQUESTS = 4;

enum RelayUploadResult {
    RELAY_ACCEPTED,
    RELAY_REJECTED,
    RELAY_NO_REPLY,
};

void beginMeshWindow();
void endMeshWindow();
void uploadRelayedReadings();
bool leafResultsUploaded();
void setLeafInstructions(const LeafInstruction* instructions, uint8_t count);
RelayUploadResult publishRelayRecord(const RelayRecord& record, unsigned long timeoutMs);
void uploadJoinRequests();
RelayUploadResult publishJoinRequest(const sbinmesh::JoinPacket& join, sbinmesh::JoinReplyPacket& reply,
                                     unsigned long timeoutMs);
bool synchronizeClockFromNetwork(unsigned long timeoutMs);
void correctClockFromServer(time_t serverEpoch);
bool isSystemClockValid();
uint64_t applyDriftCorrection(uint64_t sleepSeconds);
void markSleepStart();
void recordClockDrift(time_t deviceEpoch, time_t referenceEpoch);
void recordWakeTiming(time_t deviceEpoch, time_t networkEpoch);
bool shouldRefreshGpsLocation();
void recordGpsAttempt();
void saveLastKnownLocation();
void waitForSlotStart();
void enterDeepSleepUntilNextReport();
void enterDeepSleepForSetupRetry(uint32_t sleepSeconds, const char* reason);
void cutModemPower();
void restoreModemPower();
void initializeSensor();
bool initializeModem();
bool powerOnModem(bool& alreadyOn);
SimCardState probeSimCard();
void powerOffModem();
extern DeviceRole deviceRole;
void decideDeviceRole();
extern bool becomeLeafAfterThisCycle;
void becomeLeafIfAsked();
[[noreturn]] void runAsLeaf();
sbinmesh::LeafConfig makeLeafConfig(const sbinmesh::LeafKeys& keys);
[[noreturn]] void runLeafCycleWith(const sbinmesh::LeafConfig& config);
extern uint8_t leafFallbackFlags;
// Reporting through another gateway (fallback.ino).
bool ownLeafKeys(sbinmesh::LeafKeys& keys);
bool reportsFailedTooOften();
void recordReportOutcome(bool reportSent);
void reportAsLeafUntilNextWake(uint8_t reasonFlag);
bool reportThroughAnotherGateway();
int getDistanceMm();
bool maintainCellularConnection();
bool startConfigurationPortal();
void handleConfigurationPortal();
void loadDeviceSettings();
void saveSetup(const String& orgId, const String& code);
bool normalizeJoinCode(String& code);
void saveJoinCode(const String& code);
void forgetJoinCode();

// The organization's mesh key (meshkeys.ino).
void loadMeshKeys();
uint8_t meshKeyGeneration();
void applyMeshKeys(sbinmesh::MeshAuth& auth);
void storeMeshKeyFromServer(const char* keyHex, int keyId);
void restartIfMeshKeyIsNew(bool meshWindowRan);
void clearMeshKeyRestartFlag();
bool meshWindowStartedThisCycle();
void saveSetupLocation(float lat, float lng);
void acceptSetupLocation();
void saveDeviceKey(const String& key);
void clearDeviceSettings();
String getChipMac();
bool calibrateBinDepth();
void initializeScale();
void powerDownScale();
bool isScaleCalibrated();
ScaleResult readScaleRaw(int32_t& raw);
ScaleResult readWeightGrams(int32_t& grams);
ScaleResult zeroScale();
ScaleResult calibrateScale(uint32_t knownGrams, int32_t& measuredGrams);
const char* scaleResultCode(ScaleResult result);
int calculateFillLevel(int distanceMm);
bool startGpsAcquisition();
bool stopGpsAcquisition();
void setupMqtt();
void maintainMqttConnection();
void mqttCallback(char* topic, byte* payload, unsigned int length);
void serviceMqttFor(unsigned long waitMs);
bool waitForMqttReply(const uint32_t& counter, uint32_t previousValue, unsigned long timeoutMs);
bool loadModemCaCertificate();
RegistrationOutcome registerOverHttps(int batteryPercent);
void checkDeviceAfterRefusedLogin();
void reopenSetupPortal();
bool publishTelemetry(const DeviceReading& reading);
bool requestInstructionCheck(unsigned long timeoutMs);
bool publishInstructionResult(const String& instructionId, const String& status, const String& result);
void processPendingInstructions(unsigned long timeoutMs);
void refreshLeafCommands();
bool updateGpsLocation();
