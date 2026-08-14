// Configuration normalization: the form gives strings, the code wants types.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  MAX_POLL_FREQUENCY,
  MIN_POLL_FREQUENCY,
  isConfigured,
  normalizeConfig,
} from '../src/config.js';

test('an empty configuration falls back to the defaults', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({}), DEFAULT_CONFIG);
});

test('values coming from the form are coerced to their real type', () => {
  const config = normalizeConfig({
    access_token: '  pat-123  ',
    country_code: 'fr',
    poll_frequency: '600',
    expose_all_properties: 'true',
  });

  assert.equal(config.access_token, 'pat-123');
  assert.equal(config.country_code, 'FR');
  assert.equal(config.poll_frequency, 600);
  // Only a real boolean turns the verbose mode on: a truthy string must not.
  assert.equal(config.expose_all_properties, false);
  assert.equal(normalizeConfig({ expose_all_properties: true }).expose_all_properties, true);
});

test('the refresh interval is kept inside the advertised range', () => {
  assert.equal(normalizeConfig({ poll_frequency: 30 }).poll_frequency, MIN_POLL_FREQUENCY);
  assert.equal(normalizeConfig({ poll_frequency: 99999 }).poll_frequency, MAX_POLL_FREQUENCY);
  assert.equal(normalizeConfig({ poll_frequency: 90.4 }).poll_frequency, 90);
  // A value that is not a number at all must not become NaN: the throttle
  // would then let every single tick through.
  assert.equal(
    normalizeConfig({ poll_frequency: 'often' }).poll_frequency,
    DEFAULT_CONFIG.poll_frequency,
  );
  assert.equal(
    normalizeConfig({ poll_frequency: null }).poll_frequency,
    DEFAULT_CONFIG.poll_frequency,
  );
});

test('the temperature unit only accepts the two known values', () => {
  assert.equal(normalizeConfig({ temperature_unit: 'fahrenheit' }).temperature_unit, 'fahrenheit');
  assert.equal(normalizeConfig({ temperature_unit: 'kelvin' }).temperature_unit, 'celsius');
});

test('the integration is only usable once the account is described', () => {
  assert.equal(isConfigured(normalizeConfig()), false);
  assert.equal(isConfigured(normalizeConfig({ access_token: 'pat' })), true);
  assert.equal(isConfigured(normalizeConfig({ access_token: '   ' })), false);
});
