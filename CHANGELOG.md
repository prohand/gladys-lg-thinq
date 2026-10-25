# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

### Changed

- `@gladysassistant/integration-sdk` updated to 0.16.0.
- Gladys 5.3.0 or later is now required.
- A poll only sends the states that changed (and every value again every 30 minutes), to stay
  well under the 300 states per minute Gladys accepts and keep the history small.

### Added

- Search keywords for the Gladys catalog (washing machine, refrigerator, air conditioner…).

## [2.4.1] - 2026-10-23

- Maintenance release, no functional change.

## [2.4.0] - 2026-10-13

### Added

- German and Spanish translations (configuration screen, messages, widgets, documentation).

### Fixed

- The English documentation names the Gladys screens as the Gladys interface does.

## [2.3.0] - 2026-10-12

### Changed

- `@gladysassistant/integration-sdk` updated to 0.15.0.
- Requires Gladys 5.2.0: the "LG appliance" widget gains a **Send a command** button whose
  form picks one of the appliance's writable properties and a value, sent and validated like
  the Configuration screen's **Send a command** (the card shows one live tile less to make
  room for it).

## [2.2.1] - 2026-10-08

### Fixed

- The widget **Refresh** buttons and the "Read the state" scene action read an appliance at most once every 2 minutes, and otherwise answer from its last read: repeated clicks, or a scene run every few seconds, no longer drain the LG call quota.
- The refresh loop pauses while Gladys is unreachable, instead of spending LG calls on states nobody can receive; it resumes when Gladys is back.
- A reconnection or a configuration save no longer reads the profile of every appliance again: profiles are cached and only re-read on an explicit scan ("Refresh the appliance list", Discovery scan) or for a new appliance.
- A bare HTTP 429 is recognized as an exceeded quota, and a bare HTTP 401/403 as refused credentials, even when LG (or a gateway in front of it) sends no ThinQ error body.
- A refused token or an exceeded quota stops the round of reads at once, instead of trying (and counting) every remaining appliance.
- A country LG does not serve is shown in the Configuration screen instead of crashing the initialization with an unhandled rejection.
- Features added to an appliance from the Discovery tab ("Update") get their values right away instead of waiting for the next refresh.

### Changed

- Node.js 22 or later is required (`engines`); CI tests Node 22 and 24, and builds the Docker image on pull requests.
- The Docker image installs strictly from the lockfile and drops the npm cache.
- Dependabot also proposes Docker base image updates.

## [2.2.0] - 2026-10-07

### Fixed

- A token revoked or expired after a good start, or a quota exceeded later, is now shown in the Configuration screen (it used to stay green while every read failed), and cleared at the next read that works.

### Changed

- CI runs the store admission checks on pull requests; Dependabot proposes npm and GitHub Actions updates.
- GitHub Actions updated (checkout, setup-node, Docker actions), and a GitHub Release is published for every version.

## [2.1.0] - 2026-10-06

### Added

- `SECURITY.md`: how to report a vulnerability.
- `CHANGELOG.md`, rebuilt from the release history.
- `CLAUDE.md`: guide for contributors and coding agents (commands, architecture, invariants).

### Changed

- Development dependencies updated to their latest versions (ESLint 10.12, Prettier 3.9.9, globals 17.13).
- Manifest re-formatted with Prettier, so the CI format check passes again.

### Fixed

- A failed first read of the LG account (network not up yet after a container start, LG unavailable) no longer stops every refresh until the next scan or configuration change: the refresh loop is armed first and retries the read every 5 minutes.
- The Release workflow re-runs Prettier on the manifest after `jq`, so a release no longer leaves `main` with a failing CI format check.

## [2.0.1] - 2026-09-22

### Fixed

- Shorten the device external ids so the appliance widget accepts them

## [2.0.0] - 2026-09-22

### Added

- Dashboard widgets, scene triggers and scene actions (Gladys 5.1)

## [1.0.1] - 2026-08-15

First public release.

### Added

- LG ThinQ external integration for Gladys Assistant
- Name the verbose numeric features, and target Gladys 4.86

### Changed

- Drop the environment catalog category

### Fixed

- Publish a poll_frequency Gladys accepts
- Publish the feature bounds Gladys stores as NOT NULL
- Read an appliance the moment the user adds it
- Actually schedule the refresh of the appliances

[Unreleased]: https://github.com/prohand/gladys-lg-thinq/compare/v2.4.1...HEAD
[2.4.1]: https://github.com/prohand/gladys-lg-thinq/compare/v2.4.0...v2.4.1
[2.4.0]: https://github.com/prohand/gladys-lg-thinq/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/prohand/gladys-lg-thinq/compare/v2.2.1...v2.3.0
[2.2.1]: https://github.com/prohand/gladys-lg-thinq/compare/v2.2.0...v2.2.1
[2.2.0]: https://github.com/prohand/gladys-lg-thinq/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/prohand/gladys-lg-thinq/compare/v2.0.1...v2.1.0
[2.0.1]: https://github.com/prohand/gladys-lg-thinq/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/prohand/gladys-lg-thinq/compare/v1.0.1...v2.0.0
[1.0.1]: https://github.com/prohand/gladys-lg-thinq/releases/tag/v1.0.1
