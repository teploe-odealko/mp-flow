import { getSession } from "./session.js";
export function authMiddleware() {
    return async (c, next) => {
        const session = getSession(c);
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