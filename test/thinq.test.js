// The LG ThinQ HTTP client: routing, headers, error decoding.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ThinqApi, THINQ_API_KEY, generateMessageId } from '../src/thinq/api.js';
import { ThinqApiError, THINQ_ERROR_CODES } from '../src/thinq/errors.js';
import { SUPPORTED_COUNTRIES, getRegionFromCountry } from '../src/thinq/regions.js';

/** A fetch stand-in recording the calls and replaying canned answers. */
function fakeFetch(answer) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, options });
    const { status = 200, body = { response: {} } } =
      typeof answer === 'function' ? answer(url) : answer;
    return { ok: status >= 200 && status < 300, status, statusText: 'x', json: async () => body };
  };
  impl.calls = calls;
  return impl;
}

const buildApi = (fetchImpl, countryCode = 'FR') =>
  new ThinqApi({ accessToken: 'pat-123', countryCode, clientId: 'client-uuid', fetchImpl });

test('countries route to the right regional host', () => {
  assert.equal(getRegionFromCountry('FR'), 'eic');
  assert.equal(getRegionFromCountry('us'), 'aic');
  assert.equal(getRegionFromCountry('KR'), 'kic');
  assert.throws(() => getRegionFromCountry('ZZ'), /not supported/i);
});

test('every supported country resolves to a region', () => {
  assert.equal(SUPPORTED_COUNTRIES.length, 162);
  for (const country of SUPPORTED_COUNTRIES) {
    assert.match(getRegionFromCountry(country), /^(kic|aic|eic)$/);
  }
});

test('the message id is the 22-character base64url blob LG expects', () => {
  const id = generateMessageId();
  assert.equal(id.length, 22);
  assert.match(id, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(id, generateMessageId());
});

test('requests carry the full LG header set', async () => {
  const fetchImpl = fakeFetch({ body: { response: [] } });
  const api = buildApi(fetchImpl);
  await api.getDevices();

  const { url, options } = fetchImpl.calls[0];
  assert.equal(url, 'https://api-eic.lgthinq.com/devices');
  assert.equal(options.headers.Authorization, 'Bearer pat-123');
  assert.equal(options.headers['x-country'], 'FR');
  assert.equal(options.headers['x-client-id'], 'client-uuid');
  assert.equal(options.headers['x-api-key'], THINQ_API_KEY);
  assert.equal(options.headers['x-service-phase'], 'OP');
  assert.match(options.headers['x-message-id'], /^[A-Za-z0-9_-]{22}$/);
});

test('a control call is conditional and carries the payload', async () => {
  const fetchImpl = fakeFetch({ body: { response: {} } });
  const api = buildApi(fetchImpl, 'US');
  await api.controlDevice('TQS/1', { operation: { airConOperationMode: 'POWER_ON' } });

  const { url, options } = fetchImpl.calls[0];
  assert.equal(url, 'https://api-aic.lgthinq.com/devices/TQS%2F1/control');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers['x-conditional-control'], 'true');
  assert.equal(options.body, '{"operation":{"airConOperationMode":"POWER_ON"}}');
});

test('the response envelope is unwrapped', async () => {
  const api = buildApi(fakeFetch({ body: { messageId: 'x', response: [{ deviceId: 'a' }] } }));
  assert.deepEqual(await api.getDevices(), [{ deviceId: 'a' }]);
});

test('an error body becomes a typed error', async () => {
  const api = buildApi(
    fakeFetch({ status: 400, body: { error: { code: '1218', message: 'Invalid token' } } }),
  );
  await assert.rejects(
    () => api.getDevices(),
    (err) => {
      assert.ok(err instanceof ThinqApiError);
      assert.equal(err.code, THINQ_ERROR_CODES.INVALID_TOKEN_AGAIN);
      assert.equal(err.isAuthError, true);
      assert.equal(err.isDeviceOffline, false);
      return true;
    },
  );
});

test('an offline appliance is told apart from a broken integration', () => {
  const offline = new ThinqApiError(THINQ_ERROR_CODES.NOT_CONNECTED_DEVICE, 'off', 400);
  assert.equal(offline.isDeviceOffline, true);
  assert.equal(offline.isAuthError, false);

  const throttled = new ThinqApiError(THINQ_ERROR_CODES.EXCEEDED_API_CALLS, 'slow down', 429);
  assert.equal(throttled.isRateLimited, true);
});

test('a network failure keeps its cause instead of masquerading as an API error', async () => {
  const api = buildApi(async () => {
    throw new Error('ECONNRESET');
  });
  await assert.rejects(() => api.getDevices(), /LG ThinQ request failed .*ECONNRESET/);
});
