import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import mongoose from 'mongoose'
import {
    DEFAULT_PAGE_SIZE, MAX_LAST_AWAKE_SECONDS, MAX_PAGE_SIZE, MINUTE_MS, OTP_EXPIRY_MINUTES, OTP_LENGTH, PASSWORD_HASH_ROUNDS, RANDOM_TOKEN_BYTES,
    REPORT_MESSAGE_MAX_LENGTH, ROLES,
} from './constants.js'

// A recovery code of random digits (crypto.randomInt: Math.random can be predicted
// from codes seen before).
export async function generateOTP(expiryMinutes = OTP_EXPIRY_MINUTES, length = OTP_LENGTH) {
    let otp = '';
    for (let i = 0; i < length; i++) {
        otp += String(crypto.randomInt(10));
    }
    const expiresAt = new Date(Date.now() + expiryMinutes * MINUTE_MS);

    return { otp, expiresAt, expiryMinutes };
}

export function generateVerificationLink(token) {
    if (!token) return null
    return `${process.env.CLIENT_BASE_URL_PROD}/user/verify?token=${token}`
}

export async function hashPassword(password, rounds = PASSWORD_HASH_ROUNDS) {
    if (!password || !password.length) return null
    try {
        const hashed = await bcrypt.hash(password, rounds)
        return hashed
    } catch (error) {
        console.error('Failed to hash the password');
        return null
    }
}

export async function comparePasswords(inputPassword, dbPassword) {
    if (!inputPassword) return false
    try {
        const isValid = await bcrypt.compare(inputPassword, dbPassword)
        return isValid
    } catch (error) {
        console.error('Failed to compare the password');
        return false
    }
}

export function generateToken(payload, expireTimeString) {
    if (!payload || !expireTimeString) return null
    return jwt.sign(payload, process.env.JWT_ACCESS_TOKEN, {
        expiresIn: expireTimeString
    })
}

export function validateToken(token) {
    if (!token) return null
    try {
        const decoded = jwt.verify(token, process.env.JWT_ACCESS_TOKEN)
        return decoded
    } catch (error) {
        console.error('Token validation failed:', error.message);
        return null
    }
}

export function generateRandomToken(bytes = RANDOM_TOKEN_BYTES) {
    return crypto.randomBytes(bytes).toString('hex');
}

// Matches real bins, including documents created before the kind field existed.
export const BINS_ONLY_FILTER = Object.freeze({ kind: { $ne: "gateway" } });

// A list's page size from ?limit: DEFAULT_PAGE_SIZE without one, never above MAX_PAGE_SIZE.
export function pageLimit(limit) {
    const size = Math.floor(Number(limit));
    return Number.isFinite(size) && size > 0 ? Math.min(size, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
}

// Text put into an HTML page or email as text, not markup.
export function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
}

// What a user typed, matched as plain text inside a $regex (no pattern of their own).
export function escapeRegex(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function appendFilter(baseQuery, condition, field, value) {
    return condition ? { ...baseQuery, [field]: value } : baseQuery
}

// When the server stored a document: the time inside its _id. A log's own
// createdAt is when the reading was taken, which a relayed or queued reading
// can have long before it arrived.
export function receivedAtOf(id) {
    return new mongoose.Types.ObjectId(id).getTimestamp()
}

// A health or severity as a number, worst highest, so sorting by it orders
// by how bad it is rather than alphabetically.
export function healthRank(field) {
    return {
        $switch: {
            branches: [
                { case: { $eq: [field, 'critical'] }, then: 2 },
                { case: { $eq: [field, 'warning'] }, then: 1 },
            ],
            default: 0,
        },
    };
}

// The sort stages of a paged list, from ?sort=<key>&order=asc|desc. `fields`
// maps each sortable key to its field, or to an expression to sort by (see
// healthRank); any other key gets `fallback`. _id breaks ties, so a page
// never repeats a row of the one before. The stages leave a _sortRank field,
// which the caller drops after the page is cut.
export function listSortStages({ sort, order }, fields, fallback) {
    const field = Object.hasOwn(fields, sort) ? fields[sort] : null;
    const direction = order === 'asc' ? 1 : -1;
    if (!field) return [{ $sort: fallback }];
    if (typeof field === 'string') return [{ $sort: { [field]: direction, _id: direction } }];
    return [{ $addFields: { _sortRank: field } }, { $sort: { _sortRank: direction, _id: direction } }];
}

// Limits a bin query to the user's organization; an owner sees every
// organization, or the one picked on the page (selectedOrg, see the
// selectOrganization middleware).
export function scopeToOrganization(filter, { role, org, selectedOrg }) {
    if (role === ROLES.OWNER) {
        return selectedOrg ? { ...filter, ownerId: new mongoose.Types.ObjectId(selectedOrg) } : filter
    }
    return { ...filter, ownerId: new mongoose.Types.ObjectId(org) }
}

export function checkPayloadFields({
    location,
    health,
    level,
    sensorOk,
    battery,
    weight,
    message,
    lastAwakeSeconds,
}, { hasFillSensor = true } = {}) {
    const valid = ["good", "warning", "critical"];
    if (
        !Array.isArray(location) ||
        location.length !== 2 ||
        typeof location[0] !== "number" ||
        typeof location[1] !== "number" ||
        !Number.isFinite(location[0]) ||
        !Number.isFinite(location[1]) ||
        location[0] < -90 ||
        location[0] > 90 ||
        location[1] < -180 ||
        location[1] > 180
    ) return false;
    if (!valid.includes(health)) return false
    // Without a fill sensor (a gateway) the level fields are ignored, not checked.
    if (hasFillSensor) {
        if (sensorOk !== undefined && typeof sensorOk !== "boolean") return false
        if (sensorOk === false) {
            if (level !== undefined && level !== null) return false
        } else if (typeof level !== "number" || level < 0 || level > 100) {
            return false
        }
    }
    if (typeof battery !== "number" || battery < 0 || battery > 100) return false
    if (typeof weight !== "number") return false
    if (message !== undefined && (typeof message !== "string" || message.length > REPORT_MESSAGE_MAX_LENGTH)) return false
    if (lastAwakeSeconds !== undefined &&
        (!Number.isInteger(lastAwakeSeconds) ||
            lastAwakeSeconds < 1 || lastAwakeSeconds > MAX_LAST_AWAKE_SECONDS)) return false

    return true;
}
