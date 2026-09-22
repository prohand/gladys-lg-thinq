// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`).
//
//   send_command        set any ThinQ property from a scene: the same escape
//                       hatch as the Configuration button, for the modes
//                       Gladys has no feature for (a job mode, a course)
//   refresh_appliance   read an appliance NOW, and hand the scene what it
//                       says (connected, run state, remaining time), so the
//                       next actions can use it or gate on it
//
// The core resolves the fields (scene variables substituted, validated) before
// the handler runs; throwing fails this action only, the scene goes on.
// Neither action fires a scene event: the reads they trigger are silent (see
// `DeviceRegistry.pollModel`), so a scene can never loop through them.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { readStateValue } from './devices/profile.js';
import { isRunStateBinding } from './devices/runState.js';

const logger = createLogger({ name: 'scene-actions' });

/** Minutes in one unit of each LG timer grain. */
const MINUTES_PER_GRAIN = { remainHour: 60, remainMinute: 1, remainSecond: 1 / 60 };

/** First value of the bindings matching `predicate` in the last read state. */
function firstValue(model, predicate) {
  if (!model.lastState) {
    return undefined;
  }
  for (const binding of model.bindings.values()) {
    if (!predicate(binding)) {
      continue;
    }
    const raw = readStateValue(model.lastState, binding.descriptor);
    if (raw !== undefined && raw !== null) {
      return raw;
    }
  }
  return undefined;
}

/**
 * Time left on the cycle, in whole minutes, from the `timer.remain*`
 * properties of the first location reporting them. `null` when the appliance
 * has no countdown (a fridge) or did not report it.
 */
export function remainingMinutes(model) {
  if (!model.lastState) {
    return null;
  }
  const byLocation = new Map();
  for (const binding of model.bindings.values()) {
    const { descriptor } = binding;
    const perUnit = MINUTES_PER_GRAIN[descriptor.property];
    if (!/timer$/i.test(descriptor.resource) || perUnit === undefined) {
      continue;
    }
    const raw = Number(readStateValue(model.lastState, descriptor));
    if (!Number.isFinite(raw)) {
      continue;
    }
    const location = descriptor.location ?? '';
    byLocation.set(location, (byLocation.get(location) ?? 0) + raw * perUnit);
  }
  const [first] = byLocation.values();
  return first === undefined ? null : Math.round(first);
}

export const SCENE_ACTIONS = {
  /** Send an arbitrary ThinQ property on one appliance. */
  async send_command(gladys, { registry, fields }) {
    const { model, binding, value } = await registry.sendProperty(gladys, fields);
    logger.info(`scene -> ${model.name} ${binding.descriptor.path} = ${value}`);
    return undefined;
  },

  /** Read one appliance now and expose what it reports to the scene. */
  async refresh_appliance(gladys, { registry, fields }) {
    const model = registry.requireModel(fields.device);
    await registry.pollModel(gladys, model, { silent: true });
    const runState = firstValue(model, isRunStateBinding);
    return {
      online: model.online !== false,
      run_state: model.online === false || runState === undefined ? null : String(runState),
      remaining_minutes: model.online === false ? null : remainingMinutes(model),
    };
  },
};
