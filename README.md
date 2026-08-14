# LG ThinQ — external integration for Gladys Assistant

Discover and control the appliances of an **LG ThinQ** account from
[Gladys Assistant](https://gladysassistant.com), through **LG's official ThinQ
Connect Open API** — no reverse engineering, no password, a revocable Personal
Access Token.

Built on the official
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and started from the
[JavaScript integration template](https://github.com/GladysAssistant/integration-template-js).

## What it does

- **Discovers** every appliance registered on the LG account (air conditioner,
  washer, dryer, dishwasher, refrigerator, oven, air purifier, robot vacuum,
  water heater… — the 30 families the ThinQ Connect API publishes).
- **Reads** their state on a configurable interval: temperatures, humidity,
  PM2.5 / PM10 / CO2, filter life, battery, remaining cycle time, door state,
  job mode, run state.
- **Controls** what LG lets it control: power on/off, temperature setpoints,
  boolean options — plus an escape hatch to send _any_ ThinQ property for the
  model-specific modes Gladys has no feature for.
- **Reports reachability** per appliance with the transport badge: `cloud` when
  LG answers, `unreachable` (orange, with the reason) when the appliance is off
  the network.

User documentation — the part that matters if you just want to _use_ it:
[`docs/en.md`](./docs/en.md) · [`docs/fr.md`](./docs/fr.md).

## How the mapping works

The interesting design decision is that **nothing is hard-coded per appliance
model**.

LG exposes, for every appliance, a _profile_: the exact list of properties that
model can report and accept, with their types, access modes and allowed values.
This integration reads that profile and derives the Gladys features from it. A
fridge with a convertible drawer gets three setpoints; the same code gives an
air conditioner a setpoint, a fan mode and four air-quality sensors — and an
appliance family LG adds next year still produces usable features.

Concretely:

```
GET /devices/{id}/profile          flattenProfile()         mapProperty()
────────────────────────────  ->  ───────────────────  ->  ──────────────────
{ "temperatureInUnits": {          resource.property        category + type
    "targetTemperatureC": {        + location               + unit + bounds
      "type": "range",             + access mode            + codec
      "mode": ["r","w"],           + allowed values
      "value": { "w": {...} } } }
```

The three profile layouts LG uses — plain, per-resource lists (a fridge's
compartments), per-device lists (a washtower's washer and dryer) — are flattened
into one list of `resource[.location].property` descriptors, so the rest of the
code never has to care which one it is dealing with.

The mapping rules live in one file,
[`src/devices/featureMap.js`](./src/devices/featureMap.js), and are the only
thing to touch to surface a new property:

| ThinQ property                             | Gladys feature                                             |
| ------------------------------------------ | ---------------------------------------------------------- |
| `operation.*` with an on/off enum pair     | Air conditioning / water heater / switch, binary, writable |
| `*targetTemperature[C/F]`                  | Target temperature, with the profile bounds                |
| `current*Temperature[C/F]`                 | Temperature sensor                                         |
| `airQualitySensor.PM2` / `PM10` / `CO2`    | PM2.5 / PM10 / CO2 sensor, µg/m³ or ppm                    |
| `*.humidity`, `*.currentHumidity`          | Humidity sensor, %                                         |
| `*FilterRemainPercent`                     | HEPA filter monitoring, %                                  |
| `battery.percent`                          | Battery, %                                                 |
| `doorStatus.doorState`                     | Opening sensor                                             |
| `timer.remain*` / `timer.total*`           | Duration, in hours / minutes                               |
| any `boolean`, or enum with an on/off pair | Switch, binary, writable                                   |
| any other readable enum or string          | Text feature (job mode, run state, course)                 |
| any other number                           | Hidden, unless "expose every numeric property" is on       |

LG duplicates every temperature in Celsius **and** Fahrenheit; only the unit
picked in the configuration becomes a feature.

### Commanding a model-specific mode

Gladys features cover what is universal. Model-specific enums (`COOL` / `HEAT` /
`AIR_DRY`, `windStrength`, a washing course) are exposed **read-only as text**,
because Gladys has no way to write a text state — and are commanded through two
Configuration buttons instead: **List the properties** prints what an appliance
accepts and with which values, **Send a command** sends it, validated against
the profile first.

## Project structure

```
.
├─ index.js                          # SDK bootstrap + event wiring (no LG logic)
├─ src/
│  ├─ config.js                      # config defaults + normalization
│  ├─ actions.js                     # the four Configuration-screen buttons
│  ├─ thinq/                         # ← everything that talks to LG
│  │  ├─ api.js                      #   REST client (devices, profile, state, control)
│  │  ├─ regions.js                  #   country -> regional API host
│  │  ├─ errors.js                   #   typed errors (auth / offline / throttled)
│  │  ├─ clientId.js                 #   stable x-client-id, persisted in /data
│  │  └─ deviceTypes.js              #   DEVICE_* -> slug used in external ids
│  └─ devices/
│     ├─ index.js                    #   the live registry (discovery + dispatch)
│     ├─ profile.js                  #   profile/state flattening, control payloads
│     ├─ featureMap.js               #   ThinQ property -> Gladys feature rules
│     └─ builder.js                  #   appliance + profile -> Gladys device
├─ docs/{en,fr}.md                   # user documentation, re-hosted by Gladys
├─ gladys-assistant-integration.json # manifest (config form, actions, image)
└─ Dockerfile                        # Node 24 Alpine, read-only rootfs ready
```

## Authentication

The ThinQ Connect API authenticates with a **Personal Access Token** the user
creates on <https://connect-pat.lgthinq.com> and can revoke at any time. It is
declared as a `secret` field, so Gladys stores it encrypted and never sends it
back to the browser.

Two other values matter:

- the **country** of the LG account, which selects the regional host
  (`api-eic` / `api-aic` / `api-kic`) — a wrong region answers "unknown user",
  so the form offers exactly the 162 countries the client knows how to route;
- the **client id**, a uuid that must stay stable across restarts (LG throttles
  clients that keep re-registering). It is generated once and persisted in
  `/data`, the only writable volume of the Gladys sandbox.

The `x-api-key` header is the public service key of the ThinQ Connect program —
the same constant LG ships in its own open-source SDK. It identifies the API,
not the user, and carries no secret.

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="lg-thinq" \
LOG_LEVEL=debug \
npm start
```

The three `GLADYS_*` variables are injected by the Gladys supervisor when the
integration runs inside its sandboxed container; the SDK reads them
automatically.

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test
```

The tests run against recorded ThinQ payloads covering the three profile
layouts, so the mapping, the codecs, the HTTP client and the dispatch are all
exercised without an LG account. The same three checks run on every push and
pull request (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

Before tagging a release you can also run the store's own validator:

```bash
npx github:GladysAssistant/integration-store .
```

## Publishing

**Actions → Release → Run workflow**, pick `patch`, `minor` or `major`. The
workflow bumps the version everywhere (`package.json` + the manifest `version`
and `docker_image`), pushes the `vX.Y.Z` tag and builds the `linux/amd64` +
`linux/arm64` image to `ghcr.io`. Add the GitHub topic
`gladys-assistant-integration` to the repository and the decentralized indexer
picks up the new version.

## Known limitations

- **Polling only.** LG offers real-time events over AWS IoT MQTT (client
  certificate registration + `GET /route`); this version reads on an interval
  instead. A cycle that ends between two polls is seen at the next one.
- **Energy usage** (`/devices/energy/...`) is not mapped yet.
- Model-specific enums are read-only features; see _Commanding a model-specific
  mode_ above.

## License

Apache-2.0
