// Scene triggers (fired from the reads) and scene actions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceRegistry } from '../src/devices/index.js';
import { normalizeConfig } from '../src/config.js';
import { SCENE_ACTIONS } from '../src/sceneActions.js';
import { SCENE_TRIGGERS } from '../src/sceneTriggers.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { createLiveApi } from './helpers/liveApi.js';
import { AIR_CONDITIONER, REFRIGERATOR, WASHTOWER } from './helpers/fixtures.js';

const config = normalizeConfig({ access_token: 'pat', country_code: 'FR', poll_frequency: 60 });
const WT = WASHTOWER.device.deviceId;

/** The washtower with the washer in `washer` and the dryer in `dryer`. */
function washtowerState(washer, dryer = 'END') {
  return [
    {
      location: { locationName: 'WASHER' },
      runState: { currentState: washer },
      timer: { remainHour: 1, remainMinute: 25, relativeHourToStop: 0, relativeMinuteToStop: 0 },
      cycle: { cycleCount: 2 },
    },
    { location: { locationName: 'DRYER' }, runState: { currentState: dryer } },
  ];
}

async function setup({ fixtures = [WASHTOWER, AIR_CONDITIONER, REFRIGERATOR] } = {}) {
  const api = createLiveApi(fixtures);
  const gladys = createFakeGladys();
  const refreshes = [];
  const registry = new DeviceRegistry({
    createApi: () => api,
    onChange: () => refreshes.push('change'),
  });
  registry.configure(config);
  await registry.discover(gladys, config);
  const washtower = [...registry.models.values()].find((m) => m.deviceId === WT);
  return { api, gladys, registry, washtower, refreshes };
}

test('the first read of an appliance fires nothing: there is no "before"', async () => {
  const { gladys, registry } = await setup();
  await registry.pollAll(gladys);
  assert.deepEqual(gladys.sceneEvents, []);
});

test('a cycle coming to its end fires "state changed" then "cycle finished"', async () => {
  const { api, gladys, registry, washtower } = await setup();
  await registry.pollModel(gladys, washtower);

  api.setState(WT, washtowerState('END'));
  await registry.pollModel(gladys, washtower);

  assert.deepEqual(gladys.sceneEvents, [
    {
      key: SCENE_TRIGGERS.RUN_STATE_CHANGED,
      data: {
        device: washtower.externalId,
        device_name: 'Buanderie',
        location: 'Washer',
        state: 'END',
        previous_state: 'RUNNING',
      },
    },
    {
      key: SCENE_TRIGGERS.CYCLE_FINISHED,
      data: { device: washtower.externalId, device_name: 'Buanderie', location: 'Washer' },
    },
  ]);
});

test('a state that does not move fires nothing', async () => {
  const { gladys, registry, washtower } = await setup();
  await registry.pollModel(gladys, washtower);
  await registry.pollModel(gladys, washtower);
  assert.deepEqual(gladys.sceneEvents, []);
});

test('leaving a finished state is a change, not a second "cycle finished"', async () => {
  const { api, gladys, registry, washtower } = await setup();
  api.setState(WT, washtowerState('END'));
  await registry.pollModel(gladys, washtower);

  api.setState(WT, washtowerState('POWER_OFF'));
  await registry.pollModel(gladys, washtower);

  assert.deepEqual(
    gladys.sceneEvents.map((e) => e.key),
    [SCENE_TRIGGERS.RUN_STATE_CHANGED],
  );
});

test('losing and finding the LG cloud fires the connection trigger both ways', async () => {
  const { api, gladys, registry, washtower } = await setup();
  await registry.pollModel(gladys, washtower);

  api.setOffline(WT, true);
  await registry.pollModel(gladys, washtower);
  api.setOffline(WT, false);
  await registry.pollModel(gladys, washtower);

  assert.deepEqual(gladys.sceneEvents, [
    {
      key: SCENE_TRIGGERS.CONNECTION_CHANGED,
      data: { device: washtower.externalId, device_name: 'Buanderie', status: 'offline' },
    },
    {
      key: SCENE_TRIGGERS.CONNECTION_CHANGED,
      data: { device: washtower.externalId, device_name: 'Buanderie', status: 'online' },
    },
  ]);
});

test('a cycle that ended while the appliance was offline is still reported', async () => {
  const { api, gladys, registry, washtower } = await setup();
  await registry.pollModel(gladys, washtower);

  api.setOffline(WT, true);
  await registry.pollModel(gladys, washtower);
  api.setState(WT, washtowerState('END'));
  api.setOffline(WT, false);
  await registry.pollModel(gladys, washtower);

  assert.ok(gladys.sceneEvents.some((e) => e.key === SCENE_TRIGGERS.CYCLE_FINISHED));
});

test('a read following an action fires nothing, the next regular read does', async () => {
  const { api, gladys, registry, washtower } = await setup();
  await registry.pollModel(gladys, washtower);

  // A scene reads the appliance: firing from there could loop the scene.
  api.setState(WT, washtowerState('END'));
  await SCENE_ACTIONS.refresh_appliance(gladys, {
    registry,
    fields: { device: washtower.externalId },
  });
  assert.deepEqual(gladys.sceneEvents, []);

  // The transition is not lost for all that.
  await registry.pollModel(gladys, washtower);
  assert.deepEqual(
    gladys.sceneEvents.map((e) => e.key),
    [SCENE_TRIGGERS.RUN_STATE_CHANGED, SCENE_TRIGGERS.CYCLE_FINISHED],
  );
});

test('a re-discovery keeps the last observation of every appliance', async () => {
  const { api, gladys, registry, washtower } = await setup();
  await registry.pollModel(gladys, washtower);

  await registry.discover(gladys, config);
  const rebuilt = registry.models.get(washtower.externalId);
  api.setState(WT, washtowerState('END'));
  await registry.pollModel(gladys, rebuilt);

  assert.ok(gladys.sceneEvents.some((e) => e.key === SCENE_TRIGGERS.CYCLE_FINISHED));
});

test('an event Gladys refuses never breaks the read', async () => {
  const { api, gladys, registry, washtower } = await setup();
  gladys.publishSceneEvent = async () => {
    throw new Error('429 RATE_LIMIT_EXCEEDED');
  };
  await registry.pollModel(gladys, washtower);
  api.setState(WT, washtowerState('END'));

  await registry.pollModel(gladys, washtower);
  assert.equal(washtower.online, true);
});

test('the widgets are nudged when what they display changes, only then', async () => {
  const { api, gladys, registry, washtower, refreshes } = await setup();
  await registry.pollModel(gladys, washtower);
  assert.equal(refreshes.length, 1, 'the first read fills the widgets');

  await registry.pollModel(gladys, washtower);
  assert.equal(refreshes.length, 1, 'nothing moved, nothing to re-pull');

  api.setState(WT, washtowerState('END'));
  await registry.pollModel(gladys, washtower);
  assert.equal(refreshes.length, 2);
});

test('refresh_appliance hands the scene the connection, run state and time left', async () => {
  const { gladys, registry, washtower } = await setup();
  const outputs = await SCENE_ACTIONS.refresh_appliance(gladys, {
    registry,
    fields: { device: washtower.externalId },
  });
  assert.deepEqual(outputs, { online: true, run_state: 'RUNNING', remaining_minutes: 85 });
});

test('refresh_appliance on an offline appliance says so instead of failing', async () => {
  const { api, gladys, registry, washtower } = await setup();
  api.setOffline(WT, true);
  const outputs = await SCENE_ACTIONS.refresh_appliance(gladys, {
    registry,
    fields: { device: washtower.externalId },
  });
  assert.deepEqual(outputs, { online: false, run_state: null, remaining_minutes: null });
});

test('refresh_appliance has no time left to give for an appliance with no countdown', async () => {
  const { gladys, registry } = await setup();
  const salon = [...registry.models.values()].find((m) => m.name === 'Salon');
  const outputs = await SCENE_ACTIONS.refresh_appliance(gladys, {
    registry,
    fields: { device: salon.externalId },
  });
  assert.deepEqual(outputs, { online: true, run_state: null, remaining_minutes: null });
});

test('the send_command scene action drives any property, validated', async () => {
  const { api, gladys, registry } = await setup();
  const salon = [...registry.models.values()].find((m) => m.name === 'Salon');

  const outputs = await SCENE_ACTIONS.send_command(gladys, {
    registry,
    fields: { device: salon.externalId, property: 'airConJobMode.currentJobMode', value: 'COOL' },
  });
  assert.equal(outputs, undefined);
  assert.deepEqual(api.controls.at(-1).payload, { airConJobMode: { currentJobMode: 'COOL' } });

  await assert.rejects(
    SCENE_ACTIONS.send_command(gladys, {
      registry,
      fields: { device: salon.externalId, property: 'airConJobMode.currentJobMode', value: 'X' },
    }),
    /Allowed: COOL \| HEAT \| AIR_DRY/,
  );
});

test('a scene action on an appliance the integration does not know fails clearly', async () => {
  const { gladys, registry } = await setup();
  await assert.rejects(
    SCENE_ACTIONS.refresh_appliance(gladys, { registry, fields: { device: 'ext:gone' } }),
    /unknown/i,
  );
});
