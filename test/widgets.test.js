// Dashboard widgets: the content must fit the core vocabulary exactly (the
// SDK validator returns [] when the core would render it as sent).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { DeviceRegistry } from '../src/devices/index.js';
import { normalizeConfig } from '../src/config.js';
import { WIDGETS, WIDGET_KEYS } from '../src/widgets.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { createLiveApi } from './helpers/liveApi.js';
import { AIR_CONDITIONER, REFRIGERATOR, WASHTOWER } from './helpers/fixtures.js';

const config = normalizeConfig({ access_token: 'pat', country_code: 'FR', poll_frequency: 300 });

async function setup({ devices } = {}) {
  const api = createLiveApi([AIR_CONDITIONER, REFRIGERATOR, WASHTOWER]);
  const gladys = createFakeGladys({ devices });
  const registry = new DeviceRegistry({ createApi: () => api });
  registry.configure(config);
  await registry.discover(gladys, config);
  const byName = (name) => [...registry.models.values()].find((m) => m.name === name);
  return { api, gladys, registry, byName };
}

const applianceWidget = WIDGETS[WIDGET_KEYS.APPLIANCE];
const overviewWidget = WIDGETS[WIDGET_KEYS.OVERVIEW];

test('the appliance widget shows live tiles, the state and on/off', async () => {
  const { gladys, registry, byName } = await setup();
  const salon = byName('Salon');
  await registry.pollModel(gladys, salon);

  const content = applianceWidget.get(gladys, {
    registry,
    config,
    settings: { device: salon.externalId },
  });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.ttl_seconds, 300);

  const types = content.components.map((c) => c.type);
  assert.equal(types[0], 'text');
  assert.ok(types.filter((t) => t === 'value').length > 0);
  assert.ok(content.components.filter((c) => c.type === 'value').every((c) => c.device_feature));

  const status = content.components.find((c) => c.type === 'status');
  assert.deepEqual(status.items[0].value, { en: 'Connected', fr: 'Connecté' });
  const jobMode = status.items.find((i) => i.value.en === 'Cool');
  assert.ok(jobMode, 'the job mode is listed, translated');
  assert.equal(jobMode.value.fr, 'Froid');

  const buttons = content.components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((b) => b.value ?? b.action.key),
    [1, 0, 'refresh'],
  );
});

test('the appliance widget colors a finished cycle, and fits a washtower', async () => {
  const { gladys, registry, byName } = await setup();
  const washtower = byName('Buanderie');
  await registry.pollModel(gladys, washtower);

  const content = applianceWidget.get(gladys, {
    registry,
    config,
    settings: { device: washtower.externalId },
  });
  assert.deepEqual(validateWidgetContent(content), []);
  const items = content.components.find((c) => c.type === 'status').items;
  const finished = items.find((i) => i.value.en === 'End');
  assert.equal(finished.color, WIDGET_COLORS.SUCCESS);
  assert.equal(finished.value.fr, 'Terminé');
});

test('the appliance widget waits for the first read instead of inventing values', async () => {
  const { gladys, registry, byName } = await setup();
  const content = applianceWidget.get(gladys, {
    registry,
    config,
    settings: { device: byName('Salon').externalId },
  });
  assert.deepEqual(validateWidgetContent(content), []);
  const status = content.components.find((c) => c.type === 'status');
  assert.deepEqual(status.items, [
    {
      label: { en: 'Connection', fr: 'Connexion' },
      value: { en: 'Waiting for a read', fr: 'En attente de lecture' },
      color: WIDGET_COLORS.NEUTRAL,
    },
  ]);
});

test('an appliance not added to Gladys gets no tile nor button bound to it', async () => {
  const { gladys, registry, byName } = await setup({ devices: [] });
  const salon = byName('Salon');
  await registry.pollModel(gladys, salon);

  const content = applianceWidget.get(gladys, {
    registry,
    config,
    settings: { device: salon.externalId },
  });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.ok(content.components.every((c) => c.device_feature === undefined));
});

test('an unknown appliance renders an explanation, not an error', async () => {
  const { gladys, registry } = await setup();
  const content = applianceWidget.get(gladys, { registry, config, settings: { device: 'x' } });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[0].type, 'text');
});

test('the overview lists the added appliances with what they are doing', async () => {
  const { api, gladys, registry, byName } = await setup();
  await registry.pollAll(gladys);
  api.setOffline(REFRIGERATOR.device.deviceId, true);
  await registry.pollModel(gladys, byName('Cuisine'));

  const content = overviewWidget.get(gladys, { registry, config });
  assert.deepEqual(validateWidgetContent(content), []);
  const items = content.components.find((c) => c.type === 'status').items;
  assert.deepEqual(
    items.map((i) => [i.label, i.value.fr]),
    [
      ['Salon', 'Connecté'],
      ['Cuisine', 'Injoignable'],
      ['Buanderie', 'En cours / Terminé'],
    ],
  );
});

test('the overview only lists what the user added', async () => {
  const { gladys, registry, byName } = await setup({ devices: [] });
  let content = overviewWidget.get(gladys, { registry, config });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[0].type, 'text');

  gladys.devices.push({ external_id: byName('Salon').externalId });
  content = overviewWidget.get(gladys, { registry, config });
  assert.equal(content.components.find((c) => c.type === 'status').items.length, 1);
});

test('the refresh buttons read LG now, silently', async () => {
  const { api, gladys, registry, byName } = await setup();
  const salon = byName('Salon');

  const message = await applianceWidget.action(gladys, {
    registry,
    actionKey: 'refresh',
    settings: { device: salon.externalId },
  });
  assert.equal(message.fr, 'Appareil actualisé');
  assert.deepEqual(api.stateReads, [salon.deviceId]);

  await overviewWidget.action(gladys, { registry, actionKey: 'refresh', settings: {} });
  assert.equal(api.stateReads.length, 4);
  assert.deepEqual(gladys.sceneEvents, []);

  await assert.rejects(
    applianceWidget.action(gladys, { registry, actionKey: 'nope', settings: {} }),
    /Unknown widget action/,
  );
});
