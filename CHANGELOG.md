# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

## [2.2.0] - 2026-10-07

- Maintenance release, no functional change.

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

[Unreleased]: https://github.com/prohand/gladys-lg-thinq/compare/v2.2.0...HEAD
[2.2.0]: https://github.com/prohand/gladys-lg-thinq/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/prohand/gladys-lg-thinq/compare/v2.0.1...v2.1.0
[2.0.1]: https://github.com/prohand/gladys-lg-thinq/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/prohand/gladys-lg-thinq/compare/v1.0.1...v2.0.0
[1.0.1]: https://github.com/prohand/gladys-lg-thinq/releases/tag/v1.0.1
