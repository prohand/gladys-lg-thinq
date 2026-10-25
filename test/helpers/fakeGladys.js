// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the only surface the integration relies on:
//   - externalIds(type, platformId) -> { device, feature(key) }
//   - publishState / publishStates    -> recorded so tests can assert them
//   - publishChangedStates            -> same, skipping unchanged values like the SDK
//   - forgetPublishedStates           -> clears that memory, like the SDK
//   - publishDiscoveredDevices        -> recorded so tests can assert them
//   - publishTransports               -> recorded so tests can assert them
//   - setConnectionStatus             -> recorded so tests can assert them
//   - publishSceneEvent               -> recorded so tests can assert them
//   - requestWidgetRefresh            -> recorded so tests can assert them
//   - devices                         -> the appliances the user added
// This lets us test the mapping and the dispatch without a running Gladys
// server, a WebSocket, or an LG account.
// -----------------------------------------------------------------------------

export function createFakeGladys({ selector = 'lg-thinq', devices } = {}) {
  const published = [];
  const discovered = [];
  const transports = [];
  const connectionStatuses = [];
  const sceneEvents = [];
  const widgetRefreshes = [];
  const lastPublished = new Map();

  return {
    published,
    discovered,
    transports,
    connectionStatuses,
    sceneEvents,
    widgetRefreshes,
    // The devices the user actually added, as the SDK keeps them. Left
    // undefined by default: "the SDK has not synchronized that list yet".
    ...(devices === undefined ? {} : { devices }),

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

    // Mirrors the SDK: an entry equal to the last value published through it
    // is skipped, unless the heartbeat is due.
    async publishChangedStates(states, { heartbeat } = {}) {
      const changed = states.filter((s) => {
        const value = s.text !== undefined ? `t:${s.text}` : `s:${s.state}`;
        const last = lastPublished.get(s.device_feature_external_id);
        if (last && last.value === value && !(heartbeat && Date.now() - last.at >= heartbeat)) {
          return false;
        }
        lastPublished.set(s.device_feature_external_id, { value, at: Date.now() });
        return true;
      });
      await this.publishStates(changed);
      return { success: true, count: changed.length };
    },

    forgetPublishedStates(externalId) {
      for (const id of [...lastPublished.keys()]) {
        if (externalId === undefined || id === externalId || id.startsWith(`${externalId}:`)) {
          lastPublished.delete(id);
        }
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

    async publishSceneEvent(key, data) {
      sceneEvents.push({ key, data });
    },

    requestWidgetRefresh(key) {
      widgetRefreshes.push(key);
    },
  };
}
