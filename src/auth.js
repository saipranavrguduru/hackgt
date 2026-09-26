import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readJson, writeJson } from './persistence.js';
import { fail, requireValue } from './errors.js';

export const digest = value => createHash('sha256').update(String(value)).digest('hex');
export class AuthStore {
  constructor(path = null, clock = Date.now) {
    this.path = path; this.clock = clock;
    this.data = readJson(path, () => ({ users: [], sessions: [] }));
    this.attempts = new Map();
  }
  save() { writeJson(this.path, this.data); }
  register({ name, email, password } = {}) {
    requireValue(typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 80, 'INVALID_NAME', 'Enter a name between 1 and 80 characters.');
    requireValue(typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()), 'INVALID_EMAIL', 'Enter a valid email address.');
    requireValue(typeof password === 'string' && password.length >= 12 && password.length <= 128, 'INVALID_PASSWORD', 'Use a password of 12–128 characters.');
    email = email.trim().toLowerCase();
    requireValue(!this.data.users.some(u => u.email === email), 'ACCOUNT_EXISTS', 'An account with this email already exists.', 409);
    const salt = randomBytes(16).toString('hex');
    const user = { id: randomUUID(), name: name.trim(), email, salt, passwordHash: scryptSync(password, salt, 64).toString('hex') };
    this.data.users.push(user); this.save();
    return { id: user.id, name: user.name, email: user.email };
  }
  login(email, password, peer = 'local') {
    const normalized = String(email || '').trim().toLowerCase();
    const key = `${peer}:${normalized}`;
    const entry = this.attempts.get(key) || { count: 0, until: this.clock() + 15 * 60e3 };
    if (entry.until <= this.clock()) { entry.count = 0; entry.until = this.clock() + 15 * 60e3; }
    if (entry.count >= 5) fail('RATE_LIMITED', 'Too many attempts. Try again in 15 minutes.', 429);
    const user = this.data.users.find(u => u.email === normalized);
    const candidate = scryptSync(typeof password === 'string' && password.length <= 128 ? password : '', user?.salt || 'constant-dummy-salt', 64);
    const valid = user && timingSafeEqual(candidate, Buffer.from(user.passwordHash, 'hex'));
    if (!valid) { entry.count++; this.attempts.set(key, entry); fail('INVALID_CREDENTIALS', 'Invalid credentials.', 401); }
    this.attempts.delete(key);
    return this.issue(user.id);
  }
  issue(userId, { ttl = 12 * 60 * 60e3, kind = 'portal', extensionId = null } = {}) {
    const token = randomBytes(32).toString('base64url');
    this.data.sessions = this.data.sessions.filter(s => s.expiresAt > this.clock());
    this.data.sessions.push({ digest: digest(token), userId, kind, extensionId, expiresAt: this.clock() + ttl });
    this.save(); return token;
  }
  lookup(token) {
    if (typeof token !== 'string' || token.length > 256) return null;
    return this.data.sessions.find(s => s.digest === digest(token) && s.expiresAt > this.clock()) || null;
  }
  logout(token) { this.data.sessions = this.data.sessions.filter(s => s.digest !== digest(token)); this.save(); }
}
