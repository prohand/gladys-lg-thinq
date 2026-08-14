// Configuration normalization: the form gives strings, the code wants types.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, isConfigured, normalizeConfig } from '../src/config.js';

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

test('the temperature unit only accepts the two known values', () => {
  assert.equal(normalizeConfig({ temperature_unit: 'fahrenheit' }).temperature_unit, 'fahrenheit');
  assert.equal(normalizeConfig({ temperature_unit: 'kelvin' }).temperature_unit, 'celsius');
});

test('the integration is only usable once the account is described', () => {
  assert.equal(isConfigured(normalizeConfig()), false);
  assert.equal(isConfigured(normalizeConfig({ access_token: 'pat' })), true);
  assert.equal(isConfigured(normalizeConfig({ access_token: '   ' })), false);
});
