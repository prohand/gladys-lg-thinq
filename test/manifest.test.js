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
import { SCENE_ACTIONS } from '../src/sceneActions.js';
import { SCENE_TRIGGERS, detectSceneEvents, observeModel } from '../src/sceneTriggers.js';
import { WIDGETS } from '../src/widgets.js';
import { buildDeviceModel } from '../src/devices/builder.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { WASHTOWER } from './helpers/fixtures.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const fieldNamed = (key) => manifest.config_schema.find((f) => f.key === key);

/** Minimum Gladys version declared by the manifest, as [major, minor]. */
function minimumGladysVersion() {
  const minVersion = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.\d+/);
  assert.ok(minVersion, 'gladys_version must declare a minimum version');
  return [Number(minVersion[1]), Number(minVersion[2])];
}

test('every manifest action has a registered handler, and vice versa', () => {
  const declared = manifest.actions.map((a) => a.key).sort();
  assert.deepEqual(declared, Object.keys(ACTIONS).sort());
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  // The store validator owns the vocabulary itself; what this pins is the
  // coupling rule: a core older than 4.86 validates manifests against a strict
  // allowlist and rejects any unknown top-level field, so a manifest carrying
  // `categories` must not claim compatibility below the release that reads it.
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.equal(new Set(manifest.categories).size, manifest.categories.length);

  const [major, minor] = minimumGladysVersion();
  assert.ok(
    major > 4 || (major === 4 && minor >= 86),
    `categories requires gladys_version >= 4.86.0, got "${manifest.gladys_version}"`,
  );
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
  const actionFields = [
    ...manifest.actions.flatMap((a) => a.fields ?? []),
    ...manifest.scene_actions.flatMap((a) => a.fields ?? []),
    ...manifest.scene_triggers.flatMap((t) => t.fields ?? []),
    ...manifest.widgets.flatMap((w) => w.settings ?? []),
  ];
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

test('widgets and scene declarations require Gladys >= 5.1.0', () => {
  // Gladys 5.1 is the first release reading `widgets`, `scene_triggers` and
  // `scene_actions`: an older core would refuse the whole manifest.
  const [major, minor] = minimumGladysVersion();
  assert.ok(
    major > 5 || (major === 5 && minor >= 1),
    `widgets and scenes require gladys_version >= 5.1.0, got "${manifest.gladys_version}"`,
  );
});

test('every declared widget has its handlers, and vice versa', () => {
  assert.deepEqual(manifest.widgets.map((w) => w.key).sort(), Object.keys(WIDGETS).sort());
  for (const widget of Object.values(WIDGETS)) {
    assert.equal(typeof widget.get, 'function');
    assert.equal(typeof widget.action, 'function');
  }
});

test('every declared scene action has a handler, and vice versa', () => {
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key).sort(),
    Object.keys(SCENE_ACTIONS).sort(),
  );
});

test('every scene trigger the code fires is declared, and vice versa', () => {
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
});

test('the scene events carry exactly the declared fields and variables', () => {
  // The core drops every key it does not know, and reads a declared key
  // missing from the event as null: both are silent bugs, caught here.
  const config = normalizeConfig({ access_token: 'pat', country_code: 'FR' });
  const model = buildDeviceModel(createFakeGladys(), {
    thinqDevice: WASHTOWER.device,
    profile: WASHTOWER.profile,
    config,
  });
  const before = observeModel(model, WASHTOWER.state);
  const after = { online: false, texts: new Map() };
  for (const [externalId, value] of before.texts) {
    after.texts.set(externalId, value === 'RUNNING' ? 'END' : value);
  }
  const events = detectSceneEvents(model, before, after);
  assert.deepEqual(
    [...new Set(events.map((e) => e.key))].sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );

  for (const event of events) {
    const declaration = manifest.scene_triggers.find((t) => t.key === event.key);
    const declared = [
      ...(declaration.fields ?? []).filter((f) => f.type !== 'section'),
      ...(declaration.variables ?? []),
    ].map((f) => f.key);
    assert.deepEqual(Object.keys(event.data).sort(), [...new Set(declared)].sort(), event.key);
  }
});

test('the scene action outputs are the declared ones', async () => {
  const declared = manifest.scene_actions.find((a) => a.key === 'refresh_appliance').outputs;
  const model = { online: false, bindings: new Map() };
  const registry = { requireModel: () => model, pollModel: async () => {} };
  const outputs = await SCENE_ACTIONS.refresh_appliance(null, { registry, fields: {} });
  assert.deepEqual(Object.keys(outputs).sort(), declared.map((o) => o.key).sort());
});

test('scene and widget keys follow the core rules', () => {
  for (const widget of manifest.widgets) {
    assert.match(widget.key, /^[a-z0-9_]{2,32}$/);
    for (const text of Object.values(widget.label)) {
      assert.ok(text.length >= 3 && text.length <= 30, `widget label "${text}" must be 3-30 chars`);
    }
    for (const text of Object.values(widget.description ?? {})) {
      assert.ok(text.length <= 100, `widget description "${text}" must be <= 100 chars`);
    }
  }
  for (const declaration of [...manifest.scene_triggers, ...manifest.scene_actions]) {
    assert.match(declaration.key, /^[a-z0-9_]{1,40}$/);
  }
});
