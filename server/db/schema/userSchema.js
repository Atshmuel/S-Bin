import mongoose from "mongoose";
import { ROLES } from "../../utils/constants.js";

export const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    role: {
        type: String,
        enum: Object.values(ROLES),
        default: ROLES.USER
    },
    passwordHash: { type: String, required: true },
    recoveryCode: {
        type: {
            otp: String,
            expiresAt: Date,
            resetToken: String,
            tokenExpiresAt: Date,
            // Failed verification attempts. Capped in verifyRecoveryCode so that
            // rotating IPs cannot brute-force the 6-digit code.
            attempts: { type: Number, default: 0 }
        },
        required: false,
        default: undefined
    },
    // The recovery codes asked for in the current window (see forgotPassword),
    // kept apart from the code itself, which every new request replaces.
    recoveryRequests: {
        type: {
            count: Number,
            since: Date,
        },
        required: false,
        default: undefined
    },
    accountVerification: {
        type: {
            token: String,
            expiresAt: Date,
        },
        required: false,
        default: undefined
    },
    status: {
        type: String,
        enum: ["pending", "active", "inactive", "suspended"],
        default: "pending"
    },
    tokenVersion: { type: Number, default: 0 },
    manager: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    org: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
    settingsId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserSettings' }
});

