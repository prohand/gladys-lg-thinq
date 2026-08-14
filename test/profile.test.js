// Flattening of the three profile layouts, and the state/command round-trip.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildControlPayload,
  flattenProfile,
  humanize,
  readStateValue,
  toKey,
} from '../src/devices/profile.js';
import { AIR_CONDITIONER, REFRIGERATOR, WASHTOWER } from './helpers/fixtures.js';

const find = (descriptors, key) => descriptors.find((d) => d.key === key);

test('toKey produces external-id safe keys', () => {
  assert.equal(toKey('targetTemperatureC'), 'target-temperature-c');
  assert.equal(toKey('PM10'), 'pm10');
  assert.equal(toKey('airConOperationMode'), 'air-con-operation-mode');
  assert.equal(toKey('FRIDGE'), 'fridge');
  // No colon can leak into a key: it is the external id separator.
  assert.ok(!toKey('weird:name').includes(':'));
});

test('humanize builds a readable feature name', () => {
  assert.equal(humanize('currentTemperature'), 'Current temperature');
  assert.equal(humanize('remainHour'), 'Remain hour');
});

test('flattens the plain layout and keeps the access modes', () => {
  const descriptors = flattenProfile(AIR_CONDITIONER.profile);

  const power = find(descriptors, 'operation-air-con-operation-mode');
  assert.ok(power);
  assert.equal(power.path, 'operation.airConOperationMode');
  assert.equal(power.readable, true);
  assert.equal(power.writable, true);
  assert.deepEqual(power.writeValues, ['POWER_ON', 'POWER_OFF']);

  const currentTemperature = find(descriptors, 'temperature-in-units-current-temperature-c');
  assert.equal(currentTemperature.writable, false);
  assert.equal(currentTemperature.unit, 'C');
});

test('flattens per-resource location lists (refrigerator compartments)', () => {
  const descriptors = flattenProfile(REFRIGERATOR.profile);

  const fridge = find(descriptors, 'temperature-in-units-fridge-target-temperature-c');
  const freezer = find(descriptors, 'temperature-in-units-freezer-target-temperature-c');
  assert.equal(fridge.location, 'FRIDGE');
  assert.equal(freezer.location, 'FREEZER');
  // Same property name, two independent descriptors: the keys must not collide.
  assert.notEqual(fridge.key, freezer.key);
  assert.deepEqual(freezer.writeValues, { min: -23, max: -15 });
});

test('flattens per-device location lists (washtower sub-appliances)', () => {
  const descriptors = flattenProfile(WASHTOWER.profile);

  assert.ok(find(descriptors, 'run-state-washer-current-state'));
  assert.ok(find(descriptors, 'run-state-dryer-current-state'));

  const command = find(descriptors, 'operation-washer-washer-operation-mode');
  assert.equal(command.readable, false);
  assert.equal(command.writable, true);
});

test('reads state values through every layout', () => {
  const ac = flattenProfile(AIR_CONDITIONER.profile);
  assert.equal(
    readStateValue(AIR_CONDITIONER.state, find(ac, 'temperature-in-units-current-temperature-c')),
    24.5,
  );

  const fridge = flattenProfile(REFRIGERATOR.profile);
  assert.equal(
    readStateValue(
      REFRIGERATOR.state,
      find(fridge, 'temperature-in-units-freezer-target-temperature-c'),
    ),
    -18,
  );
  assert.equal(
    readStateValue(REFRIGERATOR.state, find(fridge, 'door-status-main-door-state')),
    'CLOSE',
  );

  const washtower = flattenProfile(WASHTOWER.profile);
  assert.equal(
    readStateValue(WASHTOWER.state, find(washtower, 'run-state-washer-current-state')),
    'RUNNING',
  );
  assert.equal(
    readStateValue(WASHTOWER.state, find(washtower, 'run-state-dryer-current-state')),
    'END',
  );
  assert.equal(readStateValue(WASHTOWER.state, find(washtower, 'timer-washer-remain-minute')), 25);
});

test('a property missing from the state reads as undefined, not 0', () => {
  const descriptors = flattenProfile(AIR_CONDITIONER.profile);
  assert.equal(
    readStateValue({}, find(descriptors, 'filter-info-filter-remain-percent')),
    undefined,
  );
});

test('control payloads carry the compartment when there is one', () => {
  const ac = flattenProfile(AIR_CONDITIONER.profile);
  assert.deepEqual(buildControlPayload(find(ac, 'operation-air-con-operation-mode'), 'POWER_ON'), {
    operation: { airConOperationMode: 'POWER_ON' },
  });

  const fridge = flattenProfile(REFRIGERATOR.profile);
  assert.deepEqual(
    buildControlPayload(find(fridge, 'temperature-in-units-freezer-target-temperature-c'), -20),
    { temperatureInUnits: { locationName: 'FREEZER', targetTemperatureC: -20 } },
  );
});
