#include "globals.h"

const char apn[] = "internet";

XPowersPMU PMU;
HardwareSerial SerialModem(1);
HardwareSerial SerialSensor(2);
TinyGsm modem(SerialModem);
// The MQTT socket, with TLS (mux 0; registration uses mux 1).
TinyGsmClientSecure gsmClient(modem, 0);
PubSubClient mqttClient(gsmClient);

Preferences preferences;
DNSServer dnsServer;
WebServer configServer(80);

String DeviceMac = "";
String ownerId = "";
String deviceKey = "";
String registrationCode = "";
// The one-time code a device without a SIM card joins the mesh with (32 hex), or empty.
String joinCode = "";
float latitude = 0;
float longitude = 0;
bool hasGpsFix = false;
bool setupLocationPending = false;
bool gpsModeActive = false;
bool configurationPortalActive = false;
int binDepthMm = 0;
bool lastCalibrationFailed = false;
bool pmuAvailable = false;
RTC_DATA_ATTR uint8_t sensorFailureCycles = 0;
RTC_DATA_ATTR uint8_t pmuFailureCycles = 0;
RTC_DATA_ATTR uint8_t gpsFailureCycles = 0;
RTC_DATA_ATTR uint8_t scaleFailureCycles = 0;
// Scale calibration (see scale.ino), loaded from flash.
int32_t scaleZero = 0;
bool scaleZeroSet = false;
float scaleCountsPerGram = 0.0f;
time_t lastGpsAttemptEpoch = 0;
RTC_DATA_ATTR uint64_t nextWakeEpoch = 0;
// The slot after nextWakeEpoch; a mesh gateway advertises it to leaves in its
// beacon at the next wake. RTC only: after a power loss the next ack restores it.
RTC_DATA_ATTR uint64_t followingWakeEpoch = 0;
// Server report period (followingWakeEpoch - nextWakeEpoch), kept in flash so
// beacons can continue the slot pattern after a reset or a missed reply.
uint32_t slotPeriodSeconds = 0;
// This boot's clock diagnostics, reported with the telemetry.
int32_t clockErrorSeconds = 0;
bool hasClockError = false;
// True once this boot set the clock from network time, or carried over the
// clock the server set (see synchronizeClockFromNetwork()); mesh beacons wait for it.
bool clockSynced = false;
// The clock was last set from the server's reply, with no network time since.
RTC_DATA_ATTR bool clockFromServer = false;
RTC_DATA_ATTR uint32_t scheduledSleepDurationSeconds = 0;
uint32_t meshAwakeWindowSeconds = DEFAULT_MESH_AWAKE_WINDOW_SECONDS;
// Actual awake time of the previous cycle, reported with the next telemetry.
RTC_DATA_ATTR uint32_t lastAwakeSeconds = 0;
// Sleep clock drift estimate; loaded from preferences after a power loss.
RTC_DATA_ATTR int32_t driftPpm = 0;
RTC_DATA_ATTR bool driftMeasured = false;
RTC_DATA_ATTR bool clockDriftLoaded = false;
RTC_DATA_ATTR uint64_t sleepStartedEpoch = 0;
// How much before its slot the last deep sleep was set to end, on purpose (see
// waitForSlotStart()); the wake timing diagnostic is measured against it.
RTC_DATA_ATTR uint32_t sleepLeadSeconds = 0;
RTC_DATA_ATTR uint32_t scheduleAckCounter = 0;
uint32_t instructionCheckCounter = 0;
bool instructionResponseValid = false;
DeviceInstruction pendingInstructions[MAX_PENDING_INSTRUCTIONS];
uint8_t pendingInstructionCount = 0;
uint32_t instructionResultAckCounter = 0;
String waitingInstructionResultId;
time_t lastGpsUpdateEpoch = 0;
unsigned long gpsAcquisitionStartedAt = 0;
bool gpsAttemptDue = false;
bool gpsFixUpdatedThisCycle = false;
StageTimes stageTimes = {};
uint8_t pmuOffSource = 0;
uint8_t pmuOnSource = 0;
bool lastScaleSampled = false;
int32_t lastScaleRawCounts = 0;
int32_t lastScaleSpreadCounts = 0;
// Kept through deep sleep: the previous cycle's total goes out with this one.
RTC_DATA_ATTR uint32_t bytesSentThisCycle = 0;
RTC_DATA_ATTR uint32_t bytesSentLastCycle = 0;
