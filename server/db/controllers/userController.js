import { userModel, userSettingModel } from '../models/models.js'
import { hashPassword, comparePasswords, generateToken, appendFilter, generateOTP, generateVerificationLink } from '../../utils/helpers.js'
import { emailSchema, passwordSchema } from '../../utils/inputValidations.js'
import { deleteUserRefs, organizationExist, sendTemplateEmail } from '../service/sharedService.js'
import { randomUUID } from 'crypto'
import {
    ACCOUNT_VERIFICATION_HOURS, DAY_MS, HOUR_MS, MAX_OTP_ATTEMPTS, MAX_RECOVERY_REQUESTS, MINUTE_MS, RECOVERY_REQUEST_WINDOW_MS, RESET_TOKEN_MINUTES, ROLES, ROLE_LEVEL,
    SESSION_DAYS,
} from '../../utils/constants.js'
import mongoose from 'mongoose'

// Why an email and password cannot open an account, or null when they can.
function credentialsError(email, password) {
    return emailSchema.validate(email ?? '').error?.message ??
        passwordSchema.validate(password ?? '').error?.message ??
        null
}

// Creates the user and their settings inside the session's transaction.
async function createUserWithSettings(fields, session) {
    const user = new userModel(fields)
    await user.save({ session })
    const settings = new userSettingModel({ userId: user._id })
    await settings.save({ session })
    user.settingsId = settings._id
    await user.save({ session })
    return user
}

/**
 * Projection for every user document that leaves the API.
 *
 * `recoveryCode` and `accountVerification` MUST stay excluded: they hold the
 * live password-reset OTP and the account-activation token. Returning them
 * turns any user read into an account-takeover primitive.
 */
const SAFE_USER_PROJECTION = {
    passwordHash: 0,
    __v: 0,
    recoveryCode: 0,
    accountVerification: 0,
}


export async function createUser(req, res) {
    const { email, password, name } = req.body
    const session = await mongoose.startSession();
    let newUser;

    try {
        const invalidCredentials = credentialsError(email, password)
        if (invalidCredentials) return res.status(400).json({ message: invalidCredentials });

        const passwordHash = await hashPassword(password)
        if (!passwordHash) return res.status(500).json({ message: "Failed to hash the password, couldn't create the user." })
        await session.withTransaction(async () => {
            newUser = await createUserWithSettings({
                email: email.toLowerCase(),
                passwordHash,
                name,
                accountVerification: {
                    token: randomUUID(),
                    expiresAt: new Date(Date.now() + ACCOUNT_VERIFICATION_HOURS * HOUR_MS)
                }
            }, session);


            const url = generateVerificationLink(newUser.accountVerification.token);
            if (!url) throw new Error('Failed to generate verifiction link')

            await sendTemplateEmail("accountVerification", email, { verificationLink: url })
        })

        res.status(201).json({
            user: {
                name: newUser.name,
                email: newUser.email,
                status: newUser.status
            }
        });
    } catch (error) {
        res.status(500).json({ message: error?.message || error })
    } finally {
        session.endSession();
    }
}

export async function createUserAsAdmin(req, res) {
    const { role: currentUserRole, org: currentUserOrg } = req.user
    const { email, password, name, status, role, org, manager } = req.body

    const session = await mongoose.startSession();
    let newUser;

    try {
        const invalidCredentials = credentialsError(email, password)
        if (invalidCredentials) return res.status(400).json({ message: invalidCredentials });

        const passwordHash = await hashPassword(password)
        if (!passwordHash) return res.status(500).json({ message: "Failed to hash the password, couldn't create the user." })

        if (!ROLE_LEVEL[role]) {
            return res.status(400).json({ message: 'Invalid role provided' })
        }

        if (currentUserRole !== ROLES.OWNER && role === ROLES.OWNER) {
            return res.status(403).json({ message: 'You cannot assign greated role then yours' })
        }
        // An admin adds users to their own organization only.
        if (currentUserRole !== ROLES.OWNER && String(org) !== currentUserOrg) {
            return res.status(403).json({ message: 'You can only add users to your own organization' })
        }

        if (!["pending", "active", "inactive", "suspended"].includes(status))
            return res.status(400).json({ message: 'This status is not allow' })


        if (currentUserRole !== ROLES.OWNER || manager) {
            const orgExist = await organizationExist(org)

            if (!orgExist)
                return res.status(400).json({ message: 'This organization does not exist' })
            if (!manager)
                return res.status(400).json({ message: 'manager is mandatory' })
            const managerEntity = await userModel.findById(manager)
            if (!managerEntity) {
                return res.status(400).json({ message: 'This manager does not exist' })
            }
            if (manager && managerEntity.org.toString() !== org) {
                return res.status(403).json({ message: 'Manager must belong to the same organization' })
            }
            if (ROLE_LEVEL[managerEntity.role] < ROLE_LEVEL[role]) {
                return res.status(400).json({
                    message: 'Manager must have a higher role than the user'
                })
            }
        }

        await session.withTransaction(async () => {
            newUser = await createUserWithSettings({
                email: email.toLowerCase(),
                passwordHash,
                name,
                status,
                role,
                org,
                manager
            }, session);
        })

        res.status(201).json({
            user: {
                name: newUser.name,
                email: newUser.email,
                status: newUser.status
            }
        });
    } catch (error) {
        res.status(500).json({ message: error?.message || error })
    } finally {
        session.endSession();
    }
}

export async function verifyNewUser(req, res) {
    const { token } = req.params

    try {
        const user = await userModel.findOneAndUpdate({
            'accountVerification.token': token,
            'accountVerification.expiresAt': { $gt: new Date() }
            , status: 'pending'
        }, { $set: { status: 'active' }, $unset: { accountVerification: "" } }, { new: true }).select('name email')

        if (!user) {
            return res.status(400).json({ message: 'User not found or not in pending status' });
        }
        res.status(200).json({ message: 'User verified successfully', user });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: error?.message || error });
    }
}

export async function loginUser(req, res) {

    const { email, password } = req.body

    const { error: emailError } = emailSchema.validate(email ?? '')
    if (emailError) throw new Error(emailError.message);
    const { error } = passwordSchema.validate(password ?? '')
    if (error) return res.status(400).json({ message: error.message });

    const lowerCaseEmail = email.toLowerCase()

    try {
        const user = await userModel.findOne({ email: lowerCaseEmail })

        if (!user) return res.status(401).json({ message: 'Please verify your email or password' })

        const { role, _id, passwordHash: dbPassword, tokenVersion } = user
        const isSamePassword = await comparePasswords(password, dbPassword)
        if (!isSamePassword) return res.status(401).json({ message: 'Unauthorized' })

        const accessToken = generateToken({ id: _id, role, tokenVersion }, `${SESSION_DAYS}d`);
        res.cookie('accessToken', accessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: SESSION_DAYS * DAY_MS,
            sameSite: 'strict',
        })

        res.status(200).json({ message: "Login successful" })
    } catch (error) {
        res.status(500).json({ message: error?.message || error })
    }
}

export async function logoutUser(req, res) {
    const { id } = req.user
    try {
        await userModel.findByIdAndUpdate(id, { $inc: { tokenVersion: 1 } });

        res.cookie('accessToken', '', {
            httpOnly: true,
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
        })
        res.status(200).json({ message: "Logged out successful" })
    } catch (err) {
        console.error('Failed to logout:', err);
        res.status(500).json({ message: 'Logout failed' });
    }

}

// Sends a recovery code. The answer is the same whether the address has an
// account or not (so it cannot be used to find accounts), and an account gets
// at most MAX_RECOVERY_REQUESTS codes per RECOVERY_REQUEST_WINDOW_MS: each new
// code brings new guesses, so without the cap the guesses would be unlimited.
export async function forgotPassword(req, res) {
    const { email: userEmail } = req.body
    const SENT = 'If this address has an account, a recovery code was sent to it'
    const { error } = emailSchema.validate(userEmail ?? '')
    if (error) return res.status(400).json({ message: error.message });
    try {
        const lowerCaseEmail = userEmail.toLowerCase()
        const user = await userModel.findOne({ email: lowerCaseEmail }, { recoveryRequests: 1 }).lean()
        if (!user) return res.status(200).json({ message: SENT })

        const now = new Date()
        const requests = user.recoveryRequests
        const inWindow = requests?.since && now - requests.since < RECOVERY_REQUEST_WINDOW_MS
        if (inWindow && requests.count >= MAX_RECOVERY_REQUESTS) return res.status(200).json({ message: SENT })

        const { otp, expiresAt, expiryMinutes } = await generateOTP()
        await userModel.updateOne({ _id: user._id }, {
            $set: {
                recoveryCode: { otp, expiresAt },
                recoveryRequests: inWindow ? { count: requests.count + 1, since: requests.since } : { count: 1, since: now },
            }
        });
        await sendTemplateEmail('forgotPassword', lowerCaseEmail, {
            otp,
            expiryMinutes,
            supportEmail: process.env.EMAIL_SUPPORT_USER,
        })
        res.status(200).json({ message: SENT })
    } catch (error) {
        console.error('Failed to send a recovery code:', error);
        res.status(500).json({ message: 'Failed to send the email.' })
    }
}

export async function verifyRecoveryCode(req, res) {
    const { code, email } = req.body
    // Uniform message for every failure mode: a wrong code, an expired code and
    // an unknown address must be indistinguishable, otherwise this endpoint
    // doubles as an account-enumeration oracle.
    const INVALID = 'Invalid or expired code'

    try {
        if (!code) return res.status(400).json({ message: 'Code is mandatory' })
        const { error } = emailSchema.validate(email ?? '')
        if (error) return res.status(400).json({ message: error.message });

        const lowerCaseEmail = email.toLowerCase()
        const user = await userModel.findOne({ email: lowerCaseEmail })

        if (!user) return res.status(400).json({ message: INVALID })

        const recovery = user.recoveryCode
        // Expiry was previously never checked here — it was only enforced by the
        // cleanupOTP cron every 5 minutes, so a 5-minute code stayed valid for 10.
        if (!recovery?.otp || !recovery?.expiresAt || recovery.expiresAt <= new Date()) {
            return res.status(400).json({ message: INVALID })
        }

        if ((recovery.attempts ?? 0) >= MAX_OTP_ATTEMPTS) {
            await userModel.updateOne({ _id: user._id }, { $unset: { recoveryCode: "" } })
            return res.status(429).json({ message: 'Too many invalid attempts, please request a new code' })
        }

        if (recovery.otp !== code) {
            await userModel.updateOne({ _id: user._id }, { $inc: { 'recoveryCode.attempts': 1 } })
            return res.status(400).json({ message: INVALID })
        }

        // Burn the code on success so it is strictly single-use.
        await userModel.updateOne({ _id: user._id }, { $unset: { recoveryCode: "" } })

        // Must carry the normalised address: emails are stored lowercased, and
        // updateUserForgotenPassword looks the user up by this exact value.
        const resetPasswordToken = generateToken({ email: lowerCaseEmail, reset: true }, `${RESET_TOKEN_MINUTES}m`)
        res.cookie('resetToken', resetPasswordToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: RESET_TOKEN_MINUTES * MINUTE_MS,
            sameSite: 'strict',
        })

        res.status(200).json({ message: 'Valid OTP' })
    } catch (error) {
        console.error('Failed to verify the OTP:', error);
        res.status(500).json({ message: 'Failed to verify the OTP' })
    }
}

export async function updateUserForgotenPassword(req, res) {
    const { password } = req.body;
    const { email } = req.reset
    const { error } = passwordSchema.validate(password ?? '')
    if (error) return res.status(400).json({ message: error.message });
    try {


        const passwordHash = await hashPassword(password)
        if (!passwordHash) return res.status(500).json({ message: "Failed to hash the password, couldn't create the user." })

        const update = {
            $set: { passwordHash },
            $inc: { tokenVersion: 1 },
            $unset: { recoveryCode: "" }
        }
        // Was `if (!update)` — the request body object, which is always truthy,
        // so a reset that matched no user silently reported success.
        const updated = await userModel.findOneAndUpdate({ email }, update)
        if (!updated) throw new Error("Failed to update the user's password");

        res.cookie('resetToken', '', {
            httpOnly: true,
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
        })
        res.status(200).json({ message: "Updated successfully" })

    } catch (error) {
        res.status(500).json({ message: error.message })

    }
}

// A user's name: one's own, or anyone's for an owner. The email is the
// account's sign-in and never changes.
export async function updateUserName(req, res) {
    const { id } = req.params //id of the user that we want to update
    const { name } = req.body
    const { id: userId, role } = req.user

    if (id !== userId && role !== ROLES.OWNER) {
        return res.status(403).json({ message: "Only an owner can change another user's name." });
    }
    if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ message: 'Name is required' });
    }

    try {
        const updatedUser = await userModel.findOneAndUpdate({ _id: id }, { $set: { name: name.trim() } }, { new: true }).select('-passwordHash -__v -accountVerification -recoveryCode -role -email')
        if (!updatedUser)
            return res.status(403).json({ message: "Not allowed to update this user" });

        return res.status(200).json({ updatedUser });
    } catch (error) {
        return res.status(400).json({ message: error.message });
    }
}
export async function updateUserPassword(req, res) {
    const { id } = req.params //id of the user that we want to update
    const { id: userId, role } = req.user
    const { oldPassword, newPassword } = req.body

    // An owner sets another user's password without the old one; changing
    // one's own password always takes the old one, owners included. Only an
    // owner may change someone else's.
    const settingAnothers = id !== userId
    if (settingAnothers && role !== ROLES.OWNER) {
        return res.status(403).json({ message: "Only an owner can set another user's password." })
    }
    if (!settingAnothers) {
        const { error: oError } = passwordSchema.validate(oldPassword ?? '')
        if (oError) return res.status(400).json({ message: oError.message });
    }
    const { error: nError } = passwordSchema.validate(newPassword ?? '')
    if (nError) return res.status(400).json({ message: nError.message });

    try {
        const user = await userModel.findOne({ _id: id })
        if (!user) return res.status(401).json({ message: 'User not found' })

        if (!settingAnothers) {
            const isSamePassword = await comparePasswords(oldPassword, user.passwordHash)
            if (!isSamePassword) return res.status(403).json({ message: 'Invalid password' })
        }

        const passwordHash = await hashPassword(newPassword)
        if (!passwordHash) return res.status(500).json({ message: "Failed to hash the password, therefore could not update the password" })

        const updatedUser = await userModel.findByIdAndUpdate(user._id, {
            $set: { passwordHash },
            $inc: { tokenVersion: 1 },
        }, { new: true, select: 'email name' })
        if (!updatedUser) return res.status(401).json({ message: 'Failed to update the password' })

        return res.status(200).json({ updatedUser });
    } catch (error) {
        return res.status(400).json({ message: error.message });
    }
}
export async function updateUserRole(req, res) {
    const { id } = req.params //id of the user that we want to update
    const { role } = req.body
    const { id: userId, role: currentUserRole } = req.user

    if (![ROLES.USER, ROLES.DRIVER, ROLES.TECHNICIAN, ROLES.ADMIN, ROLES.OWNER].includes(role))
        return res.status(400).json({ message: 'This role is not allow' })
    if (id === userId) return res.status(400).json({ message: 'User not allow to update his role' })
    if (currentUserRole === role && currentUserRole !== ROLES.OWNER) return res.status(400).json({ message: 'User not allow to assign a role equal to his' })

    try {
        const updatedUser = await userModel.findOneAndUpdate({
            $and: [
                { _id: id }, { role: { $ne: ROLES.OWNER } }
            ]
        }, { $set: { role }, $inc: { tokenVersion: 1 } }, { new: true }).select('-passwordHash -__v -accountVerification -recoveryCode')
        if (!updatedUser)
            return res.status(403).json({ message: "Not allowed to update this user's role" });

        return res.status(200).json({ updatedUser });
    } catch (error) {
        return res.status(400).json({ message: error.message });
    }
}
export async function updateUserStatus(req, res) {
    const { id } = req.params //id of the user that we want to update
    const { status } = req.body
    const { id: userId, role } = req.user

    let query = { _id: id }

    if (id === userId && role !== ROLES.OWNER)
        return res.status(403).json({ message: 'User not allow to update his status' })
    if (id === userId && role === ROLES.OWNER) {
        return res.status(403).json({ message: 'Owner cant change his own status' })
    }

    if (!["pending", "active", "inactive", "suspended"].includes(status))
        return res.status(400).json({ message: 'This status is not allow' })

    // An admin changes the status of their own organization's users only.
    if (role !== ROLES.OWNER) {
        query.role = { $nin: [ROLES.OWNER, ROLES.ADMIN] }
        query.org = new mongoose.Types.ObjectId(req.user.org)
    }


    try {
        const updatedUser = await userModel.findOneAndUpdate(
            query, { $set: { status } }, { new: true }).select('-passwordHash -__v -accountVerification -recoveryCode')
        if (!updatedUser)
            return res.status(403).json({ message: "Not allowed to update this user" });

        return res.status(200).json({ updatedUser });
    } catch (error) {
        return res.status(400).json({ message: error.message });
    }
}
// An owner moves a user to an organization and gives them a manager there; an
// admin only changes the manager of a user of their own organization. The
// manager is an admin or owner of the user's (new) organization.
export async function updateUserManagerAndOrg(req, res) {
    const { role, org: currentUserOrg } = req.user
    const { id: userId } = req.params
    const { org, manager } = req.body
    const isOwner = role === ROLES.OWNER
    if (!mongoose.Types.ObjectId.isValid(org) || (manager && !mongoose.Types.ObjectId.isValid(manager))) {
        return res.status(400).json({ message: 'Invalid org or manager' })
    }
    const targetOrg = isOwner ? String(org) : currentUserOrg
    try {
        if (isOwner && !await organizationExist(org)) {
            return res.status(400).json({ message: 'This organization does not exist' })
        }
        if (manager && !await userModel.exists({ _id: manager, org: targetOrg, role: { $in: [ROLES.ADMIN, ROLES.OWNER] } })) {
            return res.status(400).json({ message: 'The manager must be an admin of the same organization' })
        }
        let query = appendFilter({}, isOwner, 'org', new mongoose.Types.ObjectId(org))
        query = appendFilter(query, manager, 'manager', new mongoose.Types.ObjectId(manager))
        const filter = { _id: new mongoose.Types.ObjectId(userId), ...(isOwner ? {} : { org: new mongoose.Types.ObjectId(currentUserOrg) }) }
        const updated = await userModel.findOneAndUpdate(filter, { $set: query }, { new: true });
        if (!updated) throw new Error('User not found or not allowed to update')
        return res.status(200).json({ message: 'Updated successfully' });
    } catch (error) {
        return res.status(500).json({ message: error?.message || error })
    }
}

export async function getUser(req, res) {
    const { id } = req.params
    const { role, id: currUserId, org } = req.user

    const query = { _id: new mongoose.Types.ObjectId(id) }

    // Previously `ROLE_LEVEL[role] >= ROLE_LEVEL['admin'] ? id : id` — both
    // branches were the same id, so there was no scoping at all and any
    // authenticated user could read any user in any organization.
    const isSelf = id === currUserId
    if (role !== ROLES.OWNER && !isSelf) {
        if (!org) return res.status(403).json({ message: "Forbidden" });
        query.org = new mongoose.Types.ObjectId(org)
    }

    try {
        const userData = await userModel.findOne(query, SAFE_USER_PROJECTION)

        if (!userData) return res.status(404).json({ message: "User not found." });
        if (!isSelf && ROLE_LEVEL[role] < ROLE_LEVEL[userData.role]) {
            return res.status(403).json({ message: "Forbidden" });
        }
        res.status(200).json({ userData })
    } catch (error) {
        res.status(500).json({ message: error?.message || error })
    }
}
export async function getAllUsers(req, res) {
    const { role, org } = req.user
    let query = {}
    query = appendFilter(query, role !== ROLES.OWNER, 'role', { $ne: ROLES.OWNER })
    query = appendFilter(query, role !== ROLES.OWNER, 'org', new mongoose.Types.ObjectId(org))

    try {
        const users = await userModel.find(query, SAFE_USER_PROJECTION)
        res.status(200).json({ users: users || [] })
    } catch (error) {
        res.status(500).json({ message: error?.message || error })
    }
}
export async function getUserManagers(req, res) {
    const { org, role } = req.user

    let query = {
        role: { $in: [ROLES.ADMIN, ROLES.OWNER] }
    }
    query = appendFilter(query, role !== ROLES.OWNER, 'org', new mongoose.Types.ObjectId(org))
    try {
        if (!org && role !== ROLES.OWNER)
            return res.status(400).json({ message: 'User does not belong to an organization' })
        const managers = await userModel.find(query).select('name _id role')

        return res.status(200).json({ managers: managers || [] })
    } catch (error) {
        console.error(error);
        return res.status(500).json({ managers: [] })
    }
}
// An organization's managers: any organization's for an owner, one's own for anyone else.
export async function getUserManagersByOrgId(req, res) {
    const { id } = req.params
    const { role, org } = req.user
    if (role !== ROLES.OWNER && id !== org) {
        return res.status(403).json({ message: 'Forbidden' })
    }

    let query = {
        org: new mongoose.Types.ObjectId(id),
        role: { $in: [ROLES.ADMIN, ROLES.OWNER] }
    }
    try {
        const managers = await userModel.find(query).select('name _id role')

        return res.status(200).json({ managers: managers || [] })
    } catch (error) {
        console.error(error);
        return res.status(500).json({ managers: [] })
    }
}

export async function deleteUser(req, res) {
    const { id } = req.params;
    const { id: currentUserId, role: currentUserRole } = req.user
    try {

        if (id === currentUserId) {
            return res.status(403).json({ message: "You cannot delete your own account using this method" });
        }

        const userToDelete = await userModel.findById(id);
        // An admin deletes plain users of their own organization only.
        if (currentUserRole !== ROLES.OWNER && (!userToDelete || userToDelete.role !== ROLES.USER || String(userToDelete.org) !== req.user.org)) {
            return res.status(403).json({ message: "User not found or cannot delete an owner / admin" });
        }
        await deleteUserRefs(id);

        res.status(200).json({ message: "User and their content deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: error?.message || error })
    }
}

export async function deleteAccount(req, res, next) {
    const { id } = req.user
    try {
        const user = await deleteUserRefs(id)
        if (!user) throw new Error('Failed to delete the user')

        res.cookie('accessToken', '', {
            httpOnly: true,
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
        })
        res.cookie('theme', '', {
            httpOnly: true,
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
        })
        res.status(200).json({ message: "Account and related content deleted successfully" });
    } catch (error) {
        const status = error.message === "User not found" ? 404 : 500
        res.status(status).json({ message: error?.message || error })
    }
}