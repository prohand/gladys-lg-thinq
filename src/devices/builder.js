// -----------------------------------------------------------------------------
// Building a Gladys device out of a ThinQ appliance.
//
// One LG appliance + its profile -> one Gladys device with N features, plus the
// codecs needed to move values in both directions. The result is a plain
// object (a "device model") the registry keeps in memory and the SDK handlers
// look up when Gladys polls or sends a command.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { deviceTypeSlug } from '../thinq/deviceTypes.js';
import { SCHEDULER_POLL_FREQUENCY } from '../pollFrequency.js';
import { buildControlPayload, flattenProfile, humanize, readStateValue } from './profile.js';
import { defaultBounds, mapProperty } from './featureMap.js';

const logger = createLogger({ name: 'device-builder' });

/**
 * LG exposes most temperatures twice, once in Celsius and once in Fahrenheit
 * (`targetTemperatureC` / `targetTemperatureF`). Publishing both would double
 * every thermostat, so keep the variant matching the configured unit and drop
 * the other — falling back to whichever exists when only one does.
 */
export function selectTemperatureVariants(descriptors, temperatureUnit) {
  const preferredSuffix = temperatureUnit === 'fahrenheit' ? 'F' : 'C';
  const variantsByBase = new Map();

  for (const descriptor of descriptors) {
    if (!/^.+[CF]$/.test(descriptor.property)) {
      continue;
    }
    const base = `${descriptor.resource}|${descriptor.location ?? ''}|${descriptor.property.slice(0, -1)}`;
    variantsByBase.set(base, (variantsByBase.get(base) ?? 0) + 1);
  }

  return descriptors.filter((descriptor) => {
    if (!/^.+[CF]$/.test(descriptor.property)) {
      return true;
    }
    const base = `${descriptor.resource}|${descriptor.location ?? ''}|${descriptor.property.slice(0, -1)}`;
    // Only one variant exists: keep it whatever its unit.
    if ((variantsByBase.get(base) ?? 0) < 2) {
      return true;
    }
    return descriptor.property.endsWith(preferredSuffix);
  });
}

/** Numeric bounds (and step) declared by the profile for a range property. */
function declaredRange(descriptor) {
  const range = descriptor.writeValues ?? descriptor.readValues;
  if (!range || Array.isArray(range) || typeof range !== 'object') {
    return {};
  }
  const declared = {};
  if (Number.isFinite(range.min)) {
    declared.min = range.min;
  }
  if (Number.isFinite(range.max)) {
    declared.max = range.max;
  }
  // Gladys refuses a step that is not strictly positive (it would freeze or
  // invert the +/- buttons), so an absent or zero step is simply not published.
  if (Number.isFinite(range.step) && range.step > 0) {
    declared.step = range.step;
  }
  return declared;
}

/**
 * The `min` / `max` (and `step`) published for one feature.
 *
 * `t_device_feature.min` and `.max` are NOT NULL in Gladys AND have no default
 * value: a feature published without them is refused the moment the user adds
 * the appliance from the Discovery screen — Gladys answers HTTP 422
 * ("min cannot be null") and the WHOLE device is lost, not just that feature.
 * Only the `range` properties of a ThinQ profile carry bounds, so every other
 * feature (every switch, every text, every unbounded sensor) needs one here.
 *
 * The domain comes from, in order: the range LG declares, what the mapping rule
 * knows about the property, then a plausible default for the unit.
 */
export function featureBounds(descriptor, shape) {
  // An on/off state is 0 or 1, whatever the LG enum behind it.
  if (shape.kind === 'binary') {
    return { min: 0, max: 1 };
  }
  // A text state is stored outside the numeric domain (`last_value_string`):
  // there is no range to declare, only the columns to fill.
  if (shape.kind === 'text') {
    return { min: 0, max: 0 };
  }

  const declared = declaredRange(descriptor);
  const fallback = defaultBounds(shape);
  const min = declared.min ?? shape.min ?? fallback.min;
  const max = declared.max ?? shape.max ?? fallback.max;

  return {
    // A reversed range (LG ships a few, and a half-declared range mixed with a
    // default can invert too) would render an unusable slider.
    min: Math.min(min, max),
    max: Math.max(min, max),
    ...(declared.step === undefined ? {} : { step: declared.step }),
  };
}

/** Everything Gladys accepts in a feature, mirrored from the host API. */
const VALID_CATEGORIES = new Set(Object.values(DEVICE_FEATURE_CATEGORIES));
const VALID_TYPES = new Set(
  Object.values(DEVICE_FEATURE_TYPES).flatMap((group) => Object.values(group)),
);
const VALID_UNITS = new Set(Object.values(DEVICE_FEATURE_UNITS));

/**
 * Is this feature complete enough for Gladys to store it?
 *
 * Gladys validates a device as a whole: one feature missing a NOT NULL column
 * or carrying a category it does not know is a 422 on the whole appliance, and
 * the user cannot add it at all. A mapping rule is cheap to get wrong (a typo
 * in a constant, a unit LG invented), so the last thing done before publishing
 * is to check the contract and drop what would not pass it — an appliance
 * missing one feature stays usable, an appliance Gladys refuses does not.
 */
export function isPublishableFeature(feature) {
  return (
    typeof feature.name === 'string' &&
    feature.name.length > 0 &&
    typeof feature.external_id === 'string' &&
    feature.external_id.length > 0 &&
    VALID_CATEGORIES.has(feature.category) &&
    VALID_TYPES.has(feature.type) &&
    (feature.unit === undefined || VALID_UNITS.has(feature.unit)) &&
    Number.isFinite(feature.min) &&
    Number.isFinite(feature.max) &&
    (feature.step === undefined || (Number.isFinite(feature.step) && feature.step > 0))
  );
}

/** Codec turning an LG value into a Gladys state, and back. */
function buildCodec(shape) {
  if (shape.kind === 'binary') {
    return {
      toGladys(raw) {
        if (raw === undefined || raw === null) {
          return null;
        }
        if (raw === shape.onValue) {
          return 1;
        }
        if (raw === shape.offValue) {
          return 0;
        }
        // Enums often carry more than two values (PAUSE, RESUME, HOMING...).
        // Anything that is not the explicit "off" value counts as running.
        return 1;
      },
      toThinq(state) {
        return Number(state) === 1 ? shape.onValue : shape.offValue;
      },
    };
  }

  if (shape.kind === 'text') {
    return {
      toGladys(raw) {
        if (raw === undefined || raw === null) {
          return null;
        }
        return { text: String(raw) };
      },
      toThinq(state) {
        return String(state);
      },
    };
  }

  return {
    toGladys(raw) {
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    },
    toThinq(state) {
      return Number(state);
    },
  };
}

/**
 * Build the Gladys device model for one ThinQ appliance.
 *
 * @param {object} gladys the SDK instance (for `externalIds`)
 * @param {object} params
 * @param {object} params.thinqDevice one entry of `GET /devices`
 * @param {object} params.profile the appliance profile
 * @param {object} params.config normalized integration configuration
 * @returns {object} `{ deviceId, deviceType, name, externalId, device, features }`
 */
export function buildDeviceModel(gladys, { thinqDevice, profile, config }) {
  const deviceId = thinqDevice.deviceId;
  const info = thinqDevice.deviceInfo ?? {};
  const deviceType = deviceTypeSlug(info.deviceType);
  const ids = gladys.externalIds(deviceType, deviceId);
  const name = info.alias || info.modelName || `LG ${humanize(deviceType)}`;

  const descriptors = selectTemperatureVariants(flattenProfile(profile), config.temperature_unit);

  const features = [];
  const bindings = new Map();

  for (const descriptor of descriptors) {
    const shape = mapProperty(descriptor, deviceType);
    if (!shape || shape.skip) {
      continue;
    }
    // Numeric knobs with no obvious meaning are noise on the dashboard: they
    // only show up when the user asked for the full property set.
    if (shape.optional && !config.expose_all_properties) {
      continue;
    }
    // Gladys has no way to write a text state, so a write-only text property
    // would render an inert feature. Commands still reach it through the
    // "Send a command" action.
    const isText = shape.category === DEVICE_FEATURE_CATEGORIES.TEXT;
    if (isText && !descriptor.readable) {
      continue;
    }

    const externalId = ids.feature(descriptor.key);
    const writable = descriptor.writable && !isText;

    const feature = {
      name: descriptor.location ? `${shape.name} (${humanize(descriptor.location)})` : shape.name,
      external_id: externalId,
      category: shape.category,
      type: shape.type,
      ...(shape.unit ? { unit: shape.unit } : {}),
      ...featureBounds(descriptor, shape),
      read_only: !writable,
      has_feedback: writable && descriptor.readable,
      keep_history: true,
    };

    if (!isPublishableFeature(feature)) {
      logger.warn(`${name}: ${descriptor.path} maps to a feature Gladys would refuse, skipped`);
      continue;
    }

    features.push(feature);
    bindings.set(externalId, { descriptor, shape, codec: buildCodec(shape) });
  }

  logger.debug(
    `${name} (${deviceType}): ${features.length} features mapped from the ThinQ profile`,
  );

  return {
    deviceId,
    deviceType,
    name,
    modelName: info.modelName ?? null,
    reportable: info.reportable !== false,
    externalId: ids.device,
    bindings,
    device: {
      name,
      external_id: ids.device,
      // Gladys only accepts its own enum of cadences, the slowest being one
      // minute; the user's (slower) interval is enforced by the registry.
      poll_frequency: SCHEDULER_POLL_FREQUENCY,
      features,
      params: [
        { name: 'thinq_device_id', value: deviceId },
        { name: 'thinq_device_type', value: String(info.deviceType ?? '') },
        ...(info.modelName ? [{ name: 'thinq_model_name', value: info.modelName }] : []),
      ],
    },
  };
}

/**
 * Turn a device state payload into the Gladys batch to publish.
 * Properties the appliance did not report are skipped, not published as 0.
 */
export function buildStates(model, state) {
  const states = [];
  for (const [externalId, binding] of model.bindings) {
    if (!binding.descriptor.readable) {
      continue;
    }
    const raw = readStateValue(state, binding.descriptor);
    if (raw === undefined) {
      continue;
    }
    const value = binding.codec.toGladys(raw);
    if (value === null) {
      continue;
    }
    if (typeof value === 'object') {
      states.push({ device_feature_external_id: externalId, text: value.text });
    } else {
      states.push({ device_feature_external_id: externalId, state: value });
    }
  }
  return states;
}

/** Build the ThinQ control payload for a Gladys `onSetValue`. */
export function buildCommand(binding, value) {
  return buildControlPayload(binding.descriptor, binding.codec.toThinq(value));
}
