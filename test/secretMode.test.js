const test = require('node:test');
const assert = require('node:assert/strict');
test('Secret sessions expire and logout independently', () => {
    const { createAuth, hashPassword } = require('../lib/secretMode');
    let now = 0;
    const auth = createAuth({ username: 'gm', passwordHash: hashPassword('password'), sessionMinutes: 1 }, () => now);
    const a = auth.login('gm', 'password', 'one');
    const b = auth.login('gm', 'password', 'two');
    const req = token => ({ headers: { cookie: `secret_session=${token}` } });
    assert.ok(auth.authenticated(req(a)));
    auth.logout(req(a));
    assert.equal(auth.authenticated(req(a)), false);
    assert.ok(auth.authenticated(req(b)));
    now = 60001;
    assert.equal(auth.authenticated(req(b)), false);
});
test('HTTPS proxy origin is explicitly configured and forwarded headers are not trusted', () => {
    const { sameOrigin } = require('../lib/secretMode');
    const req = { headers: { host: 'gui.example', origin: 'https://gui.example', 'x-forwarded-proto': 'https' }, socket: {} };
    assert.equal(sameOrigin(req), false);
    assert.equal(sameOrigin(req, 'https://gui.example'), true);
    assert.equal(sameOrigin(req, 'https://other.example'), false);
});
