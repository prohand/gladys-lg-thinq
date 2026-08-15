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

/**
 * Value domain published when the profile declares none.
 *
 * Gladys stores `min`/`max` as NOT NULL columns (see `featureBounds()` in
 * builder.js), so a numeric feature always has to declare a domain — and LG
 * only declares one for `range` properties. The unit is the best hint left: a
 * percentage runs from 0 to 100 whatever the appliance, a room temperature
 * never reaches 1000 °C.
 */
const DEFAULT_BOUNDS_BY_UNIT = {
  [DEVICE_FEATURE_UNITS.CELSIUS]: { min: -50, max: 100 },
  [DEVICE_FEATURE_UNITS.FAHRENHEIT]: { min: -58, max: 212 },
  [DEVICE_FEATURE_UNITS.PERCENT]: { min: 0, max: 100 },
  [DEVICE_FEATURE_UNITS.PPM]: { min: 0, max: 5000 },
  [DEVICE_FEATURE_UNITS.MICROGRAM_PER_CUBIC_METER]: { min: 0, max: 1000 },
  [DEVICE_FEATURE_UNITS.SECONDS]: { min: 0, max: 59 },
  [DEVICE_FEATURE_UNITS.MINUTES]: { min: 0, max: 59 },
  [DEVICE_FEATURE_UNITS.HOURS]: { min: 0, max: 24 },
  [DEVICE_FEATURE_UNITS.DAYS]: { min: 0, max: 366 },
  [DEVICE_FEATURE_UNITS.MONTHS]: { min: 0, max: 12 },
};

/** Domains that come from the category rather than from a unit. */
const DEFAULT_BOUNDS_BY_CATEGORY = {
  // Gladys' AQI scale, the one the dashboard widget colours.
  [DEVICE_FEATURE_CATEGORIES.AIRQUALITY_SENSOR]: { min: 0, max: 500 },
  // A lifetime counter only ever grows and LG declares no ceiling; the number
  // here exists because Gladys demands one, and is high enough that no washer
  // reaches it before the drum gives up.
  [DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR]: { min: 0, max: 1000000 },
};

/**
 * "We have no idea what this value can be": a read-only reading with no unit
 * and no declared range. Saying 0-0 is at least honest — inventing a ceiling
 * would show a wrong scale on the dashboard.
 */
const UNKNOWN_BOUNDS = { min: 0, max: 0 };

/**
 * Fallback domain of a numeric feature, used when the ThinQ profile declares
 * no range for the property.
 *
 * @param {object} shape the feature shape returned by `mapProperty()`
 * @returns {{min: number, max: number}} bounds, never undefined
 */
export function defaultBounds(shape) {
  return (
    DEFAULT_BOUNDS_BY_UNIT[shape.unit] ??
    DEFAULT_BOUNDS_BY_CATEGORY[shape.category] ??
    UNKNOWN_BOUNDS
  );
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

/** The `type`s a ThinQ profile uses for a numeric property. */
const NUMERIC_VALUE_TYPES = new Set(['range', 'number']);

/** Resources holding durations: `timer`, and the air conditioner `sleepTimer`. */
const TIMER_RESOURCE_PATTERN = /timer$/i;

/** The grain a timer property counts in — also the name of its unit. */
const TIMER_GRAIN_PATTERN = /(Hour|Minute|Second)/;

/** The timers of the cycle in progress, the ones worth showing by default. */
const CYCLE_TIMER_PATTERN = /^(remain|total)(Hour|Minute|Second)$/;

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

  // --- timers --------------------------------------------------------------
  // Every timer property is a duration: how long is left on the running cycle
  // (`remainMinute`), and the delayed start/stop knobs LG models as offsets
  // (`relativeHourToStop`, `absoluteMinuteToStart`, the AC's `sleepTimer`).
  // They all carry their grain in their name, which is also their unit.
  ({ resource, property, unit, valueType, writable }) => {
    if (!TIMER_RESOURCE_PATTERN.test(resource) || !NUMERIC_VALUE_TYPES.has(valueType)) {
      return null;
    }
    const grain = property.match(TIMER_GRAIN_PATTERN)?.[1];
    if (!grain) {
      return null;
    }
    return {
      name: humanize(property),
      category: DEVICE_FEATURE_CATEGORIES.DURATION,
      // Gladys renders a slider for `duration`/`decimal` and a plain read-out
      // for `duration`/`integer`: a settable offset needs the former to be
      // settable at all, a countdown reads better without decimals.
      type: writable
        ? DEVICE_FEATURE_TYPES.DURATION.DECIMAL
        : DEVICE_FEATURE_TYPES.DURATION.INTEGER,
      unit: toGladysUnit(unit ?? grain),
      kind: 'number',
      // Only the running cycle is worth a dashboard row by default; the
      // scheduling offsets are noise until the user asks for everything.
      optional: !CYCLE_TIMER_PATTERN.test(property),
    };
  },

  // --- counters ------------------------------------------------------------
  // `cycleCount`, `totalWashingCount`... — a reading that only goes up.
  ({ property, valueType, writable }) =>
    /Count$/.test(property) && !writable && NUMERIC_VALUE_TYPES.has(valueType)
      ? {
          name: humanize(property),
          category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
          type: SENSOR.INTEGER,
          kind: 'number',
          optional: true,
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

  // Any other number is a knob whose meaning we cannot guess (a wind step, a
  // cooking level). It is only exposed when the user asks for everything, and
  // it lands in the one pair Gladys defines for "no idea what this is":
  // `unknown`/`unknown`. The type matters — the front-end reads its label and
  // its icon from the category/type PAIR, and `unknown` only declares `unknown`
  // and `binary`, so any other type renders a nameless, iconless feature. The
  // value is still shown and historized; writing one goes through the
  // "Send a command" action, which reaches every property anyway.
  if (NUMERIC_VALUE_TYPES.has(valueType)) {
    return {
      name: humanize(property),
      category: DEVICE_FEATURE_CATEGORIES.UNKNOWN,
      type: DEVICE_FEATURE_TYPES.UNKNOWN.UNKNOWN,
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
