// -----------------------------------------------------------------------------
// LG ThinQ Connect — stable client id.
//
// Every ThinQ client must send a unique `x-client-id`, and LG expects it to be
// STABLE: generating a fresh one on each container restart looks like a fleet
// of new clients and gets the API calls throttled ("Be cautious with excessive
// client creation" — LG SDK documentation).
//
// The Gladys sandbox mounts the container rootfs read-only with a single
// writable volume, `/data`, so that is where the id is persisted. If the volume
// is not writable (local run outside the sandbox), we fall back to an in-memory
// id and warn: the integration still works, it just re-registers on restart.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'thinq-client-id' });

export const DEFAULT_CLIENT_ID_PATH = '/data/thinq-client-id';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read the persisted client id, or create (and persist) a new one.
 * @param {string} [path] location of the id file
 * @returns {string} a uuid v4
 */
export function getOrCreateClientId(path = DEFAULT_CLIENT_ID_PATH) {
  try {
    const stored = readFileSync(path, 'utf8').trim();
    if (UUID_PATTERN.test(stored)) {
      return stored;
    }
    logger.warn(`Ignoring malformed client id in ${path}, generating a new one`);
  } catch {
    // Nothing persisted yet: fall through and create one.
  }

  const clientId = randomUUID();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${clientId}\n`, { mode: 0o600 });
    logger.info(`Generated a new ThinQ client id, persisted in ${path}`);
  } catch (err) {
    logger.warn(
      `Could not persist the ThinQ client id in ${path} (${err.message}); ` +
        'using an in-memory id for this run',
    );
  }
  return clientId;
}
