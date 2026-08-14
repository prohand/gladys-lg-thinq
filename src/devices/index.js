// -----------------------------------------------------------------------------
// Device registry.
//
// Unlike a fixed-hardware integration, the device list here is DISCOVERED: it
// is whatever appliances the LG account holds. So instead of a static array of
// blueprints, this module keeps a live registry, rebuilt from the ThinQ API
// every time the integration connects, the configuration changes or the user
// asks for a re-scan.
//
// One entry = one appliance, with:
//   - the Gladys device payload (name, features) built from the ThinQ profile;
//   - the bindings (feature external_id -> ThinQ property + codec) used to
//     decode a state and to encode a command.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { ThinqApi } from '../thinq/api.js';
import { ThinqApiError } from '../thinq/errors.js';
import { getOrCreateClientId } from '../thinq/clientId.js';
import { SCHEDULER_POLL_FREQUENCY } from '../pollFrequency.js';
import { DEFAULT_CONFIG } from '../config.js';
import { buildCommand, buildDeviceModel, buildStates } from './builder.js';

const logger = createLogger({ name: 'devices' });

/** Pause between two ThinQ calls: the API throttles bursts per client. */
const REQUEST_SPACING_MS = 150;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * External ids of the appliances the user actually added to Gladys.
 *
 * The SDK keeps that list in sync (it is fetched on every (re)connection and
 * updated by the device created/updated/deleted events). Returns `null` when
 * the list is not available, meaning "no filtering": better one useless read
 * than an appliance never read.
 */
function createdExternalIds(gladys) {
  if (!Array.isArray(gladys?.devices)) {
    return null;
  }
  return new Set(gladys.devices.map((device) => device?.external_id).filter(Boolean));
}

export class DeviceRegistry {
  constructor({ createApi = (options) => new ThinqApi(options) } = {}) {
    this.createApi = createApi;
    /** @type {Map<string, object>} device external_id -> device model */
    this.models = new Map();
    this.api = null;
    this.clientId = null;
    /** Refresh interval asked for by the user, in milliseconds. */
    this.pollIntervalMs = DEFAULT_CONFIG.poll_frequency * 1000;
    /** Chain of the reads triggered by device creations (kept sequential). */
    this.firstReads = Promise.resolve();
  }

  /**
   * (Re)build the API client from the user configuration. Returns false when
   * the configuration is not usable yet (no token, no country): the caller
   * reports it, nothing throws.
   */
  configure(config) {
    this.pollIntervalMs = config.poll_frequency * 1000;
    if (!config.access_token || !config.country_code) {
      this.api = null;
      return false;
    }
    this.clientId ??= getOrCreateClientId();
    this.api = this.createApi({
      accessToken: config.access_token,
      countryCode: config.country_code,
      clientId: this.clientId,
    });
    return true;
  }

  /** The API client, or a clear error when the integration is unconfigured. */
  requireApi() {
    if (!this.api) {
      throw new Error(
        'LG ThinQ is not configured yet: fill in the Personal Access Token and the country.',
      );
    }
    return this.api;
  }

  /**
   * Fetch the appliances of the account and rebuild every device model.
   * @returns {Promise<Array<object>>} the Gladys discovery payloads
   */
  async discover(gladys, config) {
    const api = this.requireApi();
    const thinqDevices = await api.getDevices();
    logger.info(`ThinQ account holds ${thinqDevices.length} appliance(s)`);

    const models = new Map();
    for (const thinqDevice of thinqDevices) {
      if (!thinqDevice?.deviceId) {
        continue;
      }
      try {
        const profile = await api.getDeviceProfile(thinqDevice.deviceId);
        const model = buildDeviceModel(gladys, { thinqDevice, profile, config });
        if (model.device.features.length === 0) {
          logger.warn(`${model.name}: no usable property in the ThinQ profile, skipped`);
          continue;
        }
        models.set(model.externalId, model);
      } catch (err) {
        // One unreadable appliance must not cost us the whole account.
        logger.error(
          `Could not read the profile of ${thinqDevice.deviceInfo?.alias ?? thinqDevice.deviceId}`,
          err,
        );
      }
      await sleep(REQUEST_SPACING_MS);
    }

    this.models = models;
    return this.discoveredDevices();
  }

  /** Gladys discovery payloads of the currently known appliances. */
  discoveredDevices() {
    return [...this.models.values()].map((model) => model.device);
  }

  /** Find the model owning a Gladys device (dispatch of onPoll / onSetValue). */
  findModel(device) {
    return this.models.get(device?.external_id);
  }

  /** Find the model owning a feature external_id. */
  findModelByFeature(featureExternalId) {
    for (const model of this.models.values()) {
      if (model.bindings.has(featureExternalId)) {
        return model;
      }
    }
    return undefined;
  }

  /**
   * Has this appliance waited long enough for its next read?
   *
   * Gladys registers every device at its slowest cadence (one minute) because
   * that is the slowest its scheduler accepts; a user asking for five minutes
   * therefore gets four ticks to ignore. Half a tick of slack absorbs the timer
   * jitter, otherwise a tick landing a hair early would push the read a whole
   * minute back, and the interval would drift.
   */
  dueForPoll(model, now = Date.now()) {
    if (!model.lastPollAt) {
      return true;
    }
    return now - model.lastPollAt >= this.pollIntervalMs - SCHEDULER_POLL_FREQUENCY / 2;
  }

  /**
   * Read one appliance and publish every feature it reported.
   * Offline appliances are flagged (transport badge) instead of throwing.
   */
  async pollModel(gladys, model) {
    const api = this.requireApi();
    // Stamped before the call: a read that fails still spent its API call, and
    // must not make the integration retry on every tick.
    model.lastPollAt = Date.now();
    try {
      const state = await api.getDeviceState(model.deviceId);
      model.online = true;
      const states = buildStates(model, state);
      if (states.length > 0) {
        await gladys.publishStates(states);
      }
      logger.debug(`${model.name}: ${states.length} state(s) published`);
    } catch (err) {
      if (err instanceof ThinqApiError && err.isDeviceOffline) {
        model.online = false;
        logger.warn(`${model.name} is not connected to the LG cloud right now`);
        return;
      }
      throw err;
    }
  }

  /**
   * Read every appliance once (used right after connecting).
   *
   * Only the appliances the user actually added are read: discovering an
   * account publishes every appliance it holds, but a state published for a
   * device the user never added has nowhere to land — it only spends an LG API
   * call. Those appliances get their first read the moment they are added
   * (`pollNewDevice`).
   */
  async pollAll(gladys) {
    const created = createdExternalIds(gladys);
    for (const model of this.models.values()) {
      if (created && !created.has(model.externalId)) {
        logger.debug(`${model.name} is not added to Gladys yet, no initial read`);
        continue;
      }
      try {
        await this.pollModel(gladys, model);
      } catch (err) {
        logger.error(`Initial read of ${model.name} failed`, err);
      }
      await sleep(REQUEST_SPACING_MS);
    }
  }

  /**
   * Read an appliance the user has just added from the Discovery screen.
   *
   * Discovery only publishes the SHAPE of an appliance (its features); the
   * values come from the poll loop, whose next read can be a whole refresh
   * interval away. Without this, a freshly added appliance sits on the
   * dashboard with no value at all until that interval elapses.
   *
   * Additions come one WebSocket message at a time but are handled
   * concurrently, so the reads are chained: adding six appliances in a row must
   * not fire six simultaneous ThinQ calls, which the API throttles.
   *
   * @returns {Promise<boolean>} false when the device is not one of ours
   */
  async pollNewDevice(gladys, device) {
    const model = this.findModel(device);
    if (!model) {
      logger.debug(`Device created outside the LG ThinQ registry: ${device?.external_id}`);
      return false;
    }
    const read = this.firstReads.then(async () => {
      try {
        await this.pollModel(gladys, model);
      } catch (err) {
        logger.error(`First read of ${model.name} failed`, err);
      }
      await sleep(REQUEST_SPACING_MS);
    });
    this.firstReads = read;
    await read;
    return true;
  }

  /**
   * Apply a user command on a feature, then reflect the resulting state.
   * @param {object} params `{ device, feature, value }` from `onSetValue`
   */
  async setValue(gladys, { device, feature, value }) {
    const api = this.requireApi();
    const model = this.findModel(device) ?? this.findModelByFeature(feature.external_id);
    const binding = model?.bindings.get(feature.external_id);
    if (!binding) {
      throw new Error(`Unknown LG ThinQ feature: ${feature.external_id}`);
    }

    const payload = buildCommand(binding, value);
    logger.info(`${model.name}: ${JSON.stringify(payload)}`);
    await api.controlDevice(model.deviceId, payload);

    // The appliance confirms asynchronously; publish the requested value so the
    // dashboard follows immediately. The next poll reconciles it if the
    // appliance decided otherwise.
    await gladys.publishState(
      feature.external_id,
      binding.codec.toGladys(binding.codec.toThinq(value)),
    );
  }

  /**
   * ThinQ Connect is a cloud API: every appliance is reached through LG's
   * servers. The badge only distinguishes "reachable" from "unreachable".
   */
  transportEntries() {
    return [...this.models.values()].map((model) => ({
      external_id: model.externalId,
      transport: model.online === false ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.CLOUD,
      ...(model.online === false
        ? {
            degraded: true,
            message: {
              en: 'The appliance is not connected to the LG cloud.',
              fr: "L'appareil n'est pas connecté au cloud LG.",
            },
          }
        : {}),
    }));
  }

  /**
   * Resolve a property reference typed by the user in the "Send a command"
   * action. Accepts the feature key (`operation-air-con-operation-mode`), the
   * ThinQ path (`operation.airConOperationMode`) or the bare property name.
   */
  findBinding(model, reference) {
    const wanted = String(reference ?? '').trim();
    if (!wanted) {
      return undefined;
    }
    const lowered = wanted.toLowerCase();
    for (const binding of model.bindings.values()) {
      const { descriptor } = binding;
      if (
        descriptor.key === lowered ||
        descriptor.path.toLowerCase() === lowered ||
        descriptor.property.toLowerCase() === lowered
      ) {
        return binding;
      }
    }
    return undefined;
  }
}

/** Parse a value typed in a text field into the JSON type LG expects. */
export function parseCommandValue(raw) {
  const value = String(raw ?? '').trim();
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  if (/^(true|false)$/i.test(value)) {
    return value.toLowerCase() === 'true';
  }
  return value;
}
