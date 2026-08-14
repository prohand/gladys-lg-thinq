// -----------------------------------------------------------------------------
// LG ThinQ Connect — country to region routing.
//
// The ThinQ Connect Open API is regional: the host is derived from the country
// of the LG account (`https://api-<region>.lgthinq.com`). Calling the wrong
// region answers with a NOT_SUPPORTED_COUNTRY / NOT_REGISTERED_USER error, so
// the mapping has to be exact.
//
// Source of truth: the country table shipped with LG's own SDK
// (`thinqconnect/country.py`, Apache-2.0).
// -----------------------------------------------------------------------------

/** Korea / Asia-Pacific. */
const KIC = [
  'AU',
  'BD',
  'CN',
  'HK',
  'ID',
  'IN',
  'JP',
  'KH',
  'KR',
  'LA',
  'LK',
  'MM',
  'MY',
  'NP',
  'NZ',
  'PH',
  'SG',
  'TH',
  'TW',
  'VN',
];

/** Americas. */
const AIC = [
  'AG',
  'AR',
  'AW',
  'BB',
  'BO',
  'BR',
  'BS',
  'BZ',
  'CA',
  'CL',
  'CO',
  'CR',
  'CU',
  'DM',
  'DO',
  'EC',
  'GD',
  'GT',
  'GY',
  'HN',
  'HT',
  'JM',
  'KN',
  'LC',
  'MX',
  'NI',
  'PA',
  'PE',
  'PR',
  'PY',
  'SR',
  'SV',
  'TT',
  'US',
  'UY',
  'VC',
  'VE',
];

/** Europe, Middle East, Africa, Central Asia. */
const EIC = [
  'AE',
  'AF',
  'AL',
  'AM',
  'AO',
  'AT',
  'AZ',
  'BA',
  'BE',
  'BF',
  'BG',
  'BH',
  'BJ',
  'BY',
  'CD',
  'CF',
  'CG',
  'CH',
  'CI',
  'CM',
  'CV',
  'CY',
  'CZ',
  'DE',
  'DJ',
  'DK',
  'DZ',
  'EE',
  'EG',
  'ES',
  'ET',
  'FI',
  'FR',
  'GA',
  'GB',
  'GE',
  'GH',
  'GM',
  'GN',
  'GQ',
  'GR',
  'HR',
  'HU',
  'IE',
  'IL',
  'IQ',
  'IR',
  'IS',
  'IT',
  'JO',
  'KE',
  'KG',
  'KW',
  'KZ',
  'LB',
  'LR',
  'LT',
  'LU',
  'LV',
  'LY',
  'MA',
  'MD',
  'ME',
  'MK',
  'ML',
  'MR',
  'MT',
  'MU',
  'MW',
  'NE',
  'NG',
  'NL',
  'NO',
  'OM',
  'PK',
  'PL',
  'PS',
  'PT',
  'QA',
  'RO',
  'RS',
  'RU',
  'RW',
  'SA',
  'SD',
  'SE',
  'SI',
  'SK',
  'SL',
  'SN',
  'SO',
  'ST',
  'SY',
  'TD',
  'TG',
  'TN',
  'TR',
  'TZ',
  'UA',
  'UG',
  'UZ',
  'XK',
  'YE',
  'ZA',
  'ZM',
];

const REGION_BY_COUNTRY = new Map([
  ...KIC.map((country) => [country, 'kic']),
  ...AIC.map((country) => [country, 'aic']),
  ...EIC.map((country) => [country, 'eic']),
]);

/** Every country code the ThinQ Connect API accepts, sorted. */
export const SUPPORTED_COUNTRIES = [...REGION_BY_COUNTRY.keys()].sort();

/**
 * Region hosting the LG account of a country.
 * @param {string} countryCode ISO 3166-1 alpha-2 code, e.g. 'FR'
 * @returns {'kic'|'aic'|'eic'}
 * @throws {Error} when the country is not covered by the ThinQ Connect API
 */
export function getRegionFromCountry(countryCode) {
  const region = REGION_BY_COUNTRY.get(String(countryCode).toUpperCase());
  if (!region) {
    throw new Error(`Country "${countryCode}" is not supported by the LG ThinQ Connect API`);
  }
  return region;
}
