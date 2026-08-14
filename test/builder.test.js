// ThinQ profile -> Gladys device: categories, units, bounds and codecs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { buildCommand, buildDeviceModel, buildStates } from '../src/devices/builder.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { AIR_CONDITIONER, REFRIGERATOR, WASHTOWER } from './helpers/fixtures.js';

const config = normalizeConfig({ access_token: 'token', country_code: 'FR' });

function build(fixture, overrides = {}) {
  const gladys = createFakeGladys();
  const model = buildDeviceModel(gladys, {
    thinqDevice: fixture.device,
    profile: fixture.profile,
    config: { ...config, ...overrides },
  });
  return { gladys, model };
}

const featureNamed = (model, name) => model.device.features.find((f) => f.name === name);
const featureEndingWith = (model, suffix) =>
  model.device.features.find((f) => f.external_id.endsWith(suffix));

test('the device carries the LG alias and a stable external id', () => {
  const { model } = build(AIR_CONDITIONER);
  assert.equal(model.device.name, 'Salon');
  assert.equal(model.externalId, 'ext:lg-thinq:air-conditioner:TQS-AC-0001');
  assert.equal(model.device.poll_frequency, 300);
  assert.deepEqual(
    model.device.params.find((p) => p.name === 'thinq_device_id'),
    { name: 'thinq_device_id', value: 'TQS-AC-0001' },
  );
});

test('the power property becomes a controllable air conditioning switch', () => {
  const { model } = build(AIR_CONDITIONER);
  const power = featureNamed(model, 'On/Off');

  assert.equal(power.category, DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING);
  assert.equal(power.type, DEVICE_FEATURE_TYPES.AIR_CONDITIONING.BINARY);
  assert.equal(power.read_only, false);
  assert.equal(power.has_feedback, true);
});

test('the setpoint keeps the bounds declared by the appliance', () => {
  const { model } = build(AIR_CONDITIONER);
  const target = featureNamed(model, 'Target temperature');

  assert.equal(target.type, DEVICE_FEATURE_TYPES.AIR_CONDITIONING.TARGET_TEMPERATURE);
  assert.equal(target.unit, DEVICE_FEATURE_UNITS.CELSIUS);
  assert.equal(target.min, 18);
  assert.equal(target.max, 30);
  assert.equal(target.read_only, false);
});

test('only the configured temperature unit is published', () => {
  const { model: celsius } = build(AIR_CONDITIONER);
  assert.ok(featureEndingWith(celsius, 'current-temperature-c'));
  assert.equal(featureEndingWith(celsius, 'current-temperature-f'), undefined);

  const { model: fahrenheit } = build(AIR_CONDITIONER, { temperature_unit: 'fahrenheit' });
  assert.ok(featureEndingWith(fahrenheit, 'current-temperature-f'));
  assert.equal(featureEndingWith(fahrenheit, 'current-temperature-c'), undefined);
  assert.equal(
    featureNamed(fahrenheit, 'Current temperature').unit,
    DEVICE_FEATURE_UNITS.FAHRENHEIT,
  );
});

test('sensors land in their Gladys category', () => {
  const { model } = build(AIR_CONDITIONER);

  assert.equal(featureNamed(model, 'PM2.5').category, DEVICE_FEATURE_CATEGORIES.PM25_SENSOR);
  assert.equal(featureNamed(model, 'PM10').category, DEVICE_FEATURE_CATEGORIES.PM10_SENSOR);
  assert.equal(featureNamed(model, 'Humidity').category, DEVICE_FEATURE_CATEGORIES.HUMIDITY_SENSOR);
  assert.equal(
    featureNamed(model, 'Filter remain percent').category,
    DEVICE_FEATURE_CATEGORIES.HEPA_FILTER_MONITORING,
  );
  assert.equal(featureNamed(model, 'Current temperature').read_only, true);
});

test('a model-specific enum becomes a read-only text feature', () => {
  const { model } = build(AIR_CONDITIONER);
  const jobMode = featureNamed(model, 'Current job mode');

  assert.equal(jobMode.category, DEVICE_FEATURE_CATEGORIES.TEXT);
  assert.equal(jobMode.type, DEVICE_FEATURE_TYPES.TEXT.TEXT);
  // Gladys cannot write a text state: the "Send a command" action does.
  assert.equal(jobMode.read_only, true);
});

test('an ON/OFF enum becomes a switch even outside the operation resource', () => {
  const { model } = build(AIR_CONDITIONER);
  const monitoring = featureNamed(model, 'Monitoring enabled');

  assert.equal(monitoring.category, DEVICE_FEATURE_CATEGORIES.SWITCH);
  assert.equal(monitoring.read_only, false);
});

test('scheduling knobs stay hidden unless the user asks for everything', () => {
  const { model: standard } = build(AIR_CONDITIONER);
  assert.equal(featureNamed(standard, 'Absolute hour to start'), undefined);

  const { model: verbose } = build(AIR_CONDITIONER, { expose_all_properties: true });
  assert.ok(featureNamed(verbose, 'Absolute hour to start'));
});

test('states are decoded into the Gladys batch, missing ones skipped', () => {
  const { model } = build(AIR_CONDITIONER);
  const states = buildStates(model, AIR_CONDITIONER.state);
  const byId = new Map(states.map((s) => [s.device_feature_external_id, s]));

  const power = featureNamed(model, 'On/Off');
  assert.equal(byId.get(power.external_id).state, 1);

  const jobMode = featureNamed(model, 'Current job mode');
  assert.equal(byId.get(jobMode.external_id).text, 'COOL');

  const temperature = featureNamed(model, 'Current temperature');
  assert.equal(byId.get(temperature.external_id).state, 24.5);

  // Nothing is invented for a property the appliance did not report.
  const partial = buildStates(model, { operation: { airConOperationMode: 'POWER_OFF' } });
  assert.equal(partial.length, 1);
  assert.equal(partial[0].state, 0);
});

test('a command is encoded back into the LG enum', () => {
  const { model } = build(AIR_CONDITIONER);
  const power = featureNamed(model, 'On/Off');
  const binding = model.bindings.get(power.external_id);

  assert.deepEqual(buildCommand(binding, 1), { operation: { airConOperationMode: 'POWER_ON' } });
  assert.deepEqual(buildCommand(binding, 0), { operation: { airConOperationMode: 'POWER_OFF' } });

  const target = featureNamed(model, 'Target temperature');
  assert.deepEqual(buildCommand(model.bindings.get(target.external_id), 22), {
    temperatureInUnits: { targetTemperatureC: 22 },
  });
});

test('each fridge compartment gets its own named setpoint', () => {
  const { model } = build(REFRIGERATOR);

  const freezer = featureNamed(model, 'Target temperature (Freezer)');
  assert.equal(freezer.category, DEVICE_FEATURE_CATEGORIES.THERMOSTAT);
  assert.equal(freezer.min, -23);
  assert.ok(featureNamed(model, 'Target temperature (Fridge)'));

  const door = featureNamed(model, 'Door (Main)');
  assert.equal(door.category, DEVICE_FEATURE_CATEGORIES.OPENING_SENSOR);

  const states = buildStates(model, REFRIGERATOR.state);
  const byId = new Map(states.map((s) => [s.device_feature_external_id, s]));
  assert.equal(byId.get(freezer.external_id).state, -18);
  assert.equal(byId.get(door.external_id).state, 0); // CLOSE
  assert.equal(byId.get(featureNamed(model, 'Power save enabled').external_id).state, 0);
});

test('a write-only command is exposed as a writable switch with no feedback', () => {
  const { model } = build(WASHTOWER);
  const start = featureNamed(model, 'On/Off (Washer)');

  assert.equal(start.read_only, false);
  assert.equal(start.has_feedback, false);
  assert.deepEqual(buildCommand(model.bindings.get(start.external_id), 1), {
    operation: { locationName: 'WASHER', washerOperationMode: 'START' },
  });
});

test('the remaining cycle time is a duration in the right unit', () => {
  const { model } = build(WASHTOWER);
  const minutes = featureNamed(model, 'Remain minute (Washer)');

  assert.equal(minutes.category, DEVICE_FEATURE_CATEGORIES.DURATION);
  assert.equal(minutes.unit, DEVICE_FEATURE_UNITS.MINUTES);
  assert.equal(featureNamed(model, 'Remain hour (Washer)').unit, DEVICE_FEATURE_UNITS.HOURS);

  const states = buildStates(model, WASHTOWER.state);
  const byId = new Map(states.map((s) => [s.device_feature_external_id, s]));
  assert.equal(byId.get(minutes.external_id).state, 25);
  assert.equal(byId.get(featureNamed(model, 'Current state (Washer)').external_id).text, 'RUNNING');
  assert.equal(byId.get(featureNamed(model, 'Current state (Dryer)').external_id).text, 'END');
});

test('an unknown appliance family still produces a usable device', () => {
  // LG keeps adding families; an unrecognized deviceType must degrade to a
  // stable slug rather than dropping the appliance.
  const { model } = build({
    device: {
      deviceId: 'TQS-NEW-9',
      deviceInfo: { deviceType: 'DEVICE_SMART_KETTLE', alias: 'Bouilloire', reportable: true },
    },
    profile: {
      property: {
        operation: {
          kettleOperationMode: {
            type: 'enum',
            mode: ['r', 'w'],
            value: { r: ['POWER_ON', 'POWER_OFF'], w: ['POWER_ON', 'POWER_OFF'] },
          },
        },
        // A writable range inside `operation`: the on/off lookup must not
        // choke on a `{ min, max }` object where it expects a list.
        power: {
          powerLevel: {
            type: 'range',
            mode: ['r', 'w'],
            value: { r: { min: 1, max: 5 }, w: { min: 1, max: 5 } },
          },
        },
      },
    },
  });

  assert.equal(model.deviceType, 'smart-kettle');
  assert.equal(model.externalId, 'ext:lg-thinq:smart-kettle:TQS-NEW-9');
  assert.equal(featureNamed(model, 'On/Off').category, DEVICE_FEATURE_CATEGORIES.SWITCH);
  // The range has no meaning we can guess, so it stays hidden by default.
  assert.equal(featureNamed(model, 'Power level'), undefined);
});

test('a range under operation is never mistaken for a power switch', () => {
  const { model } = build({
    device: {
      deviceId: 'TQS-RANGE-1',
      deviceInfo: { deviceType: 'DEVICE_OVEN', alias: 'Four', reportable: true },
    },
    profile: {
      property: {
        operation: {
          targetLevel: {
            type: 'range',
            mode: ['r', 'w'],
            value: { r: { min: 0, max: 9 }, w: { min: 0, max: 9 } },
          },
        },
      },
    },
  });

  assert.equal(featureNamed(model, 'On/Off'), undefined);
});
