import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_ACCESS_TOKEN ??= 'test-secret';
const { escapeHtml, escapeRegex, generateOTP, generateToken, pageLimit } = await import('../utils/helpers.js');
const { resetToken } = await import('../middlewares/authMiddleware.js');
const { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE, OTP_LENGTH } = await import('../utils/constants.js');

function call(middleware, cookies) {
    const req = { cookies };
    let status = null, nextCalled = false;
    const res = { status(code) { status = code; return this; }, json() { return this; } };
    middleware(req, res, () => { nextCalled = true; });
    return { req, status, nextCalled };
}

test('resetToken takes only the token a verified recovery code gives', () => {
    const reset = generateToken({ email: 'a@b.co', reset: true }, '5m');
    const accepted = call(resetToken, { resetToken: reset });
    assert.equal(accepted.nextCalled, true);
    assert.equal(accepted.req.reset.email, 'a@b.co');
});

test('resetToken refuses a session token used as a reset token', () => {
    const session = generateToken({ id: '507f1f77bcf86cd799439011', role: 'user', tokenVersion: 0 }, '1d');
    const refused = call(resetToken, { resetToken: session });
    assert.equal(refused.nextCalled, false);
    assert.equal(refused.status, 401);
});

test('pageLimit keeps a page between 1 and MAX_PAGE_SIZE rows', () => {
    assert.equal(pageLimit('1000000000'), MAX_PAGE_SIZE);
    assert.equal(pageLimit('25'), 25);
    assert.equal(pageLimit(undefined), DEFAULT_PAGE_SIZE);
    assert.equal(pageLimit('-5'), DEFAULT_PAGE_SIZE);
    assert.equal(pageLimit('abc'), DEFAULT_PAGE_SIZE);
});

test('escapeRegex makes a search plain text', () => {
    const pattern = new RegExp(escapeRegex('(a+)+$'), 'i');
    assert.equal(pattern.test('bin (a+)+$ 1'), true);
    assert.equal(pattern.test('aaaa'), false);
});

test('escapeHtml leaves no markup', () => {
    assert.equal(escapeHtml('<a href="x">\'&'), '&#60;a href=&#34;x&#34;&#62;&#39;&#38;');
});

test('generateOTP gives OTP_LENGTH digits', async () => {
    for (let i = 0; i < 20; i++) {
        const { otp } = await generateOTP();
        assert.match(otp, new RegExp(`^\\d{${OTP_LENGTH}}$`));
    }
});
