// The lifecycle: initialization, the refresh loop, Gladys going away and back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceRegistry } from '../src/devices/index.js';
import { createRuntime } from '../src/runtime.js';
import { ThinqApi } from '../src/thinq/api.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { createLiveApi } from './helpers/liveApi.js';
import { AIR_CONDITIONER, REFRIGERATOR } from './helpers/fixtures.js';

const rawConfig = { access_token: 'pat', country_code: 'FR', poll_frequency: 60 };

/** Interval timers driven by hand: `tick()` runs the callbacks armed now. */
function fakeTimers() {
  const armed = new Set();
  return {
    armed,
    setIntervalFn(callback) {
      const timer = { callback };
      armed.add(timer);
      return timer;
    },
    clearIntervalFn(timer) {
      armed.delete(timer);
    },
    async tick() {
      for (const timer of [...armed]) {
        await timer.callback();
      }
    },
  };
}

function setup({ config = rawConfig } = {}) {
  const api = createLiveApi([AIR_CONDITIONER, REFRIGERATOR]);
  const registry = new DeviceRegistry({ createApi: () => api });
  registry.clientId = 'client-uuid';
  const gladys = createFakeGladys({ devices: [] });
  gladys.getConfig = async () => config;
  const timers = fakeTimers();
  let clock = 1_000_000;
  const runtime = createRuntime(gladys, {
    registry,
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
    now: () => clock,
  });
  return { api, registry, gladys, timers, runtime, advance: (ms) => (clock += ms) };
}

test('a connection reads the account and arms the refresh loop', async () => {
  const { gladys, runtime, timers } = setup();
  await runtime.onConnected();

  assert.equal(gladys.discovered.length, 2);
  assert.equal(timers.armed.size, 1);
  assert.equal(gladys.connectionStatuses.at(-1).connected, true);
});

test('the refresh loop is paused while Gladys is unreachable, and resumes with it', async () => {
  const { api, registry, gladys, runtime, timers } = setup();
  await runtime.onConnected();
  for (const model of registry.models.values()) {
    gladys.devices.push({ external_id: model.externalId });
    model.lastPollAt = 0;
  }

  runtime.onDisconnected();
  assert.equal(runtime.refreshLoopRunning, false);
  // A tick already scheduled when the socket dropped reads nothing either.
  await runtime.refreshDueAppliances();
  assert.deepEqual(api.stateReads, []);

  await runtime.onConnected();
  assert.equal(runtime.refreshLoopRunning, true);
  assert.equal(api.stateReads.length, 2, 'everything is read once Gladys is back');
  assert.equal(timers.armed.size, 1, 'one loop, not one per reconnection');
});

test('a country LG does not serve is reported, not thrown', async () => {
  // The real client: its constructor refuses an unknown country.
  const registry = new DeviceRegistry({ createApi: (options) => new ThinqApi(options) });
  registry.clientId = 'client-uuid';
  const gladys = createFakeGladys();
  gladys.getConfig = async () => ({ ...rawConfig, country_code: 'ZZ' });
  const timers = fakeTimers();
  const runtime = createRuntime(gladys, { registry, ...timers });

  await runtime.onConnected();

  const status = gladys.connectionStatuses.at(-1);
  assert.equal(status.connected, false);
  assert.match(status.message.en, /"ZZ"/);
  assert.match(status.message.fr, /« ZZ »/);
  assert.equal(timers.armed.size, 0, 'nothing to retry until the configuration changes');
});

test('a failed first read is retried by the loop after five minutes', async () => {
  const { api, gladys, runtime, timers, advance } = setup();
  const getDevices = api.getDevices;
  api.getDevices = async () => {
    throw new Error('EAI_AGAIN');
  };
  await runtime.onConnected();
  assert.equal(gladys.connectionStatuses.at(-1).connected, false);
  assert.equal(timers.armed.size, 1);

  api.getDevices = getDevices;
  await timers.tick();
  assert.equal(gladys.discovered.length, 0, 'too early to retry');

  advance(5 * 60 * 1000);
  await timers.tick();
  assert.equal(gladys.discovered.length, 2);
  assert.equal(gladys.connectionStatuses.at(-1).connected, true);
});

test('a reconnection whose configuration cannot be read keeps refreshing with the known one', async () => {
  const { gladys, runtime } = setup();
  await runtime.onConnected();
  runtime.onDisconnected();

  gladys.getConfig = async () => {
    throw new Error('timeout');
  };
  await runtime.onConnected();
  assert.equal(runtime.refreshLoopRunning, true);
});
