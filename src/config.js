// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys, from the `config_schema` of
// `gladys-assistant-integration.json`. The SDK fetches it (`getConfig()`) and
// notifies every change (`onConfigUpdated()`); this module only provides the
// defaults and normalizes types, so the rest of the code never deals with
// `undefined` or with a number that arrived as a string.
// -----------------------------------------------------------------------------

// These MUST stay consistent with the `default` values of the manifest.
export const DEFAULT_CONFIG = {
  // Personal Access Token generated on the LG ThinQ developer site.
  access_token: '',
  // ISO 3166-1 alpha-2 country of the LG account: it selects the API region.
  country_code: 'FR',
  // How often each appliance is read, in seconds. The ThinQ API meters calls
  // per client, so keep it comfortable: one call per appliance per cycle.
  poll_frequency: 300,
  // Which of LG's duplicated Celsius/Fahrenheit properties to publish.
  temperature_unit: 'celsius',
  // Publish every numeric property of the profile, including the scheduling
  // knobs most people never look at (absoluteHourToStart, cycleCount...).
  expose_all_properties: false,
};

/**
 * Merge the user configuration with the defaults and force the types.
 * @param {Record<string, unknown>} raw configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    access_token: String(raw.access_token ?? DEFAULT_CONFIG.access_token).trim(),
    country_code: String(raw.country_code ?? DEFAULT_CONFIG.country_code)
      .trim()
      .toUpperCase(),
    poll_frequency: Number(raw.poll_frequency ?? DEFAULT_CONFIG.poll_frequency),
    temperature_unit:
      raw.temperature_unit === 'fahrenheit' ? 'fahrenheit' : DEFAULT_CONFIG.temperature_unit,
    expose_all_properties: raw.expose_all_properties === true,
  };
}

/** Is the configuration complete enough to talk to LG? */
export function isConfigured(config) {
  return Boolean(config.access_token && config.country_code);
}
