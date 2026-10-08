// -----------------------------------------------------------------------------
// Runtime: the integration's lifecycle, apart from the SDK wiring.
//
// index.js registers the handlers; this module holds what they share — the
// current configuration, the (re)initialization, the integration's own refresh
// loop and the status shown in the Configuration screen. Its timers and clock
// are injected, so the lifecycle (start, Gladys going away and coming back, a
// configuration LG refuses) is tested without a Gladys server or a real clock.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { isConfigured, normalizeConfig } from './config.js';
import { SCHEDULER_POLL_FREQUENCY } from './pollFrequency.js';
import { ThinqApiError } from './thinq/errors.js';

const logger = createLogger({ name: 'runtime' });

/** Pause before retrying the read of an account that failed. */
export const DISCOVERY_RETRY_MS = 5 * 60 * 1000;

/** Turn an initialization failure into something the user can act on. */
export function describeFailure(err) {
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

/**
 * @param {object} gladys the SDK instance
 * @param {object} options
 * @param {import('./devices/index.js').DeviceRegistry} options.registry
 * @param {Function} [options.setIntervalFn]
 * @param {Function} [options.clearIntervalFn]
 * @param {Function} [options.now]
 */
export function createRuntime(
  gladys,
  { registry, setIntervalFn = setInterval, clearIntervalFn = clearInterval, now = Date.now },
) {
  // Current configuration (hot-reloaded through onConfigUpdated).
  let config = normalizeConfig();

  // Timer of the integration's own refresh loop (see startRefreshLoop).
  let refreshTimer = null;
  let refreshing = false;

  // False between a `disconnected` and the next `connected`: the states read
  // then would have nowhere to go, and each read is still an LG call.
  let gladysConnected = true;

  // Set when the last read of the account failed: the refresh loop retries it.
  let discoveryPending = false;
  let lastDiscoveryAttemptAt = 0;

  // The account problem last shown in the Configuration screen by the refresh
  // loop. The status used to be written by discoverAndPublish() alone: a token
  // revoked or expired after a good start stayed behind a green status, with
  // every appliance read failing in the logs.
  let reportedAccountError = null;

  async function setStatus(connected, message) {
    await gladys.setConnectionStatus(connected, message).catch(() => {});
  }

  /**
   * Publish the per-appliance reachability badge. Skipped when the account
   * holds nothing yet: an empty batch has nothing to say.
   */
  async function publishTransports() {
    const entries = registry.transportEntries();
    if (entries.length > 0) {
      await gladys.publishTransports(entries);
    }
  }

  /**
   * (Re)build everything that depends on the configuration: the API client,
   * the appliance list, the first read. Reports the outcome in the
   * Configuration screen instead of crashing — a wrong token is a user
   * problem, not a bug. Never throws.
   */
  async function initialize() {
    if (!isConfigured(config)) {
      logger.warn('Waiting for the Personal Access Token and the country');
      stopRefreshLoop();
      await setStatus(false, {
        en: 'Enter your LG ThinQ Personal Access Token and your country to get started.',
        fr: "Renseignez votre jeton d'accès personnel LG ThinQ et votre pays pour commencer.",
      });
      return;
    }

    try {
      registry.configure(config);
    } catch (err) {
      // The API client refuses a country LG does not serve. Nothing to retry
      // until the configuration changes: no loop, and the reason on screen
      // instead of an unhandled rejection in the logs.
      logger.error('LG ThinQ configuration refused', err);
      stopRefreshLoop();
      await setStatus(false, {
        en: `LG ThinQ does not accept the country "${config.country_code}": enter the country the LG account was created in.`,
        fr: `LG ThinQ n'accepte pas le pays « ${config.country_code} » : indiquez le pays de création du compte LG.`,
      });
      return;
    }
    // Armed BEFORE the first read of the account: when that read fails (the
    // network is often not up yet right after a container start, or LG is
    // down), the loop is what retries it. Armed after it, a failed start left
    // the integration without any refresh until the next scan or config change.
    startRefreshLoop();
    await discoverAndPublish();
  }

  /**
   * Read the account, publish the appliances and their first values, and
   * report the outcome in the Configuration screen. Never throws: a failure is
   * retried by the refresh loop.
   */
  async function discoverAndPublish() {
    lastDiscoveryAttemptAt = now();
    try {
      const devices = await registry.discover(gladys, config);
      await gladys.publishDiscoveredDevices(devices);
      discoveryPending = false;
      reportedAccountError = null;
      await registry.pollAll(gladys);
      await publishTransports();
      logger.info(`LG ThinQ ready: ${devices.length} appliance(s)`);
      await setStatus(true);
    } catch (err) {
      discoveryPending = true;
      logger.error('LG ThinQ initialization failed', err);
      await setStatus(false, describeFailure(err));
    }
  }

  /**
   * Start the integration's own refresh loop.
   *
   * The Gladys scheduler is not enough on its own: it only polls the
   * appliances that were created with `should_poll`, so an appliance added
   * before that flag was published keeps its features frozen forever. This
   * loop reads whatever is due on its own, and shares `dueForPoll` with
   * `onPoll`, so an appliance Gladys does poll is still read once per refresh
   * interval and the LG quota is unchanged. Ticking at the Gladys cadence keeps
   * a single notion of "a tick".
   */
  function startRefreshLoop() {
    if (refreshTimer) {
      return;
    }
    refreshTimer = setIntervalFn(refreshDueAppliances, SCHEDULER_POLL_FREQUENCY);
    // The WebSocket keeps the process alive; this timer must not, so a
    // shutdown is never held back by a pending tick.
    refreshTimer?.unref?.();
  }

  /** Stop the refresh loop: nothing to read, or nowhere to publish it. */
  function stopRefreshLoop() {
    if (refreshTimer) {
      clearIntervalFn(refreshTimer);
      refreshTimer = null;
    }
  }

  /** One tick of the refresh loop. Overlapping ticks are dropped, not queued. */
  async function refreshDueAppliances() {
    if (!gladysConnected) {
      return;
    }
    if (refreshing) {
      logger.debug('refresh skipped, the previous one is still running');
      return;
    }
    refreshing = true;
    try {
      if (discoveryPending) {
        if (now() - lastDiscoveryAttemptAt >= DISCOVERY_RETRY_MS) {
          logger.info('Retrying the read of the LG ThinQ account');
          await discoverAndPublish();
        }
        return;
      }
      const read = await registry.pollDue(gladys, { shouldStop: () => !gladysConnected });
      if (read > 0 && gladysConnected) {
        await publishTransports();
        await reportAccountHealth();
      }
    } catch (err) {
      logger.error('Refresh cycle failed', err);
    } finally {
      refreshing = false;
    }
  }

  /** Show (or clear) an account-wide problem met by the refresh loop. */
  async function reportAccountHealth() {
    const err = registry.accountError;
    const key = err ? `${err.isAuthError}:${err.isRateLimited}` : null;
    if (key === reportedAccountError) {
      return;
    }
    reportedAccountError = key;
    await setStatus(!err, err ? describeFailure(err) : undefined);
  }

  return {
    get config() {
      return config;
    },
    get refreshLoopRunning() {
      return refreshTimer !== null;
    },
    setConfig(raw) {
      config = normalizeConfig(raw);
    },
    initialize,
    publishTransports,
    refreshDueAppliances,
    stopRefreshLoop,

    /** Gladys is (back): read the configuration and start over. */
    async onConnected() {
      gladysConnected = true;
      try {
        config = normalizeConfig(await gladys.getConfig());
      } catch (err) {
        logger.error('Could not read the integration configuration', err);
        // The loop was stopped by the disconnection: keep refreshing with the
        // configuration already known rather than not at all.
        if (isConfigured(config) && registry.api) {
          startRefreshLoop();
        }
        return;
      }
      await initialize();
    },

    /**
     * Gladys is gone (restart, network): the loop is paused until it comes
     * back. Reading LG meanwhile would spend the quota on states nobody can
     * receive; `onConnected` re-arms the loop and reads everything once.
     */
    onDisconnected() {
      gladysConnected = false;
      stopRefreshLoop();
      logger.info('Gladys unreachable: LG ThinQ reads paused until it is back');
    },
  };
}
