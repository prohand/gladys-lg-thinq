// -----------------------------------------------------------------------------
// Building a Gladys device out of a ThinQ appliance.
//
// One LG appliance + its profile -> one Gladys device with N features, plus the
// codecs needed to move values in both directions. The result is a plain
// object (a "device model") the registry keeps in memory and the SDK handlers
// look up when Gladys polls or sends a command.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_FEATURE_CATEGORIES } from '@gladysassistant/integration-sdk';
import { deviceTypeSlug } from '../thinq/deviceTypes.js';
import { buildControlPayload, flattenProfile, humanize, readStateValue } from './profile.js';
import { mapProperty } from './featureMap.js';

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

/** Numeric bounds declared by the profile for a range property. */
function boundsOf(descriptor) {
  const range = descriptor.writeValues ?? descriptor.readValues;
  if (!range || Array.isArray(range) || typeof range !== 'object') {
    return {};
  }
  const bounds = {};
  if (Number.isFinite(range.min)) {
    bounds.min = range.min;
  }
  if (Number.isFinite(range.max)) {
    bounds.max = range.max;
  }
  return bounds;
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

    features.push({
      name: descriptor.location ? `${shape.name} (${humanize(descriptor.location)})` : shape.name,
      external_id: externalId,
      category: shape.category,
      type: shape.type,
      ...(shape.unit ? { unit: shape.unit } : {}),
      ...boundsOf(descriptor),
      ...(shape.min !== undefined ? { min: shape.min } : {}),
      ...(shape.max !== undefined ? { max: shape.max } : {}),
      read_only: !writable,
      has_feedback: writable && descriptor.readable,
      keep_history: true,
    });

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
      poll_frequency: config.poll_frequency,
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
