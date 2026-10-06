# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Gladys Assistant **external integration** (Node 20+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) that discovers, reads and controls the appliances
of an **LG ThinQ** account through LG's official **ThinQ Connect Open API** (no reverse
engineering, no password: a revocable Personal Access Token + the account country). Covers the
~30 appliance families of the API (AC, washer, dryer, dishwasher, fridge, oven, air purifier,
robot vacuum…). Gladys 5.1+ adds widgets, scene triggers and scene actions.

## Commands

```bash
npm install
npm test                                     # node --test (built-in runner)
node --test test/profile.test.js             # one file
node --test --test-name-pattern "run state"  # one test by name
npm run lint                                 # eslint .
npm run format:check                         # prettier --check . (CI gate)
npm run format                               # prettier --write .
```

CI runs `format:check`, `lint`, `test`. Releases: **Actions → Release** only (bumps
`package.json`, manifest `version` + `docker_image`, tags, builds). The release rewrites the
manifest with `jq`: run `npm run format` afterwards or CI fails.

## Architecture

```
index.js                 SDK wiring, initialize(), the integration's own refresh loop
src/config.js            defaults (token, country, interval, temperature unit...) + normalization
src/pollFrequency.js     the Gladys poll enum (ms) and the scheduler cadence (60 s)
src/thinq/api.js         ThinQ Connect REST client (devices, profile, state, control)
src/thinq/regions.js     country -> API region host
src/thinq/clientId.js    stable client id sent to LG
src/thinq/deviceTypes.js ThinQ device types -> names/families
src/thinq/errors.js      ThinqApiError (isAuthError, isRateLimited)
src/devices/profile.js   ThinQ profile -> list of usable properties
src/devices/featureMap.js  ThinQ property -> Gladys category/type/unit
src/devices/builder.js   one appliance -> discovery payload + state mapping
src/devices/runState.js  run-state / job-mode text helpers
src/devices/index.js     DeviceRegistry: discover, poll (due/all/new), setValue, transports
src/actions.js           Configuration screen buttons (incl. send any ThinQ property)
src/sceneTriggers.js     transitions -> scene events
src/sceneActions.js      scene actions
src/widgets.js           dashboard widgets
```

### Invariants worth knowing

- **The ThinQ API meters calls per client.** Each appliance is read at most once per configured
  interval (`dueForPoll`, default 300 s), requests are spaced (`REQUEST_SPACING_MS`), and only
  appliances added in Gladys are read.
- **Two refresh paths, one schedule.** Devices carry `should_poll: true` and
  `poll_frequency: 60000` (`SCHEDULER_POLL_FREQUENCY`; Gladys only accepts 1 s–60 s and rejects
  the whole discovery otherwise). An integration-owned loop (`refreshDueAppliances`) also ticks
  every minute because appliances created before `should_poll` was published are never polled by
  Gladys. Both share `dueForPoll`/`lastPollAt`, so the LG quota is unchanged.
- **Features come from the ThinQ profile** of each model (`profile.js` + `featureMap.js`); an
  appliance with no usable property is skipped. Every feature declares `min`/`max`.
- **Device external ids are short** (shortened in 2.0.1 so the appliance widget accepts them):
  never change their shape, it orphans users' devices.
- **Transport badge**: `cloud` when LG answers, `unreachable` with the reason otherwise.
- **Errors are user problems, not crashes**: `describeFailure()` turns auth and quota errors into
  actionable bilingual messages in the Configuration screen.
- The token is a secret: never log it.
- Widget, trigger and action keys are stored by users: never rename them.

### Manifest

`test/manifest.test.js` keeps `gladys-assistant-integration.json` in sync with `DEFAULT_CONFIG`,
the bounds, `ACTIONS`, `SCENE_ACTIONS`, `WIDGETS` and the trigger keys (`gladys_version >=5.1.0`).

## Testing

No network: `test/helpers/fixtures.js` holds real ThinQ payloads; `test/helpers/liveApi.js` is a
fake API; `test/helpers/fakeGladys.js` stands in for the SDK.

## Conventions

Prettier formats, ESLint catches mistakes. Comments explain **why**. User-facing messages are
bilingual `{ en, fr }`; user docs in `docs/en.md` and `docs/fr.md`, kept in sync. The container
rootfs is read-only: write nothing.
