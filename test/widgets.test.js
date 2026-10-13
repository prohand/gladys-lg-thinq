// Dashboard widgets: the content must fit the core vocabulary exactly (the
// SDK validator returns [] when the core would render it as sent).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { DeviceRegistry, FORCED_READ_MIN_INTERVAL_MS } from '../src/devices/index.js';
import { normalizeConfig } from '../src/config.js';
import { COMMAND_FIELDS, WIDGETS, WIDGET_ACTIONS, WIDGET_KEYS } from '../src/widgets.js';
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
  assert.deepEqual(status.items[0].value, {
    en: 'Connected',
    fr: 'Connecté',
    de: 'Verbunden',
    es: 'Conectado',
  });
  const jobMode = status.items.find((i) => i.value.en === 'Cool');
  assert.ok(jobMode, 'the job mode is listed, translated');
  assert.deepEqual(jobMode.value, { en: 'Cool', fr: 'Froid', de: 'Kühlen', es: 'Frío' });

  const buttons = content.components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((b) => b.value ?? b.action.key),
    [1, 0, 'refresh', 'send_command'],
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
  assert.equal(finished.value.de, 'Beendet');
  assert.equal(finished.value.es, 'Terminado');
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
      label: { en: 'Connection', fr: 'Connexion', de: 'Verbindung', es: 'Conexión' },
      value: {
        en: 'Waiting for a read',
        fr: 'En attente de lecture',
        de: 'Warte auf Abfrage',
        es: 'Esperando una lectura',
      },
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

  // The Salon was read a moment ago: only the two others cost a call.
  await overviewWidget.action(gladys, { registry, actionKey: 'refresh', settings: {} });
  assert.equal(api.stateReads.length, 3);
  assert.deepEqual(gladys.sceneEvents, []);

  await assert.rejects(
    applianceWidget.action(gladys, { registry, actionKey: 'nope', settings: {} }),
    /Unknown widget action/,
  );
});

test('a Refresh clicked again within two minutes serves the last read, no LG call', async () => {
  const { api, gladys, registry, byName } = await setup();
  const salon = byName('Salon');
  const refresh = () =>
    applianceWidget.action(gladys, {
      registry,
      actionKey: 'refresh',
      settings: { device: salon.externalId },
    });

  await refresh();
  await refresh();
  await overviewWidget.action(gladys, { registry, actionKey: 'refresh', settings: {} });
  await overviewWidget.action(gladys, { registry, actionKey: 'refresh', settings: {} });
  // One read per appliance, however many clicks.
  assert.equal(api.stateReads.length, 3);
  assert.equal(api.stateReads.filter((id) => id === salon.deviceId).length, 1);

  // Past the minimum gap, a click reads LG again.
  salon.lastPollAt -= FORCED_READ_MIN_INTERVAL_MS;
  await refresh();
  assert.equal(api.stateReads.filter((id) => id === salon.deviceId).length, 2);
});

// --- "Send a command" (Gladys 5.2+) ----------------------------------------------

const commandButtonOf = (content) =>
  content.components.find(
    (c) => c.type === 'button' && c.action?.key === WIDGET_ACTIONS.SEND_COMMAND,
  );

test('the command form lists the writable properties of the appliance, within budget', async () => {
  const { gladys, registry, byName } = await setup();
  const salon = byName('Salon');
  await registry.pollModel(gladys, salon);
  const content = applianceWidget.get(gladys, {
    registry,
    config,
    settings: { device: salon.externalId },
  });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.ok(content.components.length <= 8);
  assert.equal(content.components.filter((c) => c.type === 'button').length, 4);

  const [property, value] = commandButtonOf(content).action.fields;
  assert.equal(property.key, COMMAND_FIELDS.PROPERTY);
  assert.equal(property.type, 'select');
  const writable = [...salon.bindings.values()].filter((b) => b.descriptor.writable);
  assert.deepEqual(
    property.options.map((o) => o.value),
    writable.map((b) => b.descriptor.key),
  );
  assert.ok(property.options.some((o) => o.label.en === 'Current job mode'));
  assert.equal(property.default, property.options[0].value);
  assert.equal(value.key, COMMAND_FIELDS.VALUE);
  assert.equal(value.type, 'string');
  assert.equal(value.required, true);
});

test('an appliance with nothing writable gets no command form', async () => {
  const { gladys, registry, byName } = await setup();
  const buanderie = byName('Buanderie');
  for (const binding of buanderie.bindings.values()) {
    binding.descriptor = { ...binding.descriptor, writable: false };
  }
  const content = applianceWidget.get(gladys, {
    registry,
    config,
    settings: { device: buanderie.externalId },
  });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(commandButtonOf(content), undefined);
});

test('the command form goes through send_command: sent, validated, answered', async () => {
  const { api, gladys, registry, byName } = await setup();
  const salon = byName('Salon');
  const send = (values) =>
    applianceWidget.action(gladys, {
      registry,
      actionKey: WIDGET_ACTIONS.SEND_COMMAND,
      settings: { device: salon.externalId },
      values,
    });

  const message = await send({
    [COMMAND_FIELDS.PROPERTY]: 'air-con-job-mode-current-job-mode',
    [COMMAND_FIELDS.VALUE]: 'HEAT',
  });
  assert.deepEqual(api.controls.at(-1).payload, { airConJobMode: { currentJobMode: 'HEAT' } });
  assert.deepEqual(message, {
    en: 'airConJobMode.currentJobMode set to HEAT on Salon.',
    fr: 'airConJobMode.currentJobMode réglé sur HEAT sur Salon.',
    de: 'airConJobMode.currentJobMode von Salon auf HEAT gesetzt.',
    es: 'airConJobMode.currentJobMode ajustado a HEAT en Salon.',
  });
  assert.deepEqual(gladys.sceneEvents, [], 'the read after the command stays silent');

  await assert.rejects(
    send({
      [COMMAND_FIELDS.PROPERTY]: 'air-con-job-mode-current-job-mode',
      [COMMAND_FIELDS.VALUE]: 'X',
    }),
    /Allowed: COOL \| HEAT \| AIR_DRY/,
  );
  await assert.rejects(
    send({ [COMMAND_FIELDS.PROPERTY]: 'nope', [COMMAND_FIELDS.VALUE]: '1' }),
    /has no property "nope"/,
  );
  assert.equal(api.controls.length, 1);
});

test('a core that dropped the form gets an explanation, nothing is sent', async () => {
  const { api, gladys, registry, byName } = await setup();
  const message = await applianceWidget.action(gladys, {
    registry,
    actionKey: WIDGET_ACTIONS.SEND_COMMAND,
    settings: { device: byName('Salon').externalId },
  });
  assert.match(message.en, /Gladys 5\.2/);
  assert.match(message.fr, /Gladys 5\.2/);
  assert.deepEqual(api.controls, []);
});
