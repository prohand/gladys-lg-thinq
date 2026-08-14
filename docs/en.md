# LG ThinQ

This integration connects Gladys Assistant to the appliances registered on your
LG account — air conditioner, washing machine, dryer, dishwasher, fridge, oven,
air purifier, robot vacuum… — using **LG's official ThinQ Connect API**.

It is a **cloud** integration: Gladys talks to LG's servers, and LG talks to
your appliances. Nothing is reverse-engineered, and no password is stored: the
only credential is a token you create yourself and can revoke at any time.

## Before you start

You need:

- an **LG ThinQ account** with your appliances already added in the LG ThinQ
  mobile app (this integration discovers appliances, it does not pair them);
- appliances that are **online** in the app;
- the **country** your LG account was created in — LG hosts accounts on
  regional servers, and the wrong region simply answers "unknown user".

## Step 1 — Create a Personal Access Token

1. Open <https://connect-pat.lgthinq.com> and log in with **the same LG account**
   you use in the ThinQ app.
2. Click **Create New Token**.
3. Give the token a name (for example `Gladys`).
4. Tick the **scopes** matching the appliances you want to use in Gladys. A
   missing scope makes the appliance invisible to the integration, so if in
   doubt, tick everything.
5. Click **Create Token** and copy the token — LG shows it once.

LG's own documentation for this screen:
<https://thinq.developer.lge.com/en/cloud/docs/thinq-connect/PAT-en/>

## Step 2 — Configure the integration in Gladys

1. Open the LG ThinQ integration in Gladys, **Configuration** tab.
2. Paste the token in **Personal Access Token**.
3. Pick the **country of the LG account**.
4. Save.
5. Click **Test the connection**: Gladys answers with the region it reached and
   the list of appliances it found. If that works, your appliances appear in the
   **Devices** tab within a few seconds.

The two other settings are optional:

- **Refresh interval** — how often each appliance is read (default 5 minutes).
  LG meters API calls per client and each appliance costs one call per refresh,
  so lower it only if you own few appliances.
- **Temperature unit** — LG publishes every temperature twice, in Celsius and in
  Fahrenheit. Only the unit you pick becomes a Gladys feature.
- **Expose every numeric property** — off by default. Turn it on to also get the
  scheduling offsets and counters LG exposes; useful to explore what a specific
  appliance reports.

## What you get

The integration reads each appliance's **profile** — LG's description of what
that exact model can report and accept — and builds the Gladys features from it.
So what you see depends on your hardware, not on a hard-coded list:

| What LG exposes                                 | What you get in Gladys                      |
| ----------------------------------------------- | ------------------------------------------- |
| Power on/off, and other on/off options          | A switch you can control, and use in scenes |
| Target temperature                              | A setpoint, with the bounds of your model   |
| Current temperature, humidity, PM2.5, PM10, CO2 | Sensors, with history and charts            |
| Filter life, battery                            | Sensors, in percent                         |
| Remaining time of a cycle                       | A duration, in hours and minutes            |
| Door open/closed                                | An opening sensor                           |
| Job mode, run state, programme name             | A text feature, usable as a scene trigger   |

Everything is refreshed on the interval you configured, and Gladys shows a
**badge** on each appliance: `cloud` when LG answers, `unreachable` (orange)
when the appliance is unplugged or off the network.

## Controlling something Gladys has no feature for

LG's modes are model-specific: your air conditioner may accept `COOL`, `HEAT`,
`AIR_DRY`, while another one accepts `ENERGY_SAVING` too. Gladys features cover
what is universal (power, temperature, sensors); everything else is reachable
through two buttons in the **Configuration** tab:

1. **List the properties** — pick an appliance, and Gladys prints every property
   it accepts with the exact values allowed, for example:

   ```
   airConJobMode.currentJobMode = COOL | HEAT | AIR_DRY
   temperatureInUnits.targetTemperatureC = 18..30, step 1
   airFlow.windStrength = LOW | MID | HIGH
   ```

2. **Send a command** — pick the appliance, paste the property name and the
   value. The command is checked against the profile before being sent, so a
   typo is refused with the list of allowed values instead of a silent failure.

## Troubleshooting

**"LG refused the credentials"** — the token or the country is wrong. Tokens are
bound to the account that created them: check you used the same LG account as in
the ThinQ app, and pick the country the account was created in.

**An appliance is missing** — either its scope was not ticked when the token was
created (create a new token with the right scopes), or it was added to the LG
app after Gladys last looked. Click **Refresh the appliance list**.

**An appliance shows an orange `unreachable` badge** — LG reports it as not
connected. Check it is powered and connected to Wi-Fi in the LG ThinQ app; the
badge clears itself on the next refresh.

**"Call quota exceeded"** — increase the refresh interval. LG counts the calls
of each client, and one refresh costs one call per appliance.

**A command is refused** — LG rejects commands an appliance cannot honor in its
current state (starting a washing machine whose door is open, changing the mode
while it is off). The reason is shown under the button and in the integration
logs.

## Privacy

The Personal Access Token is stored encrypted by Gladys and is never sent back
to your browser. It can be revoked at any time from
<https://connect-pat.lgthinq.com>, which instantly cuts this integration's
access without touching your LG account.
