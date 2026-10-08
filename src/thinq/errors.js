// -----------------------------------------------------------------------------
// LG ThinQ Connect — error handling.
//
// The API answers errors with a stable numeric code inside the JSON body:
//   { "error": { "code": "1218", "message": "Invalid token" } }
// The HTTP status alone is not enough to decide what to do (a 400 can mean
// "bad token" or "the appliance is off"), so we keep the code and expose a few
// helpers the integration reasons on.
//
// Not every refusal carries that body, though: a gateway or a proxy in front of
// the API answers a bare 401/403/429 (an HTML page, or nothing). The client then
// falls back on the HTTP status as the code, and those statuses are read for
// what they unambiguously mean.
// -----------------------------------------------------------------------------

/** The error codes the integration actually branches on. */
export const THINQ_ERROR_CODES = {
  INVALID_TOKEN: '1103',
  NOT_REGISTERED_USER: '1202',
  NOT_EXIST_DEVICE: '1205',
  NOT_OWNED_DEVICE: '1212',
  NOT_CONNECTED_DEVICE: '1222',
  INVALID_STATUS_DEVICE: '1223',
  INVALID_TOKEN_AGAIN: '1218',
  NOT_ACCEPTABLE_TERMS: '1304',
  EXCEEDED_API_CALLS: '1306',
  NOT_SUPPORTED_COUNTRY: '1307',
  NO_CONTROL_AUTHORITY: '1308',
  COMMAND_NOT_SUPPORTED_IN_REMOTE_OFF: '2301',
  COMMAND_NOT_SUPPORTED_IN_STATE: '2302',
  COMMAND_NOT_SUPPORTED_IN_ERROR: '2303',
  COMMAND_NOT_SUPPORTED_IN_POWER_OFF: '2304',
  COMMAND_NOT_SUPPORTED_IN_MODE: '2305',
};

/** Codes that mean "the credentials/account are wrong", not "try again later". */
const AUTH_ERROR_CODES = new Set([
  THINQ_ERROR_CODES.INVALID_TOKEN,
  THINQ_ERROR_CODES.INVALID_TOKEN_AGAIN,
  THINQ_ERROR_CODES.NOT_REGISTERED_USER,
  THINQ_ERROR_CODES.NOT_ACCEPTABLE_TERMS,
  THINQ_ERROR_CODES.NOT_SUPPORTED_COUNTRY,
]);

/** Codes that mean "the appliance is unplugged / off the network right now". */
const OFFLINE_ERROR_CODES = new Set([
  THINQ_ERROR_CODES.NOT_CONNECTED_DEVICE,
  THINQ_ERROR_CODES.INVALID_STATUS_DEVICE,
]);

/** HTTP status of a throttled request: "Too Many Requests". */
const RATE_LIMITED_HTTP_STATUS = 429;

export class ThinqApiError extends Error {
  /**
   * @param {string} code ThinQ error code (e.g. '1218')
   * @param {string} message message returned by the API
   * @param {number} status HTTP status
   */
  constructor(code, message, status) {
    super(`LG ThinQ API error ${code}: ${message}`);
    this.name = 'ThinqApiError';
    this.code = code;
    this.status = status;
  }

  /** Wrong token, wrong country, terms not accepted: the user must act. */
  get isAuthError() {
    if (AUTH_ERROR_CODES.has(this.code)) {
      return true;
    }
    // A 403 WITH a ThinQ code can be about one appliance (no control
    // authority, not owned): only a bare 401/403 says the token itself is
    // refused. A 401 is always about the credentials.
    return this.status === 401 || (this.status === 403 && !this.hasThinqCode);
  }

  /** The appliance itself is unreachable — the integration is fine. */
  get isDeviceOffline() {
    return OFFLINE_ERROR_CODES.has(this.code);
  }

  /** Too many calls: back off instead of hammering the API. */
  get isRateLimited() {
    return (
      this.code === THINQ_ERROR_CODES.EXCEEDED_API_CALLS || this.status === RATE_LIMITED_HTTP_STATUS
    );
  }

  /**
   * Did the API name the problem? Without a JSON error body the client uses the
   * HTTP status as the code (see `ThinqApi.request`).
   */
  get hasThinqCode() {
    return this.code !== undefined && this.code !== String(this.status);
  }
}
