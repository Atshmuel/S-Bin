import { userModel } from "../db/models/models.js";
import { validateToken } from "../utils/helpers.js";

export async function authToken(req, res, next) {
    const accessToken = req.cookies?.accessToken

    if (!accessToken)
        return res.status(401).json({ message: 'Unauthenticated user' })

    try {
        const data = validateToken(accessToken)
        // A password-reset token is not a session.
        if (!data || data.reset || typeof data.id !== 'string') return res.status(401).json({ message: 'Invalid or expired token' });

        const user = await userModel.findById(data.id);
        if (!user) return res.status(401).json({ message: 'User not found' });

        if (data.tokenVersion !== user.tokenVersion)
            return res.status(401).json({ message: "Unauthorized" });

        if (user.status !== 'active')
            return res.status(401).json({ message: 'User pending activation or user is restricted, please contect our support' });

        req.user = {
            id: user._id.toString(),
            role: user.role,
            email: user.email,
            name: user.name,
            status: user.status,
            org: user.org ? user.org.toString() : null,
        }
        next();
    } catch (error) {
        return res.status(403).json({ message: "Invalid or expired token" });
    }
}

export function resetToken(req, res, next) {
    const resetToken = req.cookies?.resetToken
    if (!resetToken) {
        return res.status(403).json({ message: 'You are not allowed to do this action' })
    }
    try {
        const data = validateToken(resetToken)
        // Only the token verifyRecoveryCode gives out: a session token (signed with
        // the same secret) has no email, and would reset whoever a query on
        // `email: undefined` matched.
        if (!data || data.reset !== true || typeof data.email !== 'string' || !data.email) {
            return res.status(401).json({ message: 'Invalid or expired token' });
        }
        req.reset = data
        next();
    } catch (error) {
        return res.status(403).json({ message: "Invalid or expired token" });
    }
}

export function authRole(allowedRoles = []) {
    return (req, res, next) => {
        if (!req?.user) {
            return res.status(401).json({ message: 'Unauthenticated user' })
        }
        const { role } = req.user
        if (!role) {
            return res.status(403).json({ message: "Missing role in token" });
        }
        if (!allowedRoles.includes(role)) {
            return res.status(403).json({ message: "Access denied" });
        }
        next();
    }
}

