// -----------------------------------------------------------------------------
// Gladys polling cadence.
//
// `device.poll_frequency` is NOT a free number: the host API validates it
// against a closed enum (`DEVICE_POLL_FREQUENCIES` in Gladys core), expressed
// in MILLISECONDS. Any other value is rejected with
// `devices[0].poll_frequency: invalid poll frequency`, and because discovery is
// published as one batch, a single bad value loses every appliance.
//
// The slowest cadence Gladys offers is one minute, while this integration wants
// a much slower default: LG meters API calls per client. So the device is
// registered at the scheduler's slowest tick and the integration throttles the
// ticks itself (see `DeviceRegistry.dueForPoll`).
// -----------------------------------------------------------------------------

import { DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';

/**
 * The values Gladys accepts, in milliseconds. The SDK mirrors the core's enum:
 * re-exported rather than copied, so a new cadence reaches this list by itself.
 */
export { DEVICE_POLL_FREQUENCIES };

/** Cadence every appliance is registered with: the slowest Gladys allows. */
export const SCHEDULER_POLL_FREQUENCY = DEVICE_POLL_FREQUENCIES.EVERY_MINUTES;

/** Is this a cadence the host API will accept? */
export function isValidPollFrequency(value) {
  return Object.values(DEVICE_POLL_FREQUENCIES).includes(value);
}
