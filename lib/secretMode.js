const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function createAuth(config = {}, now = Date.now) {
    const sessions = new Map(), attempts = new Map();
    const hash = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(config.passwordHash || '');
    const configured = !!(typeof config.username === 'string' && config.username && hash);
    const ttl = Math.max(1, Math.min(1440, Number(config.sessionMinutes) || 60)) * 60000;
    function token(req) { return (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('secret_session='))?.slice(15); }
    function prune() {
        for (const [key, expiry] of sessions) if (expiry <= now()) sessions.delete(key);
        for (const [key, value] of attempts) if (value.until <= now()) attempts.delete(key);
    }
    return {
        configured, ttl,
        authenticated(req) { prune(); return sessions.has(token(req)); },
        login(username, password, address) {
            prune();
            const attempt = attempts.get(address) || { count: 0, until: now() + 300000 };
            if (attempt.count >= 8 || attempts.size >= 1000) { const error = new Error('Too many login attempts; try again later'); error.status = 429; throw error; }
            attempt.count++; attempts.set(address, attempt);
            if (!configured || typeof password !== 'string' || password.length > 1024 || typeof username !== 'string') return null;
            const supplied = crypto.scryptSync(password, hash[1], 64);
            if (!crypto.timingSafeEqual(supplied, Buffer.from(hash[2], 'hex')) || username !== config.username) return null;
            attempts.delete(address);
            if (sessions.size >= 128) sessions.delete(sessions.keys().next().value);
            const value = crypto.randomBytes(32).toString('hex'); sessions.set(value, now() + ttl); return value;
        },
        logout(req) { sessions.delete(token(req)); },
    };
}
// Resolve existing ancestors too, so a junction/symlink cannot disguise a private path.
function canonical(file) {
    let current = path.resolve(file), suffix = [];
    while (!fs.existsSync(current)) {
        const parent = path.dirname(current); if (parent === current) break;
        suffix.unshift(path.basename(current)); current = parent;
    }
    try { current = fs.realpathSync(current); } catch { /* a missing volume remains lexical */ }
    const result = path.join(current, ...suffix);
    return process.platform === 'win32' ? result.toLowerCase() : result;
}
function within(root, file) {
    if (!root || !file) return false;
    const rel = path.relative(canonical(root), canonical(file));
    return !rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
function sameOrigin(req, publicOrigin) {
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    if (!req.headers.origin) return true;
    try {
        const origin = new URL(req.headers.origin);
        if (publicOrigin) return origin.origin === new URL(publicOrigin).origin;
        return origin.host === req.headers.host && origin.protocol === (req.socket.encrypted ? 'https:' : 'http:');
    } catch { return false; }
}
module.exports = { createAuth, hashPassword, within, canonical, sameOrigin };
