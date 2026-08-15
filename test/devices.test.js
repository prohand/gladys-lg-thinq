// The registry: discovery, polling, commands, and the Configuration actions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { DeviceRegistry, parseCommandValue } from '../src/devices/index.js';
import { ACTIONS } from '../src/actions.js';
import { ThinqApiError, THINQ_ERROR_CODES } from '../src/thinq/errors.js';
import { normalizeConfig } from '../src/config.js';
import { SCHEDULER_POLL_FREQUENCY } from '../src/pollFrequency.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { AIR_CONDITIONER, REFRIGERATOR } from './helpers/fixtures.js';

const config = normalizeConfig({ access_token: 'pat', country_code: 'FR', poll_frequency: 60 });

/** Stand-in for ThinqApi, driven by the fixtures. */
function fakeApi({ fixtures = [AIR_CONDITIONER, REFRIGERATOR], stateError } = {}) {
  const controls = [];
  const stateReads = [];
  return {
    region: 'eic',
    controls,
    stateReads,
    async getDevices() {
      return fixtures.map((f) => f.device);
    },
    async getDeviceProfile(deviceId) {
      return fixtures.find((f) => f.device.deviceId === deviceId).profile;
    },
    async getDeviceState(deviceId) {
      stateReads.push(deviceId);
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

function buildRegistry(options = {}) {
  const api = fakeApi(options);
  const registry = new DeviceRegistry({ createApi: () => api });
  registry.configure(config);
  return { registry, api, gladys: createFakeGladys({ devices: options.devices }) };
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
  assert.ok(devices.every((d) => d.poll_frequency === SCHEDULER_POLL_FREQUENCY));
  assert.ok(devices.every((d) => d.should_poll === true));
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

test('the ticks Gladys sends faster than the refresh interval are dropped', async () => {
  const { registry, gladys } = buildRegistry();
  registry.configure(
    normalizeConfig({ access_token: 'pat', country_code: 'FR', poll_frequency: 300 }),
  );
  await registry.discover(gladys, config);
  const model = [...registry.models.values()][0];

  // Never read yet: the very first tick must go through.
  assert.equal(registry.dueForPoll(model), true);

  await registry.pollModel(gladys, model);
  const readAt = model.lastPollAt;
  assert.equal(registry.dueForPoll(model, readAt + 60 * 1000), false);
  assert.equal(registry.dueForPoll(model, readAt + 240 * 1000), false);
  // A tick landing slightly early still counts, otherwise the interval drifts
  // by a whole minute at every cycle.
  assert.equal(registry.dueForPoll(model, readAt + 299 * 1000), true);
  assert.equal(registry.dueForPoll(model, readAt + 300 * 1000), true);
});

test('the refresh loop reads the added appliances, and only when they are due', async () => {
  const { registry, api, gladys } = buildRegistry({ devices: [] });
  await registry.discover(gladys, config);
  const [salon, cuisine] = [...registry.models.values()];

  // Nothing added yet: a tick spends no LG call at all.
  assert.equal(await registry.pollDue(gladys), 0);
  assert.deepEqual(api.stateReads, []);

  gladys.devices.push({ external_id: salon.externalId });
  assert.equal(await registry.pollDue(gladys), 1);
  assert.deepEqual(api.stateReads, [salon.deviceId]);

  // The next tick lands inside the refresh interval: no second call.
  assert.equal(await registry.pollDue(gladys), 0);
  assert.deepEqual(api.stateReads, [salon.deviceId]);

  // ...until the interval has elapsed.
  salon.lastPollAt -= config.poll_frequency * 1000;
  assert.equal(await registry.pollDue(gladys), 1);
  assert.deepEqual(api.stateReads, [salon.deviceId, salon.deviceId]);
  assert.equal(cuisine.lastPollAt, undefined);
});

test('the refresh loop survives one appliance failing', async () => {
  const { registry, gladys } = buildRegistry({ stateError: new Error('network down') });
  await registry.discover(gladys, config);

  assert.equal(await registry.pollDue(gladys), 2);
  assert.ok([...registry.models.values()].every((model) => model.lastPollAt > 0));
});

test('a failed read still counts as an attempt, no retry storm', async () => {
  const { registry, gladys } = buildRegistry({ stateError: new Error('network down') });
  await registry.discover(gladys, config);
  const model = [...registry.models.values()][0];

  await assert.rejects(registry.pollModel(gladys, model), /network down/);
  assert.equal(registry.dueForPoll(model, model.lastPollAt + 1000), false);
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

test('the initial read only touches the appliances the user has added', async () => {
  const { registry, api, gladys } = buildRegistry({ devices: [] });
  await registry.discover(gladys, config);

  // Discovery lists both appliances, but the user has added neither: reading
  // them would only spend LG API calls, their states have nowhere to land.
  await registry.pollAll(gladys);
  assert.deepEqual(api.stateReads, []);
  assert.deepEqual(gladys.published, []);

  const model = [...registry.models.values()].find((m) => m.name === 'Salon');
  gladys.devices.push({ external_id: model.externalId });
  await registry.pollAll(gladys);
  assert.deepEqual(api.stateReads, ['TQS-AC-0001']);
  assert.ok(gladys.published.length > 0);
});

test('an appliance added by the user is read right away', async () => {
  const { registry, api, gladys } = buildRegistry({ devices: [] });
  await registry.discover(gladys, config);
  await registry.pollAll(gladys);

  const model = [...registry.models.values()].find((m) => m.name === 'Salon');
  gladys.devices.push(model.device);
  assert.equal(await registry.pollNewDevice(gladys, model.device), true);

  // Its features carry a value immediately, without waiting a refresh interval.
  assert.deepEqual(api.stateReads, ['TQS-AC-0001']);
  const power = gladys.published.find((p) =>
    p.featureExternalId.endsWith('operation-air-con-operation-mode'),
  );
  assert.equal(power.state, 1);
  assert.ok(model.lastPollAt > 0);
});

test('a device created by another integration is not ours to read', async () => {
  const { registry, api, gladys } = buildRegistry({ devices: [] });
  await registry.discover(gladys, config);

  assert.equal(await registry.pollNewDevice(gladys, { external_id: 'ext:zwave:1' }), false);
  assert.deepEqual(api.stateReads, []);
  assert.deepEqual(gladys.published, []);
});

test('an appliance added while offline is flagged, not fatal', async () => {
  const { registry, gladys } = buildRegistry({
    devices: [],
    stateError: new ThinqApiError(THINQ_ERROR_CODES.NOT_CONNECTED_DEVICE, 'off', 400),
  });
  await registry.discover(gladys, config);
  const model = [...registry.models.values()][0];

  assert.equal(await registry.pollNewDevice(gladys, model.device), true);
  assert.equal(model.online, false);
});

test('the first reads of a burst of additions stay sequential', async () => {
  const { registry, api, gladys } = buildRegistry({ devices: [] });
  await registry.discover(gladys, config);

  let concurrent = 0;
  let peak = 0;
  const getDeviceState = api.getDeviceState.bind(api);
  api.getDeviceState = async (deviceId) => {
    concurrent += 1;
    peak = Math.max(peak, concurrent);
    try {
      return await getDeviceState(deviceId);
    } finally {
      concurrent -= 1;
    }
  };

  const models = [...registry.models.values()];
  await Promise.all(models.map((model) => registry.pollNewDevice(gladys, model.device)));

  assert.equal(peak, 1);
  assert.deepEqual(
    api.stateReads,
    models.map((m) => m.deviceId),
  );
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
