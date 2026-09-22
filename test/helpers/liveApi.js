// -----------------------------------------------------------------------------
// ThinqApi stand-in whose appliances CHANGE between two reads: what the scene
// triggers and the widgets are about. `setState` / `setOffline` move an
// appliance, the next `getDeviceState` reports it.
// -----------------------------------------------------------------------------

import { ThinqApiError, THINQ_ERROR_CODES } from '../../src/thinq/errors.js';

export function createLiveApi(fixtures) {
  const states = new Map(fixtures.map((f) => [f.device.deviceId, structuredClone(f.state)]));
  const offline = new Set();
  const controls = [];
  const stateReads = [];

  return {
    region: 'eic',
    controls,
    stateReads,
    setState(deviceId, state) {
      states.set(deviceId, state);
    },
    setOffline(deviceId, isOffline) {
      if (isOffline) {
        offline.add(deviceId);
      } else {
        offline.delete(deviceId);
      }
    },
    async getDevices() {
      return fixtures.map((f) => f.device);
    },
    async getDeviceProfile(deviceId) {
      return fixtures.find((f) => f.device.deviceId === deviceId).profile;
    },
    async getDeviceState(deviceId) {
      stateReads.push(deviceId);
      if (offline.has(deviceId)) {
        throw new ThinqApiError(THINQ_ERROR_CODES.NOT_CONNECTED_DEVICE, 'off', 400);
      }
      return states.get(deviceId);
    },
    async controlDevice(deviceId, payload) {
      controls.push({ deviceId, payload });
      return {};
    },
  };
}
