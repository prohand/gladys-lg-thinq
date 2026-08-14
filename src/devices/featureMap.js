// -----------------------------------------------------------------------------
// LG ThinQ property -> Gladys feature mapping.
//
// A ThinQ profile is a bag of typed properties; a Gladys device is a list of
// features with a category, a type and a numeric state. This module is the
// translation layer, and the only place that needs editing when LG ships a
// property worth surfacing.
//
// It is deliberately RULE-BASED rather than a table of "one entry per appliance
// model": LG reuses the same property names across families (`currentJobMode`
// exists on an air conditioner, a dryer and a plant cultivator), so a handful
// of rules covers far more hardware than an enumeration would — including
// appliances released after this code was written.
//
// Each rule answers with:
//   - `skip: true`  the property is bookkeeping, not a feature (a unit, a
//                   bound already folded into another feature);
//   - a feature descriptor `{ name, category, type, unit, kind }`, where `kind`
//     picks the codec used to move values between LG and Gladys:
//       'number'  numeric state           (temperatures, percentages, timers)
//       'binary'  0/1 state               (power, boolean flags, door open)
//       'text'    free-text state         (job mode, run state, error)
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { humanize } from './profile.js';
import { CLIMATE_DEVICE_TYPES, WATER_HEATER_DEVICE_TYPES } from '../thinq/deviceTypes.js';

/** Enum values LG uses for "on". Order matters: first match wins. */
const ON_VALUES = ['POWER_ON', 'ON', 'TRUE', 'ENABLE', 'ENABLED', 'START'];

/** Enum values LG uses for "off". */
const OFF_VALUES = ['POWER_OFF', 'OFF', 'FALSE', 'DISABLE', 'DISABLED', 'STOP'];

/** ThinQ unit strings -> Gladys units. */
const UNITS = {
  C: DEVICE_FEATURE_UNITS.CELSIUS,
  F: DEVICE_FEATURE_UNITS.FAHRENHEIT,
  '%': DEVICE_FEATURE_UNITS.PERCENT,
  PERCENT: DEVICE_FEATURE_UNITS.PERCENT,
  HOUR: DEVICE_FEATURE_UNITS.HOURS,
  MINUTE: DEVICE_FEATURE_UNITS.MINUTES,
  SECOND: DEVICE_FEATURE_UNITS.SECONDS,
  DAY: DEVICE_FEATURE_UNITS.DAYS,
  MONTH: DEVICE_FEATURE_UNITS.MONTHS,
};

/** Translate a ThinQ unit, or `undefined` when we have no equivalent. */
export function toGladysUnit(thinqUnit) {
  if (!thinqUnit) {
    return undefined;
  }
  return UNITS[String(thinqUnit).toUpperCase()] ?? undefined;
}

/** Properties that describe other properties — never features of their own. */
const BOOKKEEPING_PROPERTIES = new Set([
  'unit',
  'temperatureUnit',
  'twoSetTemperatureUnit',
  'hotWaterTemperatureUnit',
  'locationName',
]);

/** Bounds of a target temperature: folded into that feature's min/max. */
const TEMPERATURE_BOUND_PATTERN =
  /^(min|max)Target.*Temperature|^(cool|heat|roomAirCool|roomAirHeat|hotWater)(Min|Max)Temperature/;

const SENSOR = DEVICE_FEATURE_TYPES.SENSOR;

/** Category + type used for the appliance's main on/off switch. */
function powerFeatureShape(deviceType) {
  if (CLIMATE_DEVICE_TYPES.has(deviceType)) {
    return {
      category: DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING,
      type: DEVICE_FEATURE_TYPES.AIR_CONDITIONING.BINARY,
    };
  }
  if (WATER_HEATER_DEVICE_TYPES.has(deviceType)) {
    return {
      category: DEVICE_FEATURE_CATEGORIES.WATER_HEATER,
      type: DEVICE_FEATURE_TYPES.WATER_HEATER.BINARY,
    };
  }
  return { category: DEVICE_FEATURE_CATEGORIES.SWITCH, type: DEVICE_FEATURE_TYPES.SWITCH.BINARY };
}

/** Category + type used for a temperature setpoint. */
function targetTemperatureShape(deviceType) {
  if (CLIMATE_DEVICE_TYPES.has(deviceType)) {
    return {
      category: DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING,
      type: DEVICE_FEATURE_TYPES.AIR_CONDITIONING.TARGET_TEMPERATURE,
    };
  }
  if (WATER_HEATER_DEVICE_TYPES.has(deviceType)) {
    return {
      category: DEVICE_FEATURE_CATEGORIES.WATER_HEATER,
      type: DEVICE_FEATURE_TYPES.WATER_HEATER.TARGET_TEMPERATURE,
    };
  }
  return {
    category: DEVICE_FEATURE_CATEGORIES.THERMOSTAT,
    type: DEVICE_FEATURE_TYPES.THERMOSTAT.TARGET_TEMPERATURE,
  };
}

/**
 * Look for an on/off pair in the values a property accepts. Returns empty
 * strings when there is none — a range (`{ min, max }`) never has one.
 */
function findOnOffPair(writeValues, readValues) {
  const values = [
    ...(Array.isArray(writeValues) ? writeValues : []),
    ...(Array.isArray(readValues) ? readValues : []),
  ].filter((value) => typeof value === 'string');

  return {
    onValue: ON_VALUES.find((candidate) => values.includes(candidate)),
    offValue: OFF_VALUES.find((candidate) => values.includes(candidate)),
  };
}

/**
 * Ordered rules. Each receives the flattened property descriptor plus the
 * appliance slug, and returns `null` when it does not apply.
 */
const RULES = [
  // --- bookkeeping ---------------------------------------------------------
  ({ property }) => (BOOKKEEPING_PROPERTIES.has(property) ? { skip: true } : null),
  ({ property }) => (TEMPERATURE_BOUND_PATTERN.test(property) ? { skip: true } : null),

  // --- temperatures --------------------------------------------------------
  ({ property, unit }) =>
    /^(current|roomAirCurrent|hotWaterCurrent).*Temperature[CF]?$/.test(property)
      ? {
          name: humanize(property.replace(/[CF]$/, '')),
          category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
          type: SENSOR.DECIMAL,
          unit: toGladysUnit(unit ?? property.slice(-1)),
          kind: 'number',
        }
      : null,
  ({ property, unit }, deviceType) =>
    /Target.*Temperature[CF]?$|^targetTemperature[CF]?$/.test(property)
      ? {
          name: humanize(property.replace(/[CF]$/, '')),
          ...targetTemperatureShape(deviceType),
          unit: toGladysUnit(unit ?? property.slice(-1)),
          kind: 'number',
        }
      : null,

  // --- air quality ---------------------------------------------------------
  ({ resource, property }) =>
    resource === 'airQualitySensor' && property === 'PM2'
      ? {
          name: 'PM2.5',
          category: DEVICE_FEATURE_CATEGORIES.PM25_SENSOR,
          type: SENSOR.INTEGER,
          unit: DEVICE_FEATURE_UNITS.MICROGRAM_PER_CUBIC_METER,
          kind: 'number',
        }
      : null,
  ({ resource, property }) =>
    resource === 'airQualitySensor' && property === 'PM10'
      ? {
          name: 'PM10',
          category: DEVICE_FEATURE_CATEGORIES.PM10_SENSOR,
          type: SENSOR.INTEGER,
          unit: DEVICE_FEATURE_UNITS.MICROGRAM_PER_CUBIC_METER,
          kind: 'number',
        }
      : null,
  ({ property }) =>
    property === 'totalPollution'
      ? {
          name: 'Air quality',
          category: DEVICE_FEATURE_CATEGORIES.AIRQUALITY_SENSOR,
          type: DEVICE_FEATURE_TYPES.AIRQUALITY_SENSOR.AQI,
          kind: 'number',
        }
      : null,
  ({ property }) =>
    property === 'CO2'
      ? {
          name: 'CO2',
          category: DEVICE_FEATURE_CATEGORIES.CO2_SENSOR,
          type: SENSOR.INTEGER,
          unit: DEVICE_FEATURE_UNITS.PPM,
          kind: 'number',
        }
      : null,

  // --- humidity ------------------------------------------------------------
  ({ property, valueType }) =>
    /^(humidity|currentHumidity)$/.test(property) && valueType !== 'enum'
      ? {
          name: 'Humidity',
          category: DEVICE_FEATURE_CATEGORIES.HUMIDITY_SENSOR,
          type: SENSOR.INTEGER,
          unit: DEVICE_FEATURE_UNITS.PERCENT,
          kind: 'number',
        }
      : null,

  // --- filters -------------------------------------------------------------
  ({ property }) =>
    /FilterRemainPercent$|^filterRemainPercent$/.test(property)
      ? {
          name: humanize(property),
          category: DEVICE_FEATURE_CATEGORIES.HEPA_FILTER_MONITORING,
          type: SENSOR.INTEGER,
          unit: DEVICE_FEATURE_UNITS.PERCENT,
          kind: 'number',
        }
      : null,

  // --- battery -------------------------------------------------------------
  ({ resource, property }) =>
    resource === 'battery' && property === 'percent'
      ? {
          name: 'Battery',
          category: DEVICE_FEATURE_CATEGORIES.BATTERY,
          type: DEVICE_FEATURE_TYPES.BATTERY.INTEGER,
          unit: DEVICE_FEATURE_UNITS.PERCENT,
          kind: 'number',
        }
      : null,

  // --- doors ---------------------------------------------------------------
  ({ property }) =>
    property === 'doorState'
      ? {
          name: 'Door',
          category: DEVICE_FEATURE_CATEGORIES.OPENING_SENSOR,
          type: SENSOR.BINARY,
          kind: 'binary',
          onValue: 'OPEN',
          offValue: 'CLOSE',
        }
      : null,

  // --- cycle timers (how long is left on the wash/dry) ---------------------
  ({ resource, property, unit }) =>
    resource === 'timer' && /^(remain|total)(Hour|Minute|Second)$/.test(property)
      ? {
          name: humanize(property),
          category: DEVICE_FEATURE_CATEGORIES.DURATION,
          type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
          unit: toGladysUnit(unit ?? property.replace(/^(remain|total)/, '')),
          kind: 'number',
        }
      : null,

  // --- power / operation ---------------------------------------------------
  // Every `operation` property whose writable values carry an on/off pair is
  // the appliance's power switch. Anything else in `operation` is a mode.
  ({ resource, writeValues, readValues }, deviceType) => {
    if (resource !== 'operation') {
      return null;
    }
    const { onValue, offValue } = findOnOffPair(writeValues, readValues);
    if (!onValue || !offValue) {
      return null;
    }
    return { name: 'On/Off', ...powerFeatureShape(deviceType), kind: 'binary', onValue, offValue };
  },
];

/** Generic fallbacks, applied when no rule matched. */
function fallbackFeature(descriptor) {
  const { valueType, writeValues, readValues, property, unit } = descriptor;

  // A real boolean is always a switch.
  if (valueType === 'boolean') {
    return {
      name: humanize(property),
      category: DEVICE_FEATURE_CATEGORIES.SWITCH,
      type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
      kind: 'binary',
      onValue: true,
      offValue: false,
    };
  }

  // An enum carrying an on/off pair behaves like a switch too (LG models a lot
  // of options that way: `ENABLE`/`DISABLE`, `ON`/`OFF`...).
  if (valueType === 'enum') {
    const { onValue, offValue } = findOnOffPair(writeValues, readValues);
    if (onValue && offValue) {
      return {
        name: humanize(property),
        category: DEVICE_FEATURE_CATEGORIES.SWITCH,
        type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
        kind: 'binary',
        onValue,
        offValue,
      };
    }
  }

  // Any other readable enum/string is surfaced as text: a job mode, a run
  // state, a course name. Gladys shows it and keeps its history, and scenes
  // can trigger on it — which is most of what these are good for.
  if (valueType === 'enum' || valueType === 'string' || valueType === 'list') {
    return {
      name: humanize(property),
      category: DEVICE_FEATURE_CATEGORIES.TEXT,
      type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
      kind: 'text',
    };
  }

  // Remaining numbers are mostly scheduling knobs (absoluteHourToStart...).
  // They are only exposed when the user asks for everything.
  if (valueType === 'range' || valueType === 'number') {
    return {
      name: humanize(property),
      category: DEVICE_FEATURE_CATEGORIES.UNKNOWN,
      type: SENSOR.DECIMAL,
      unit: toGladysUnit(unit),
      kind: 'number',
      optional: true,
    };
  }

  return null;
}

/**
 * Map one flattened profile property to a Gladys feature shape.
 *
 * @param {object} descriptor from `flattenProfile()`
 * @param {string} deviceType appliance slug, e.g. 'air-conditioner'
 * @returns {object|null} `{ skip }`, a feature shape, or null when unmappable
 */
export function mapProperty(descriptor, deviceType) {
  for (const rule of RULES) {
    const result = rule(descriptor, deviceType);
    if (result) {
      return result;
    }
  }
  return fallbackFeature(descriptor);
}
