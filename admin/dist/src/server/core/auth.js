import { getSession } from "./session.js";
const DEV_USER_ID = "dev-admin-local";
const DEV_USER_EMAIL = "admin@localhost";
const DEV_USER_NAME = "Dev Admin";
export function getAuthMode() {
    if (process.env.LOGTO_ENDPOINT)
        return "logto";
    if (process.env.AUTH_MODE === "dev")
        return "dev";
    return "selfhosted";
}
export function isDevMode() {
    return getAuthMode() === "dev";
}
export function authMiddleware() {
    return async (c, next) => {
        const session = getSession(c);
        // Dev mode: auto-inject dev user
        if (!session.userId && getAuthMode() === "dev") {
            session.userId = DEV_USER_ID;
            session.email = DEV_USER_EMAIL;
            session.name = DEV_USER_NAME;
            await session.save();
        }
        if (!session.userId) {
            return c.json({ error: "Unauthorized" }, 401);
        }
        await next();
    };
}
export function getUserId(c) {
    const session = getSession(c);
    if (!session.userId)
        throw new Error("No user in session");
    return session.userId;
}
export function getUserIdOptional(c) {
    const session = getSession(c);
    return session.userId;
}
//# sourceMappingURL=auth.js.map