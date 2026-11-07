import dotenv from 'dotenv';
dotenv.config();

import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import cookieParser from "cookie-parser";


import { userRouter } from './routers/userRouter.js'
import { binRouter } from './routers/binRouter.js'
import { authRouter } from './routers/authRouter.js'
import { logRouter } from './routers/logRouter.js'
import { overViewRouter } from './routers/overViewRouter.js';
import { templateRouter } from './routers/templateRouter.js';
import { organizationRouter } from './routers/organizationRouter.js';
import { routeRouter } from './routers/routeRouter.js';
import { deviceRouter } from './routers/deviceRouter.js';
import { setEmailServiceCredentials } from './utils/mailService.js';
import { initMqtt } from './mqtt/mqttClient.js';
import { syncDeviceAccounts } from './mqtt/brokerAccounts.js';
import { IS_DEV_MACHINE as isDevMachine, LOCAL_CLIENT_ORIGIN } from './utils/constants.js';
import { apiLimiter } from './middlewares/rateLimiters.js';

const { SERVER_PORT, DB_URL, CLIENT_BASE_URL, CLIENT_BASE_URL_PROD, CLIENT_BASE_URL_3 } = process.env

const app = express();
app.use(
    cors({
        origin: [
            CLIENT_BASE_URL,
            CLIENT_BASE_URL_PROD,
            CLIENT_BASE_URL_3,
            isDevMachine && LOCAL_CLIENT_ORIGIN
        ],
        methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
        credentials: true,
    })
);
app.use(express.json());
app.use(cookieParser());
// One proxy hop (nginx). Required for req.ip to be the real client address,
// which the rate limiters key on. `false` made every request look like it came
// from the nginx container.
app.set("trust proxy", 1);
app.use("/api", apiLimiter);
// What the browser blocked, or would have blocked, under the sites'
// Content-Security-Policy (client/nginx.conf), into the log.
app.post("/api/csp-report", express.json({ type: ["application/csp-report", "application/reports+json", "application/json"], limit: "16kb" }), (req, res) => {
    for (const entry of [].concat(req.body ?? [])) {
        const report = entry?.["csp-report"] ?? entry?.body ?? entry;
        console.warn("[csp]", report?.["violated-directive"] ?? report?.effectiveDirective,
            report?.["blocked-uri"] ?? report?.blockedURL, "on", report?.["document-uri"] ?? report?.documentURL);
    }
    res.sendStatus(204);
});
// In production a 500 says only that something failed: the message a handler
// put in it (often the database's own error) goes to the log instead.
if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
        const json = res.json.bind(res);
        res.json = (body) => {
            if (res.statusCode !== 500) return json(body);
            console.error(`[500] ${req.method} ${req.originalUrl}:`, body?.message ?? body);
            return json({ message: 'Internal server error' });
        };
        next();
    });
}
app.use("/api/bins", binRouter);
app.use("/api/logs", logRouter);
app.use("/api/users", userRouter);
app.use("/api/organizations", organizationRouter);
app.use("/api/routes", routeRouter);
app.use("/api/devices", deviceRouter);
app.use("/api/auth", authRouter);
app.use("/api/templates", templateRouter)
app.use("/api/overviews", overViewRouter);

// Unknown route -> JSON, not Express's default HTML page.
app.use((req, res) => {
    res.status(404).json({ message: `Not found: ${req.method} ${req.originalUrl}` });
});

// Terminal error handler. Express 5 forwards rejected async handlers here, so
// this is what stops an unhandled throw from returning an HTML stack trace.
// The 4-argument signature is required for Express to treat it as an error
// handler, so `next` must stay even though it is only used for the
// headers-already-sent case.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);

    const status = err?.status || err?.statusCode || 500;
    console.error(`[error] ${req.method} ${req.originalUrl}:`, err);

    res.status(status).json({
        message: status >= 500
            ? 'Internal server error'
            : (err?.message || 'Request failed'),
    });
});

const main = async () => {
    try {
        await mongoose.connect(`${DB_URL}`);
        if (isDevMachine) {
            console.log(`Developer machine (${process.env.SBIN_DEV_MACHINE}): MQTT, scheduled jobs and real emails are left to the deployed server.`);
        } else {
            initMqtt({ onConnect: syncDeviceAccounts });
            setEmailServiceCredentials()
            await import("./db/cron/cleanupOTP.js");
            await import("./db/cron/cleanupActivationToken.js");
            await import("./db/cron/cleanupDeviceInstructions.js");
            await import("./db/cron/dailyReport.js");
            await import("./db/cron/routePlanning.js");
            await import("./db/cron/orgStats.js");
            await import("./db/cron/brokerAccounts.js");
        }
        app.listen(SERVER_PORT, () => {
            console.log(mongoose.connection.readyState === 1 && `Connected to DB..`);
            console.log(`Listening on port ${SERVER_PORT}`);
        });
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
};
main();
