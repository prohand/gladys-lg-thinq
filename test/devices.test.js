// The registry: discovery, polling, commands, and the Configuration actions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { DeviceRegistry, parseCommandValue } from '../src/devices/index.js';
import { ACTIONS } from '../src/actions.js';
import { ThinqApiError, THINQ_ERROR_CODES } from '../src/thinq/errors.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { AIR_CONDITIONER, REFRIGERATOR } from './helpers/fixtures.js';

const config = normalizeConfig({ access_token: 'pat', country_code: 'FR', poll_frequency: 60 });

/** Stand-in for ThinqApi, driven by the fixtures. */
function fakeApi({ fixtures = [AIR_CONDITIONER, REFRIGERATOR], stateError } = {}) {
  const controls = [];
  return {
    region: 'eic',
    controls,
    async getDevices() {
      return fixtures.map((f) => f.device);
    },
    async getDeviceProfile(deviceId) {
      return fixtures.find((f) => f.device.deviceId === deviceId).profile;
    },
    async getDeviceState(deviceId) {
      if (stateError) {
        throw stateError;
      }
      return fixtures.find((f) => f.device.deviceId === deviceId).state;
    },
    async controlDevice(deviceId, payload) {
      controls.push({ deviceId, payload });
      return {};
    },
  };
}

function buildRegistry(options) {
  const api = fakeApi(options);
  const registry = new DeviceRegistry({ createApi: () => api });
  registry.configure(config);
  return { registry, api, gladys: createFakeGladys() };
}

test('an unconfigured registry refuses to call LG', () => {
  const registry = new DeviceRegistry();
  assert.equal(registry.configure(normalizeConfig({})), false);
  assert.throws(() => registry.requireApi(), /not configured/i);
});

test('discovery turns the account into Gladys devices', async () => {
  const { registry, gladys } = buildRegistry();
  const devices = await registry.discover(gladys, config);

  assert.equal(devices.length, 2);
  assert.deepEqual(
    devices.map((d) => d.name),
    ['Salon', 'Cuisine'],
  );
  assert.ok(devices.every((d) => d.poll_frequency === 60));
  assert.ok(devices.every((d) => d.features.length > 0));
});

test('one unreadable appliance does not lose the others', async () => {
  const api = fakeApi();
  const failing = {
    ...api,
    async getDeviceProfile(deviceId) {
      if (deviceId === AIR_CONDITIONER.device.deviceId) {
        throw new Error('boom');
      }
      return api.getDeviceProfile(deviceId);
    },
  };
  const registry = new DeviceRegistry({ createApi: () => failing });
  registry.configure(config);

  const devices = await registry.discover(createFakeGladys(), config);
  assert.deepEqual(
    devices.map((d) => d.name),
    ['Cuisine'],
  );
});

test('polling publishes the states of one appliance', async () => {
  const { registry, gladys } = buildRegistry();
  await registry.discover(gladys, config);

  const model = [...registry.models.values()].find((m) => m.name === 'Salon');
  await registry.pollModel(gladys, model);

  const power = gladys.published.find((p) =>
    p.featureExternalId.endsWith('operation-air-con-operation-mode'),
  );
  assert.equal(power.state, 1);
  assert.equal(model.online, true);
});

test('an offline appliance is flagged, not fatal', async () => {
  const { registry, gladys } = buildRegistry({
    stateError: new ThinqApiError(THINQ_ERROR_CODES.NOT_CONNECTED_DEVICE, 'off', 400),
  });
  await registry.discover(gladys, config);
  const model = [...registry.models.values()][0];

  await registry.pollModel(gladys, model);
  assert.equal(model.online, false);

  const entry = registry.transportEntries().find((e) => e.external_id === model.externalId);
  assert.equal(entry.transport, DEVICE_TRANSPORTS.UNREACHABLE);
  assert.equal(entry.degraded, true);
});

test('a reachable appliance reports the cloud transport with no degraded flag', async () => {
  const { registry, gladys } = buildRegistry();
  await registry.discover(gladys, config);
  await registry.pollAll(gladys);

  for (const entry of registry.transportEntries()) {
    assert.equal(entry.transport, DEVICE_TRANSPORTS.CLOUD);
    assert.equal(entry.degraded, undefined);
  }
});

test('a command reaches LG and echoes the requested state', async () => {
  const { registry, api, gladys } = buildRegistry();
  await registry.discover(gladys, config);

  const model = [...registry.models.values()].find((m) => m.name === 'Salon');
  const feature = model.device.features.find((f) => f.name === 'On/Off');
  await registry.setValue(gladys, { device: model.device, feature, value: 0 });

  assert.deepEqual(api.controls[0], {
    deviceId: 'TQS-AC-0001',
    payload: { operation: { airConOperationMode: 'POWER_OFF' } },
  });
  assert.deepEqual(gladys.published.at(-1), { featureExternalId: feature.external_id, state: 0 });
});

test('a command on an unknown feature fails loudly', async () => {
  const { registry, gladys } = buildRegistry();
  await registry.discover(gladys, config);

  await assert.rejects(
    () =>
      registry.setValue(gladys, {
        device: { external_id: 'nope' },
        feature: { external_id: 'nope:feature' },
        value: 1,
      }),
    /Unknown LG ThinQ feature/,
  );
});

test('typed command values keep their JSON type', () => {
  assert.equal(parseCommandValue('21'), 21);
  assert.equal(parseCommandValue('-18.5'), -18.5);
  assert.equal(parseCommandValue('true'), true);
  assert.equal(parseCommandValue(' COOL '), 'COOL');
});

test('test_connection reports the region and the appliances', async () => {
  const { registry, gladys } = buildRegistry();
  const message = await ACTIONS.test_connection(gladys, { registry, config, fields: {} });
  assert.match(message.en, /region eic/);
  assert.match(message.en, /Salon, Cuisine/);
});

test('refresh_devices republishes the account', async () => {
  const { registry, gladys } = buildRegistry();
  const message = await ACTIONS.refresh_devices(gladys, { registry, config, fields: {} });

  assert.equal(gladys.discovered.length, 2);
  assert.match(message.fr, /2 appareil/);
});

test('list_properties documents what send_command accepts', async () => {
  const { registry, gladys } = buildRegistry();
  await registry.discover(gladys, config);
  const model = [...registry.models.values()].find((m) => m.name === 'Salon');

  const message = await ACTIONS.list_properties(gladys, {
    registry,
    config,
    fields: { device: model.externalId },
  });
  assert.match(message.en, /airConJobMode\.currentJobMode = COOL \| HEAT \| AIR_DRY/);
  assert.match(message.en, /temperatureInUnits\.targetTemperatureC = 18\.\.30, step 1/);
});

test('send_command drives a property Gladys has no feature for', async () => {
  const { registry, api, gladys } = buildRegistry();
  await registry.discover(gladys, config);
  const model = [...registry.models.values()].find((m) => m.name === 'Salon');

  const message = await ACTIONS.send_command(gladys, {
    registry,
    config,
    fields: { device: model.externalId, property: 'airConJobMode.currentJobMode', value: 'HEAT' },
  });

  assert.deepEqual(api.controls.at(-1).payload, { airConJobMode: { currentJobMode: 'HEAT' } });
  assert.match(message.en, /set to HEAT/);
});

test('send_command refuses a value the appliance does not accept', async () => {
  const { registry, gladys } = buildRegistry();
  await registry.discover(gladys, config);
  const model = [...registry.models.values()].find((m) => m.name === 'Salon');

  await assert.rejects(
    () =>
      ACTIONS.send_command(gladys, {
        registry,
        config,
        fields: {
          device: model.externalId,
          property: 'airConJobMode.currentJobMode',
          value: 'TURBO',
        },
      }),
    /Allowed: COOL \| HEAT \| AIR_DRY/,
  );

  await assert.rejects(
    () =>
      ACTIONS.send_command(gladys, {
        registry,
        config,
        fields: { device: model.externalId, property: 'nope', value: '1' },
      }),
    /has no property "nope"/,
  );
});
