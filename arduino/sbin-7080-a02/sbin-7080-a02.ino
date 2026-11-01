#include "globals.h"

void setup() {
    Serial.begin(115200);
    const bool pmuReady = initializePowerManagement();
    // Only on USB power: a board on battery has no monitor to wait for. Also
    // after a power-on, whose first lines (why the PMU cut power) matter most.
    if (pmuReady && PMU.isVbusIn()) {
        const uint32_t waitStartedAt = millis();
        while (!Serial && millis() - waitStartedAt < USB_LOG_RECONNECT_WAIT_MS) {
            delay(10);
        }
    }

    Serial.println("\n=================================");
    Serial.println("  S-Bin SIM7080 A02 Firmware     ");
    Serial.println("=================================");
    Serial.printf("USB Serial monitor: %s\n", Serial ? "connected" : "not connected");
    Serial.println(pmuReady ? "✅ AXP2101 PMU Ready." : "❌ AXP2101 PMU initialization failed.");
    if (pmuReady) {
        readPmuPowerSources();
        Serial.println(pmuPowerSources);
    }

    initializeSensor();
    initializeScale();
    DeviceMac = getChipMac();
    loadDeviceSettings();

    if (ownerId.length() == 0) {
        while (!startConfigurationPortal()) {
            Serial.println("Retrying configuration access point in 5 seconds.");
            delay(5000);
        }
        return;
    }

    // Without a SIM this device is a mesh leaf, whose whole wake is the leaf cycle.
    decideDeviceRole();
    if (deviceRole == ROLE_LEAF) {
        runAsLeaf();
    }

    uint32_t stageStartedAt = millis();
    const bool modemReady = initializeModem();
    stageTimes.modemMs = millis() - stageStartedAt;
    if (!modemReady) {
        // It cannot report itself. Without a SIM card this wake is a leaf's,
        // through another gateway (the leaf cycle finds the other gateway's slot
        // by itself). With one, the modem is failing: a single bounded try
        // through another gateway, then back to sleep for the next slot; the
        // leaf cycle would listen for hours on a gateway that has no schedule of
        // a gateway to follow (2026-11-01: it listened from 04:51 for 13.5 h).
        const bool simAbsent = probeSimCard() == SIM_ABSENT;
        powerOffModem();
        recordReportOutcome(false);
        if (simAbsent) {
            reportAsLeafUntilNextWake(sbinmesh::DATA_SIM_MISSING);
        } else {
            reportThroughAnotherGateway();
            becomeLeafIfAsked();
        }
        enterDeepSleepUntilNextReport();
    }
    // Two cycles in a row without a report: through another gateway first, at
    // the slot (its own window would serve no one if the report fails again),
    // then its own link as usual.
    const bool reportingThroughMesh = reportsFailedTooOften();
    if (reportingThroughMesh) {
        reportThroughAnotherGateway();
        becomeLeafIfAsked();
    }

    // Long enough for a cold cellular attach; the modem is powered off between retries.
    constexpr unsigned long CLOCK_SYNC_TIMEOUT_MS = 120000UL;
    constexpr uint32_t CLOCK_RETRY_SLEEP_SECONDS = 300;
    // On the network but without its time (the modem lost power and the network
    // has not sent the time yet), the report still goes out: the server's reply
    // sets the clock.
    stageStartedAt = millis();
    const bool clockReady = synchronizeClockFromNetwork(CLOCK_SYNC_TIMEOUT_MS);
    stageTimes.networkMs = millis() - stageStartedAt;
    if (!clockReady && !modem.isNetworkConnected()) {
        recordReportOutcome(false);
        enterDeepSleepForSetupRetry(CLOCK_RETRY_SLEEP_SECONDS, "No valid network time");
    }

    // The slot sleep ended a few minutes early on purpose; wait for the slot
    // itself, so the window opens on it rather than wherever the drifting
    // sleep clock woke this gateway.
    stageStartedAt = millis();
    waitForSlotStart();
    stageTimes.slotWaitMs = millis() - stageStartedAt;

    // Open the mesh window only now: leaves set their clocks from the beacons,
    // and after a deep sleep this gateway's clock is off by about the whole
    // sleep-clock drift until it is corrected from the network. The report
    // runs in parallel with the window.
    if (!reportingThroughMesh) {
        beginMeshWindow();
    }

    // A failed calibration does not block reporting: the cycle reports
    // sensorOk=false with a calibration health message, and the next wake retries.
    constexpr uint8_t CALIBRATION_ATTEMPTS = 2;
    const bool depthWasMissing = binDepthMm <= 0;
    for (uint8_t attempt = 1; binDepthMm <= 0 && attempt <= CALIBRATION_ATTEMPTS; attempt++) {
        if (!calibrateBinDepth()) {
            Serial.printf("⚠️ Calibration attempt %u of %u failed.\n", attempt, CALIBRATION_ATTEMPTS);
        }
    }
    // The empty bin is also the scale's zero, as with calibrate_empty_bin; a
    // bin without a scale does not answer and stays uncalibrated. The scale
    // factor needs a known weight, so it is set later with calibrate_scale.
    if (depthWasMissing && binDepthMm > 0) {
        zeroScale();
    }

    acceptSetupLocation();
    gpsAttemptDue = shouldRefreshGpsLocation();
    if (gpsAttemptDue) {
        Serial.println("🛰️ Monthly GPS refresh is due.");
        recordGpsAttempt();
        if (startGpsAcquisition()) {
            gpsAcquisitionStartedAt = millis();
        } else {
            Serial.println("❌ Could not start monthly GPS refresh.");
        }
    } else {
        Serial.println("📍 Using the saved location; GPS refresh is not due.");
    }

    setupMqtt();
}

void loop() {
    if (configurationPortalActive) {
        handleConfigurationPortal();
        return;
    }

    if (gpsModeActive) {
        bool fixAcquired = updateGpsLocation();
        if (fixAcquired || millis() - gpsAcquisitionStartedAt >= 300000UL) {
            stageTimes.gpsMs = millis() - gpsAcquisitionStartedAt;
        }
        if (fixAcquired) {
            Serial.printf("✅ GPS fix saved: %.6f, %.6f\n", latitude, longitude);
            if (!stopGpsAcquisition()) {
                Serial.println("❌ Could not disable GNSS; cellular data remains off.");
            }
        } else if (millis() - gpsAcquisitionStartedAt >= 300000UL) {
            Serial.println("⚠️ GPS refresh timed out after 5 minutes.");
            if (!stopGpsAcquisition()) {
                Serial.println("❌ Could not disable GNSS after timeout.");
            }
        } else {
            Serial.println("⏳ Waiting for the monthly GPS fix.");
            delay(5000);
            return;
        }

    }

    const DeviceReading reading = takeReading(gpsAttemptDue, !gpsAttemptDue || gpsFixUpdatedThisCycle, true);
    Serial.printf(
        "Health: %s; battery: %u mV (%d%%), distance: %d mm\n",
        reading.health.c_str(),
        reading.batteryMillivolts,
        reading.batteryPercent,
        reading.distanceMm
    );
    if (hasGpsFix) {
        Serial.printf("GPS: %.6f, %.6f\n", latitude, longitude);
    } else {
        Serial.println("⚠️ No saved GPS location is available yet.");
    }

    constexpr unsigned long MAX_REPORT_WINDOW_MS = 120000UL;
    unsigned long reportStartedAt = millis();
    bool cellularReady = false;
    while (millis() - reportStartedAt < MAX_REPORT_WINDOW_MS) {
        if (maintainCellularConnection()) {
            cellularReady = true;
            break;
        }
        delay(1000);
    }

    if (cellularReady) {
        readServingCell();
        // The roots the broker's and the registration's TLS are checked against.
        loadModemCaCertificate();
    }
    // A new device registers over HTTPS first: the broker takes it only with
    // the device key it gets back. A wrong organization or code reopens the
    // setup page; anything else is tried again next cycle.
    if (cellularReady && hasGpsFix && deviceKey.length() == 0) {
        if (registerOverHttps(reading.batteryPercent) == REGISTRATION_REFUSED) {
            reopenSetupPortal();
        }
    }
    bool mqttReady = false;
    if (cellularReady && deviceKey.length() > 0) {
        while (millis() - reportStartedAt < MAX_REPORT_WINDOW_MS) {
            maintainMqttConnection();
            mqttClient.loop();
            if (mqttClient.connected()) {
                mqttReady = true;
                stageTimes.mqttMs = millis() - reportStartedAt;
                break;
            }
            delay(250);
        }
    }

    bool reportSent = false;
    if (mqttReady && hasGpsFix) {
        const uint32_t previousAckCount = scheduleAckCounter;
        reportSent = publishTelemetry(reading);
        if (reportSent) {
            waitForMqttReply(scheduleAckCounter, previousAckCount, 15000UL);
        }
    } else if (!hasGpsFix) {
        Serial.println("❌ Cannot register/report until the first GPS location is acquired.");
    }

    Serial.println(reportSent ? "✅ Reporting cycle completed." : "⚠️ Reporting cycle ended without a telemetry report.");
    recordReportOutcome(reportSent);
    // Again mid-cycle: the boot and pre-sleep lines often miss a monitor.
    if (pmuPowerSources.length() > 0) {
        Serial.println(pmuPowerSources);
    }
    // The window is still open, and a leaf that reported at its start was ACKed
    // before the server could be asked: its commands go out now, in a second ACK.
    if (mqttReady && meshWindowStartedThisCycle()) {
        refreshLeafCommands();
        // A leaf asking to join waits for the answer, so before the readings go up.
        uploadJoinRequests();
    }
    if (mqttReady) {
        uploadRelayedReadings();
    }
    constexpr unsigned long INSTRUCTION_CHECK_TIMEOUT_MS = 5000UL;
    if (deviceKey.length() > 0) {
        processPendingInstructions(INSTRUCTION_CHECK_TIMEOUT_MS);
    }
    restartIfMeshKeyIsNew(meshWindowStartedThisCycle());
    endMeshWindow();
    // A command a leaf ran in this window is finished on the server now: the
    // held list must not hand it over again, or hold a newer one behind it.
    if (mqttReady && leafResultsUploaded()) {
        refreshLeafCommands();
    }
    becomeLeafIfAsked();
    enterDeepSleepUntilNextReport();
}
