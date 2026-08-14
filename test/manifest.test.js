// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The store indexer validates the manifest against its schema, but nothing
// there can know which handlers the code actually registers, nor that the
// country list offered in the form is the one the client can route.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTIONS } from '../src/actions.js';
import { DEFAULT_CONFIG, MAX_POLL_FREQUENCY, MIN_POLL_FREQUENCY } from '../src/config.js';
import { SUPPORTED_COUNTRIES, getRegionFromCountry } from '../src/thinq/regions.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const fieldNamed = (key) => manifest.config_schema.find((f) => f.key === key);

test('every manifest action has a registered handler, and vice versa', () => {
  const declared = manifest.actions.map((a) => a.key).sort();
  assert.deepEqual(declared, Object.keys(ACTIONS).sort());
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[field.key],
        field.default,
        `DEFAULT_CONFIG.${field.key} must match the manifest default`,
      );
    }
  }
});

test('the token is a secret field, never a plain string', () => {
  const token = fieldNamed('access_token');
  assert.equal(token.type, 'secret');
  assert.equal(token.required, true);
  // A `secret` may not declare a default: it would leak into the manifest.
  assert.equal(token.default, undefined);
});

test('the country select offers exactly the countries the client can route', () => {
  const offered = fieldNamed('country_code').options.map((o) => o.value);
  assert.deepEqual([...offered].sort(), SUPPORTED_COUNTRIES);
  for (const option of fieldNamed('country_code').options) {
    assert.ok(option.label.en, `country ${option.value} needs an English label`);
    assert.doesNotThrow(() => getRegionFromCountry(option.value));
  }
});

test('the refresh interval stays inside the API-friendly range', () => {
  const poll = fieldNamed('poll_frequency');
  assert.ok(poll.min >= 60, 'polling faster than a minute burns the LG call quota');
  assert.ok(poll.default >= poll.min && poll.default <= poll.max);
  // The form bounds and the ones the code clamps to must not drift apart.
  assert.equal(poll.min, MIN_POLL_FREQUENCY);
  assert.equal(poll.max, MAX_POLL_FREQUENCY);
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined, `section "${section.key}" must not be required`);
    assert.equal(section.default, undefined, `section "${section.key}" must not have a default`);
    assert.equal(
      section.placeholder,
      undefined,
      `section "${section.key}" must not have a placeholder`,
    );
    assert.ok(section.label?.en, `section "${section.key}" needs an English label`);
    assert.ok(
      !(section.key in DEFAULT_CONFIG),
      `section "${section.key}" stores no value and must not appear in DEFAULT_CONFIG`,
    );
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  const actionFields = manifest.actions.flatMap((a) => a.fields ?? []);
  const dynamicSelects = actionFields.filter((f) => f.source !== undefined);
  assert.ok(dynamicSelects.length > 0);
  for (const field of dynamicSelects) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined);
  }
});

test('the integration declares itself as cloud-only', () => {
  // ThinQ Connect is a cloud API: claiming a local transport would render a
  // "prefer local" toggle the integration could never honor.
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.equal(manifest.type, 'device');
});
