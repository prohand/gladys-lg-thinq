// -----------------------------------------------------------------------------
// Entry point of the LG ThinQ integration for Gladys Assistant.
//
// This file wires the SDK to the device registry (src/devices/) and holds no
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
import { isConfigured, normalizeConfig } from './src/config.js';
import { DeviceRegistry } from './src/devices/index.js';
import { ACTIONS } from './src/actions.js';
import { ThinqApiError } from './src/thinq/errors.js';

const gladys = new GladysIntegration();
const registry = new DeviceRegistry();

// Current configuration (hot-reloaded through onConfigUpdated).
let config = normalizeConfig();

// --- Discovery: Gladys asks for the list of appliances -----------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> reading the LG ThinQ account');
  const devices = await registry.discover(gladys, config);
  await gladys.publishDiscoveredDevices(devices);
  await publishTransports();
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
    logger.debug(`onPoll skipped, ${model.name} was read less than ${config.poll_frequency}s ago`);
    return;
  }
  await registry.pollModel(gladys, model);
  await publishTransports();
});

// --- The user adds a discovered appliance ------------------------------------
// Discovery publishes what an appliance CAN report; its values only arrive with
// a poll, and the next one can be a whole refresh interval away. Reading the
// appliance right now is what fills its features immediately, instead of
// leaving the dashboard on "no recent value" for minutes after the add.
gladys.onDeviceCreated(async (device) => {
  logger.info(`onDeviceCreated -> ${device.external_id}`);
  if (await registry.pollNewDevice(gladys, device)) {
    await publishTransports();
  }
});

// --- Manifest actions: buttons in the Configuration screen -------------------
for (const [key, handler] of Object.entries(ACTIONS)) {
  gladys.onAction(key, (fields) => handler(gladys, { registry, config, fields }));
}

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  config = normalizeConfig(newConfig);
  await initialize();
});

// --- Connection lifecycle ----------------------------------------------------
// The SDK logs the WebSocket lifecycle itself (under the `gladys-sdk` name):
// these handlers only run the integration's own (re)initialization.
gladys.on('connected', async () => {
  try {
    config = normalizeConfig(await gladys.getConfig());
  } catch (err) {
    logger.error('Could not read the integration configuration', err);
    return;
  }
  await initialize();
});

/**
 * (Re)build everything that depends on the configuration: the API client, the
 * appliance list, the first read. Reports the outcome in the Configuration
 * screen instead of crashing — a wrong token is a user problem, not a bug.
 */
async function initialize() {
  if (!isConfigured(config)) {
    logger.warn('Waiting for the Personal Access Token and the country');
    await setStatus(false, {
      en: 'Enter your LG ThinQ Personal Access Token and your country to get started.',
      fr: "Renseignez votre jeton d'accès personnel LG ThinQ et votre pays pour commencer.",
    });
    return;
  }

  try {
    registry.configure(config);
    const devices = await registry.discover(gladys, config);
    await gladys.publishDiscoveredDevices(devices);
    await registry.pollAll(gladys);
    await publishTransports();
    logger.info(`LG ThinQ ready: ${devices.length} appliance(s)`);
    await setStatus(true);
  } catch (err) {
    logger.error('LG ThinQ initialization failed', err);
    await setStatus(false, describeFailure(err));
  }
}

/**
 * Publish the per-appliance reachability badge. Skipped when the account holds
 * nothing yet: an empty batch has nothing to say.
 */
async function publishTransports() {
  const entries = registry.transportEntries();
  if (entries.length > 0) {
    await gladys.publishTransports(entries);
  }
}

/** Turn an initialization failure into something the user can act on. */
function describeFailure(err) {
  if (err instanceof ThinqApiError && err.isAuthError) {
    return {
      en: 'LG refused the credentials: check the Personal Access Token and the country.',
      fr: "LG a refusé les identifiants : vérifiez le jeton d'accès personnel et le pays.",
    };
  }
  if (err instanceof ThinqApiError && err.isRateLimited) {
    return {
      en: 'LG ThinQ call quota exceeded, increase the refresh interval.',
      fr: "Quota d'appels LG ThinQ dépassé, augmentez l'intervalle de rafraîchissement.",
    };
  }
  return {
    en: 'Could not reach LG ThinQ, check the integration logs.',
    fr: "Impossible de joindre LG ThinQ, consultez les logs de l'intégration.",
  };
}

async function setStatus(connected, message) {
  await gladys.setConnectionStatus(connected, message).catch(() => {});
}

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the LG ThinQ integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
