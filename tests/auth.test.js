import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore } from '../src/auth.js';

test('registration normalizes email, hashes password, and persists only session digests', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'perkpilot-auth-')), 'auth.json');
  const auth = new AuthStore(path);
  const user = auth.register({ name: 'New User', email: ' NEW@Example.com ', password: 'a secure passphrase' });
  assert.equal(user.email, 'new@example.com');
  const token = auth.login('new@example.com', 'a secure passphrase');
  assert.equal(auth.lookup(token).userId, user.id);
  const saved = readFileSync(path, 'utf8');
  assert.ok(!saved.includes('a secure passphrase'));
  assert.ok(!saved.includes(token));
  const reopened = new AuthStore(path);
  assert.equal(reopened.lookup(token).userId, user.id);
  reopened.logout(token);
  assert.equal(reopened.lookup(token), null);
});

test('password length, duplicate emails, generic invalid credentials, and throttling', () => {
  const auth = new AuthStore(null);
  assert.throws(() => auth.register({name:'X',email:'x@example.com',password:'short'}), /12/);
  auth.register({name:'X',email:'x@example.com',password:'abcdefghijkl'});
  assert.throws(() => auth.register({name:'X',email:'X@EXAMPLE.COM',password:'abcdefghijkl'}), /already/);
  for (let n=0;n<5;n++) assert.throws(() => auth.login('x@example.com', 'wrong', 'peer'), /credentials/);
  assert.throws(() => auth.login('x@example.com', 'abcdefghijkl', 'peer'), /Too many/);
});

test('sessions expire and revocation does not revoke another session', () => {
  let now = 1000;
  const auth = new AuthStore(null, () => now);
  const a = auth.issue('alex'), b = auth.issue('alex');
  auth.logout(a);
  assert.equal(auth.lookup(a), null);
  assert.equal(auth.lookup(b).userId,'alex');
  now += 12 * 60 * 60 * 1000 + 1;
  assert.equal(auth.lookup(b), null);
});
