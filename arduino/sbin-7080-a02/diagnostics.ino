#include "globals.h"

// What a report says about the device itself (its "diagnostics" object): the
// firmware, why it restarted and woke, power and temperatures, how far its
// samples spread, how long each stage took, the serving cell and the bytes
// sent. Every field is optional; the server checks each on its own and drops
// a bad one, never the report.

namespace {
// The serving cell, as AT+CPSI? gave it this cycle; valid once read.
struct ServingCell {
    bool valid = false;
    bool lte = false;  // the detailed fields below come only on LTE
    String system;     // e.g. "LTE CAT-M1"
    String op;         // MCC-MNC, e.g. "425-01"
    String band;       // e.g. "EUTRAN-BAND3"
    uint32_t cellId = 0;
    uint32_t tac = 0;
    int rsrq = 0;
    int rsrp = 0;
    int rssi = 0;
    int sinr = 0;
} servingCell;

const char* wakeCauseText() {
    switch (esp_sleep_get_wakeup_cause()) {
        case ESP_SLEEP_WAKEUP_UNDEFINED: return "undefined";
        case ESP_SLEEP_WAKEUP_TIMER: return "timer";
        case ESP_SLEEP_WAKEUP_EXT0: return "ext0";
        case ESP_SLEEP_WAKEUP_EXT1: return "ext1";
        case ESP_SLEEP_WAKEUP_TOUCHPAD: return "touchpad";
        case ESP_SLEEP_WAKEUP_ULP: return "ulp";
        case ESP_SLEEP_WAKEUP_GPIO: return "gpio";
        case ESP_SLEEP_WAKEUP_UART: return "uart";
        default: return "other";
    }
}

const char* chargerText() {
    if (!PMU.isBatteryConnect()) {
        return "none";
    }
    switch (PMU.getChargerStatus()) {
        case XPOWERS_AXP2101_CHG_TRI_STATE: return "trickle";
        case XPOWERS_AXP2101_CHG_PRE_STATE: return "precharge";
        case XPOWERS_AXP2101_CHG_CC_STATE: return "constant_current";
        case XPOWERS_AXP2101_CHG_CV_STATE: return "constant_voltage";
        case XPOWERS_AXP2101_CHG_DONE_STATE: return "done";
        default: return "stopped";
    }
}

// The comma-separated fields of a line, at most `max`.
uint8_t splitFields(const String& line, String* fields, uint8_t max) {
    uint8_t count = 0;
    int start = 0;
    while (count < max) {
        const int comma = line.indexOf(',', start);
        fields[count++] = comma < 0 ? line.substring(start) : line.substring(start, comma);
        if (comma < 0) {
            break;
        }
        start = comma + 1;
    }
    for (uint8_t i = 0; i < count; i++) {
        fields[i].trim();
    }
    return count;
}
}

// Counts what goes out, for the next cycle's bytesSentLastCycle.
bool mqttPublish(const char* topic, const char* payload, bool retained) {
    const bool published = mqttClient.publish(topic, payload, retained);
    if (published) {
        bytesSentThisCycle += strlen(topic) + strlen(payload);
    }
    return published;
}

// Reads the serving cell (AT+CPSI?) once the modem is on the network. On LTE:
// "LTE CAT-M1,Online,425-01,0x0B4D,27447297,201,EUTRAN-BAND3,1300,5,5,-12,-102,-72,13"
// (system, status, MCC-MNC, TAC, cell ID, physical cell, band, EARFCN, DL and
// UL bandwidth, RSRQ, RSRP, RSSI, SINR); other systems give fewer fields.
void readServingCell() {
    servingCell = ServingCell();
    modem.sendAT("+CPSI?");
    if (modem.waitResponse(2000, "+CPSI: ") != 1) {
        Serial.println("⚠️ No serving cell from AT+CPSI?.");
        return;
    }
    const String line = modem.stream.readStringUntil('\n');
    modem.waitResponse();

    String fields[14];
    const uint8_t count = splitFields(line, fields, 14);
    if (count < 3 || fields[1] != "Online") {
        return;
    }
    servingCell.valid = true;
    servingCell.system = fields[0];
    servingCell.op = fields[2];
    servingCell.lte = fields[0].startsWith("LTE") && count >= 14;
    if (servingCell.lte) {
        servingCell.tac = strtoul(fields[3].c_str(), nullptr, 16);
        servingCell.cellId = strtoul(fields[4].c_str(), nullptr, 10);
        servingCell.band = fields[6];
        servingCell.rsrq = fields[10].toInt();
        servingCell.rsrp = fields[11].toInt();
        servingCell.rssi = fields[12].toInt();
        servingCell.sinr = fields[13].toInt();
    }
    Serial.printf("📶 Serving cell: %s\n", line.c_str());
}

void addDiagnostics(JsonObject diagnostics, const DeviceReading& reading) {
    diagnostics["firmwareVersion"] = FIRMWARE_VERSION;
    diagnostics["resetReason"] = sbinmesh::resetReasonName(esp_reset_reason());
    diagnostics["wakeCause"] = wakeCauseText();
    diagnostics["chipTempC"] = roundf(temperatureRead() * 10) / 10;
    if (pmuAvailable) {
        if (pmuPowerWasLost) {
            diagnostics["pmuOffSource"] = pmuOffSource;
            diagnostics["pmuOnSource"] = pmuOnSource;
        }
        diagnostics["pmuTempC"] = roundf(PMU.getTemperature() * 10) / 10;
        diagnostics["batteryMv"] = reading.batteryMillivolts;
        diagnostics["systemMv"] = PMU.getSystemVoltage();
        diagnostics["vbusMv"] = PMU.isVbusIn() ? PMU.getVbusVoltage() : 0;
        diagnostics["charger"] = chargerText();
    }
    diagnostics["distanceSamples"] = reading.distanceSamples;
    if (reading.distanceSamples > 1) {
        diagnostics["distanceSpreadMm"] = reading.distanceSpreadMm;
    }
    if (lastScaleSampled) {
        diagnostics["scaleRawCounts"] = lastScaleRawCounts;
        diagnostics["scaleSpreadCounts"] = lastScaleSpreadCounts;
        if (scaleZeroSet) {
            diagnostics["scaleZeroCounts"] = scaleZero;
        }
    }
    JsonObject stages = diagnostics["stages"].to<JsonObject>();
    const struct { const char* name; uint32_t ms; } stageList[] = {
        {"modemMs", stageTimes.modemMs}, {"networkMs", stageTimes.networkMs},
        {"slotWaitMs", stageTimes.slotWaitMs}, {"mqttMs", stageTimes.mqttMs}, {"gpsMs", stageTimes.gpsMs},
    };
    for (const auto& stage : stageList) {
        if (stage.ms > 0) {
            stages[stage.name] = stage.ms;
        }
    }
    if (servingCell.valid) {
        JsonObject network = diagnostics["network"].to<JsonObject>();
        network["system"] = servingCell.system;
        network["operator"] = servingCell.op;
        if (servingCell.lte) {
            network["band"] = servingCell.band;
            network["cellId"] = servingCell.cellId;
            network["tac"] = servingCell.tac;
            network["rsrq"] = servingCell.rsrq;
            network["rsrp"] = servingCell.rsrp;
            network["rssi"] = servingCell.rssi;
            network["sinr"] = servingCell.sinr;
        }
    }
    if (bytesSentLastCycle > 0) {
        diagnostics["bytesSentLastCycle"] = bytesSentLastCycle;
    }
}

// A relayed leaf's diagnostics (protocol v4), as the server's object.
void addLeafDiagnostics(JsonObject diagnostics, const sbinmesh::LeafDiagnostics& leaf) {
    char version[12];
    snprintf(version, sizeof(version), "%u.%u.%u", leaf.firmwareVersion[0], leaf.firmwareVersion[1], leaf.firmwareVersion[2]);
    diagnostics["firmwareVersion"] = version;
    diagnostics["resetReason"] = sbinmesh::resetReasonName(leaf.resetReason);
    if (leaf.flags & sbinmesh::DIAG_HAS_BATTERY_MV) {
        diagnostics["batteryMv"] = leaf.batteryMv;
    }
    if (leaf.flags & sbinmesh::DIAG_HAS_CHIP_TEMP) {
        diagnostics["chipTempC"] = leaf.chipTempC;
    }
    if (leaf.beaconRssi < 0) {
        diagnostics["beaconRssi"] = leaf.beaconRssi;
    }
    diagnostics["guardSeconds"] = leaf.guardSeconds;
    diagnostics["missedCycles"] = leaf.missedCycles;
    diagnostics["residualPpm"] = leaf.residualPpm;
    if (leaf.flags & sbinmesh::DIAG_HAS_DISTANCE_SPREAD) {
        diagnostics["distanceSamples"] = leaf.distanceSamples;
        diagnostics["distanceSpreadMm"] = leaf.distanceSpreadMm;
    }
    if (leaf.flags & sbinmesh::DIAG_HAS_SCALE_SAMPLE) {
        diagnostics["scaleRawCounts"] = leaf.scaleRawCounts;
        diagnostics["scaleSpreadCounts"] = leaf.scaleSpreadCounts;
    }
}
