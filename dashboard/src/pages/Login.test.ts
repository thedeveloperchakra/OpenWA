// Login page under the bare `node --test` runner, on the jsdom harness the other page tests use. The
// key typed at sign-in is the one the dashboard stores and compares against its API key prefixes, so it
// must be stored trimmed; a gateway that is down is not reported as an invalid key; and the form's
// alignment must follow the document direction set on <html>.
import '../test-helpers/register-hooks.ts';
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';

let sentBody: { identifier?: string; password?: string } | null = null;
let reply: () => Response = okReply;

function okReply(): Response {
  return new Response(JSON.stringify({ apiKey: 'owa_k1_secret', role: 'admin' }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function installFetchStub(): void {
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    sentBody = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    return Promise.resolve(reply());
  }) as typeof fetch;
}

let rtl: typeof import('@testing-library/react');
let Login: (typeof import('./Login.tsx'))['Login'];

before(async () => {
  const { installJsdomGlobals } = await import('../test-helpers/jsdom.ts');
  await installJsdomGlobals();
  (globalThis as Record<string, unknown>).__APP_VERSION__ = '0.0.0-test';
  (globalThis as Record<string, unknown>).__BUILD_TIME__ = '2026-01-01T00:00:00.000Z';
  installFetchStub();
  const { i18nReady } = await import('../i18n/index.ts');
  await i18nReady;
  rtl = await import('@testing-library/react');
  ({ Login } = await import('./Login.tsx'));
});

afterEach(() => {
  sentBody = null;
  reply = okReply;
  rtl.cleanup();
});

test('the username or email is sent trimmed with the password, and the returned key signs in', async () => {
  const { screen, fireEvent, waitFor } = rtl;
  const logins: string[] = [];
  rtl.render(createElement(Login, { onLogin: (key: string) => logins.push(key) }));

  fireEvent.change(screen.getByLabelText('Username or email'), { target: { value: '  admin ' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

  await waitFor(() => assert.equal(logins.length, 1));
  assert.deepEqual(logins, ['owa_k1_secret']);
  assert.deepEqual(sentBody, { identifier: 'admin', password: 'secret' });
});

async function submitAndReadError(): Promise<string> {
  const { screen, fireEvent } = rtl;
  rtl.render(createElement(Login, { onLogin: () => assert.fail('refused credentials signed in') }));
  fireEvent.change(screen.getByLabelText('Username or email'), { target: { value: 'admin' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  const message = await rtl.waitFor(() => {
    const el = document.querySelector('.error-message');
    assert.ok(el);
    return el.textContent ?? '';
  });
  return message;
}

// The only feedback a failed sign-in gives is this message, so it has to reach a screen reader and name the fields it
// is about.
test('a refused sign-in is announced and tied to the credential fields', async () => {
  reply = () => new Response('', { status: 401 });
  await submitAndReadError();
  const alert = rtl.screen.getByRole('alert');
  assert.equal(alert.textContent, 'Invalid username or password');
  const input = rtl.screen.getByLabelText('Username or email');
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.equal(input.getAttribute('aria-describedby'), alert.id);
  const password = rtl.screen.getByLabelText('Password');
  assert.equal(password.getAttribute('aria-invalid'), 'true');
  assert.equal(password.getAttribute('aria-describedby'), alert.id);
});

test('a proxy error page while the gateway is down is a connection error, not invalid credentials', async () => {
  reply = () => new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } });
  assert.equal(await submitAndReadError(), 'Unable to connect to server. Please try again.');
});

test('a 5xx with a JSON message is still a connection error', async () => {
  reply = () => new Response(JSON.stringify({ statusCode: 503, message: 'Service Unavailable' }), { status: 503 });
  assert.equal(await submitAndReadError(), 'Unable to connect to server. Please try again.');
});

test('a refused sign-in keeps the reason the gateway gave', async () => {
  reply = () => new Response(JSON.stringify({ statusCode: 401, message: 'Account is disabled' }), { status: 401 });
  assert.equal(await submitAndReadError(), 'Account is disabled');
});

test('a 401 without a message reads as invalid credentials', async () => {
  reply = () => new Response('', { status: 401 });
  assert.equal(await submitAndReadError(), 'Invalid username or password');
});

// A 200 that is not the gateway's answer (a reverse proxy serving the app's HTML for a misrouted /api) or that carries
// anything other than a minted key signed any typed text in as a viewer, and every page then failed its first read.
for (const [label, body] of [
  ['an HTML page', '<!doctype html><title>OpenWA</title>'],
  ['no apiKey', JSON.stringify({ valid: false })],
] as const) {
  test(`a 200 carrying ${label} is a connection error, not a sign-in`, async () => {
    reply = () => new Response(body, { status: 200 });
    // submitAndReadError fails the test if onLogin runs, so a body without a key cannot sign in.
    assert.equal(await submitAndReadError(), 'Unable to connect to server. Please try again.');
  });
}

test('a refusal other than 401 without a message is a connection error, not an invalid key', async () => {
  reply = () => new Response('', { status: 403 });
  assert.equal(await submitAndReadError(), 'Unable to connect to server. Please try again.');
});

test('the login form aligns to the document direction, which is set on <html>', () => {
  const css = readFileSync(fileURLToPath(new URL('./Login.css', import.meta.url)), 'utf8');
  // i18n sets `dir` on the document element only, so a `[dir]` compound after another selector part
  // would need a second element carrying `dir` inside the page and never matches.
  assert.deepEqual(css.match(/[^\s,{}][^,{}]*\s\[dir[^\]]*\][^{]*/g) ?? [], []);
  assert.match(css, /\.login-container \.login-form \{\s*text-align: start;\s*\}/);
});

// The language picker shows the language in use; its name says it picks the language and keeps the shown words.
test('the language picker is named for what it sets and for the language it shows', () => {
  rtl.render(createElement(Login, { onLogin: () => undefined }));
  assert.ok(rtl.screen.getByRole('button', { name: 'Language, English' }));
});
