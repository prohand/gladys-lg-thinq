// -----------------------------------------------------------------------------
// Entry point of the LG ThinQ integration for Gladys Assistant.
//
// This file wires the SDK to the device registry (src/devices/) and to the
// runtime (src/runtime.js: configuration, refresh loop, status), and holds no
// appliance logic:
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. connects, discovers the LG appliances and publishes them.
//
// Environment variables injected by the Gladys supervisor:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { DeviceRegistry } from './src/devices/index.js';
import { createRuntime } from './src/runtime.js';
import { ACTIONS } from './src/actions.js';
import { SCENE_ACTIONS } from './src/sceneActions.js';
import { WIDGETS } from './src/widgets.js';

const gladys = new GladysIntegration();
// When a read changes what an appliance displays (connection, run state,
// mode), the widgets are asked to re-pull their content instead of waiting
// for it to expire. The core rate-limits the nudge, nothing to throttle here.
const registry = new DeviceRegistry({
  onChange: () => {
    for (const key of Object.keys(WIDGETS)) {
      gladys.requestWidgetRefresh(key);
    }
  },
});

// Configuration, initialization, refresh loop and status (src/runtime.js).
const runtime = createRuntime(gladys, { registry });

// --- Discovery: Gladys asks for the list of appliances -----------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> reading the LG ThinQ account');
  // An explicit scan: the profiles are read again too (a firmware update can
  // change what an appliance reports). Reconnections reuse the cached ones.
  const devices = await registry.discover(gladys, runtime.config, { refreshProfiles: true });
  await gladys.publishDiscoveredDevices(devices);
  await runtime.publishTransports();
});

// --- Command: the user acts on a controllable feature ------------------------
gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
  await registry.setValue(gladys, { device, feature, value });
});

// --- Polling: Gladys asks to refresh one appliance ---------------------------
// Gladys ticks every minute (its slowest cadence); the refresh interval chosen
// by the user is usually slower, so most ticks are dropped here.
gladys.onPoll(async (device) => {
  const model = registry.findModel(device);
  if (!model) {
    logger.debug(`onPoll ignored, unknown device ${device.external_id}`);
    return;
  }
  if (!registry.dueForPoll(model)) {
    logger.debug(
      `onPoll skipped, ${model.name} was read less than ${runtime.config.poll_frequency}s ago`,
    );
    return;
  }
  await registry.pollModel(gladys, model);
  await runtime.publishTransports();
});

// --- The user adds a discovered appliance ------------------------------------
// Discovery publishes what an appliance CAN report; its values only arrive with
// a poll, and the next one can be a whole refresh interval away. Reading the
// appliance right now is what fills its features immediately, instead of
// leaving the dashboard on "no recent value" for minutes after the add.
gladys.onDeviceCreated(async (device) => {
  logger.info(`onDeviceCreated -> ${device.external_id}`);
  if (await registry.pollNewDevice(gladys, device)) {
    await runtime.publishTransports();
  }
});

// --- The user updates an appliance -------------------------------------------
// "Update" in the Discovery tab can add features; Gladys dropped every state
// sent to them before they existed. The last read is published again (no LG
// call), or the appliance is read when there is none.
gladys.onDeviceUpdated(async (device) => {
  logger.info(`onDeviceUpdated -> ${device.external_id}`);
  if (await registry.republishDevice(gladys, device)) {
    await runtime.publishTransports();
  }
});

// --- Manifest actions: buttons in the Configuration screen -------------------
for (const [key, handler] of Object.entries(ACTIONS)) {
  gladys.onAction(key, (fields) => handler(gladys, { registry, config: runtime.config, fields }));
}

// --- Scene actions: run by a scene of the user ------------------------------
// The scene triggers need no handler: the registry fires them from the reads.
for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
  gladys.onSceneAction(key, async (fields) => {
    const outputs = await handler(gladys, { registry, fields });
    await runtime.publishTransports();
    return outputs;
  });
}

// --- Dashboard widgets --------------------------------------------------------
for (const [key, widget] of Object.entries(WIDGETS)) {
  gladys.onWidgetGet(key, ({ settings }) =>
    widget.get(gladys, { registry, config: runtime.config, settings }),
  );
  gladys.onWidgetAction(key, async (actionKey, params, { settings }) => {
    const message = await widget.action(gladys, { registry, actionKey, params, settings });
    await runtime.publishTransports();
    return message;
  });
}

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  runtime.setConfig(newConfig);
  await runtime.initialize();
});

// --- Connection lifecycle ----------------------------------------------------
// The SDK logs the WebSocket lifecycle itself (under the `gladys-sdk` name):
// these handlers only run the integration's own (re)initialization, and pause
// the refresh loop while Gladys is away.
gladys.on('connected', () => runtime.onConnected());
gladys.on('disconnected', () => runtime.onDisconnected());

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  runtime.stopRefreshLoop();
});

// --- Safety net --------------------------------------------------------------
// Every handler above reports its own failures, but a rejection that slips
// through one (an SDK call made from a timer, a future handler) would make
// Node 15+ kill the process: one lost promise must not stop the refreshes of
// every appliance. It is logged, loudly, so the bug still gets fixed.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason);
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the LG ThinQ integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
