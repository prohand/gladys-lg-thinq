// -----------------------------------------------------------------------------
// LG ThinQ Connect — appliance types.
//
// The API returns `deviceInfo.deviceType` as `DEVICE_AIR_CONDITIONER`. Gladys
// external ids are built from a short, stable slug (`air-conditioner`), which
// is also what the feature mapper uses to pick the right Gladys category for
// ambiguous properties (a target temperature means "air conditioning" on an AC
// and "water heater" on a water heater).
// -----------------------------------------------------------------------------

/** Appliance families published by the ThinQ Connect API. */
export const THINQ_DEVICE_TYPES = {
  DEVICE_AIR_CONDITIONER: 'air-conditioner',
  DEVICE_AIR_PURIFIER: 'air-purifier',
  DEVICE_AIR_PURIFIER_FAN: 'air-purifier-fan',
  DEVICE_CEILING_FAN: 'ceiling-fan',
  DEVICE_COOKTOP: 'cooktop',
  DEVICE_DEHUMIDIFIER: 'dehumidifier',
  DEVICE_DISH_WASHER: 'dish-washer',
  DEVICE_DRYER: 'dryer',
  DEVICE_HOME_BREW: 'home-brew',
  DEVICE_HOOD: 'hood',
  DEVICE_HUMIDIFIER: 'humidifier',
  DEVICE_KIMCHI_REFRIGERATOR: 'kimchi-refrigerator',
  DEVICE_MICROWAVE_OVEN: 'microwave-oven',
  DEVICE_OVEN: 'oven',
  DEVICE_PLANT_CULTIVATOR: 'plant-cultivator',
  DEVICE_REFRIGERATOR: 'refrigerator',
  DEVICE_ROBOT_CLEANER: 'robot-cleaner',
  DEVICE_STICK_CLEANER: 'stick-cleaner',
  DEVICE_STYLER: 'styler',
  DEVICE_SYSTEM_BOILER: 'system-boiler',
  DEVICE_VENTILATOR: 'ventilator',
  DEVICE_WASHCOMBO_MAIN: 'washcombo-main',
  DEVICE_WASHCOMBO_MINI: 'washcombo-mini',
  DEVICE_WASHER: 'washer',
  DEVICE_WASHTOWER: 'washtower',
  DEVICE_WASHTOWER_DRYER: 'washtower-dryer',
  DEVICE_WASHTOWER_WASHER: 'washtower-washer',
  DEVICE_WATER_HEATER: 'water-heater',
  DEVICE_WATER_PURIFIER: 'water-purifier',
  DEVICE_WINE_CELLAR: 'wine-cellar',
};

/** Appliances whose target temperature is a room temperature setpoint. */
export const CLIMATE_DEVICE_TYPES = new Set(['air-conditioner', 'system-boiler']);

/** Appliances whose target temperature is a hot water setpoint. */
export const WATER_HEATER_DEVICE_TYPES = new Set(['water-heater']);

/**
 * Slug of a ThinQ device type. Unknown families (LG keeps adding some) fall
 * back to a slug derived from the raw value, so a new appliance still gets a
 * usable — and stable — external id instead of being dropped.
 * @param {string} thinqDeviceType e.g. 'DEVICE_AIR_CONDITIONER'
 */
export function deviceTypeSlug(thinqDeviceType) {
  const known = THINQ_DEVICE_TYPES[thinqDeviceType];
  if (known) {
    return known;
  }
  return (
    String(thinqDeviceType ?? '')
      .replace(/^DEVICE_/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'unknown'
  );
}
