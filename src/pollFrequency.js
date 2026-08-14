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

/** The values Gladys accepts, in milliseconds. */
export const DEVICE_POLL_FREQUENCIES = {
  EVERY_SECONDS: 1 * 1000,
  EVERY_2_SECONDS: 2 * 1000,
  EVERY_10_SECONDS: 10 * 1000,
  EVERY_15_SECONDS: 15 * 1000,
  EVERY_30_SECONDS: 30 * 1000,
  EVERY_MINUTES: 60 * 1000,
};

/** Cadence every appliance is registered with: the slowest Gladys allows. */
export const SCHEDULER_POLL_FREQUENCY = DEVICE_POLL_FREQUENCIES.EVERY_MINUTES;

/** Is this a cadence the host API will accept? */
export function isValidPollFrequency(value) {
  return Object.values(DEVICE_POLL_FREQUENCIES).includes(value);
}
