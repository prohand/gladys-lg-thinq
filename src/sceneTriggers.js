// -----------------------------------------------------------------------------
// Scene triggers (manifest `scene_triggers`).
//
// Three events, each one a TRANSITION seen between two reads of an appliance:
//
//   cycle_finished       the washer / dryer / dishwasher / oven has just
//                        finished (its run state went to END, DONE...)
//   run_state_changed    the run state moved, whatever the values
//   connection_changed   the appliance left or came back to the LG cloud
//
// The first read of an appliance only records what it sees: without a
// "before" there is no transition, and restarting the integration must not
// replay "cycle finished" for a machine that ended hours ago.
//
// Values are states (features); these are events ("this happened"). A scene
// that needs "remaining time > 30 min" reads the feature, not an event.
// -----------------------------------------------------------------------------

import { readStateValue, humanize } from './devices/profile.js';
import { isFinishedRunState, isRunStateBinding } from './devices/runState.js';

export const SCENE_TRIGGERS = {
  CYCLE_FINISHED: 'cycle_finished',
  RUN_STATE_CHANGED: 'run_state_changed',
  CONNECTION_CHANGED: 'connection_changed',
};

export const CONNECTION_STATUS = {
  ONLINE: 'online',
  OFFLINE: 'offline',
};

/**
 * What one read of an appliance says, reduced to what the triggers and the
 * widgets compare between two reads.
 *
 * @param {object} model the device model
 * @param {object|null} state the ThinQ state, `null` when the appliance is offline
 * @param {object} [previous] the previous observation
 * @returns {{online: boolean, texts: Map<string, string>}} texts = feature
 *   external_id -> raw LG value of every readable text feature
 */
export function observeModel(model, state, previous) {
  // Offline: LG says nothing about the appliance, so the last known values
  // stand. Forgetting them would turn the reconnection into a transition.
  if (state === null) {
    return { online: false, texts: previous?.texts ?? new Map() };
  }
  const texts = new Map();
  for (const [externalId, binding] of model.bindings) {
    if (binding.shape.kind !== 'text' || !binding.descriptor.readable) {
      continue;
    }
    const raw = readStateValue(state, binding.descriptor);
    if (raw !== undefined && raw !== null) {
      texts.set(externalId, String(raw));
    }
  }
  return { online: true, texts };
}

/** Did anything a widget displays change between two observations? */
export function observationChanged(previous, current) {
  if (!previous || previous.online !== current.online) {
    return true;
  }
  if (previous.texts.size !== current.texts.size) {
    return true;
  }
  for (const [externalId, value] of current.texts) {
    if (previous.texts.get(externalId) !== value) {
      return true;
    }
  }
  return false;
}

/**
 * The scene events between two observations of one appliance.
 *
 * `data` carries the `fields` of the trigger (the filters, compared by the
 * core) and its `variables` (what the scene actions can read), flat.
 *
 * @returns {Array<{key: string, data: object}>}
 */
export function detectSceneEvents(model, previous, current) {
  if (!previous) {
    return [];
  }
  const events = [];
  const identity = { device: model.externalId, device_name: model.name };

  if (previous.online !== current.online) {
    events.push({
      key: SCENE_TRIGGERS.CONNECTION_CHANGED,
      data: {
        ...identity,
        status: current.online ? CONNECTION_STATUS.ONLINE : CONNECTION_STATUS.OFFLINE,
      },
    });
  }

  for (const [externalId, binding] of model.bindings) {
    if (!isRunStateBinding(binding)) {
      continue;
    }
    const before = previous.texts.get(externalId);
    const after = current.texts.get(externalId);
    if (before === undefined || after === undefined || before === after) {
      continue;
    }
    const location = binding.descriptor.location ? humanize(binding.descriptor.location) : null;
    events.push({
      key: SCENE_TRIGGERS.RUN_STATE_CHANGED,
      data: { ...identity, location, state: after, previous_state: before },
    });
    if (isFinishedRunState(after) && !isFinishedRunState(before)) {
      events.push({
        key: SCENE_TRIGGERS.CYCLE_FINISHED,
        data: { ...identity, location },
      });
    }
  }

  return events;
}
