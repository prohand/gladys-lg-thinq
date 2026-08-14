// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the only surface the integration relies on:
//   - externalIds(type, platformId) -> { device, feature(key) }
//   - publishState / publishStates    -> recorded so tests can assert them
//   - publishDiscoveredDevices        -> recorded so tests can assert them
//   - publishTransports               -> recorded so tests can assert them
//   - setConnectionStatus             -> recorded so tests can assert them
// This lets us test the mapping and the dispatch without a running Gladys
// server, a WebSocket, or an LG account.
// -----------------------------------------------------------------------------

export function createFakeGladys({ selector = 'lg-thinq' } = {}) {
  const published = [];
  const discovered = [];
  const transports = [];
  const connectionStatuses = [];

  return {
    published,
    discovered,
    transports,
    connectionStatuses,

    externalIds(type, platformId) {
      const device = `ext:${selector}:${type}:${platformId}`;
      return {
        device,
        feature: (key) => `${device}:${key}`,
      };
    },

    async publishState(featureExternalId, state) {
      published.push({ featureExternalId, state });
    },

    async publishStates(states) {
      for (const s of states) {
        published.push({
          featureExternalId: s.device_feature_external_id,
          ...(s.text !== undefined ? { text: s.text } : { state: s.state }),
        });
      }
    },

    async publishDiscoveredDevices(devices) {
      discovered.push(...devices);
    },

    async publishTransports(entries) {
      transports.push(...entries);
    },

    async setConnectionStatus(connected, message) {
      connectionStatuses.push({ connected, message });
    },
  };
}
