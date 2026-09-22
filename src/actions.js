// -----------------------------------------------------------------------------
// Buttons of the Configuration screen (manifest `actions`).
//
// Four actions, each answering with the multi-language message Gladys displays
// under the button:
//
//   test_connection   is the token valid, and what does the account hold?
//   refresh_devices   re-read the account after adding an appliance in the app
//   list_properties   what can be commanded on THIS appliance, and with which
//                     values — the reference sheet for the action below
//   send_command      send any ThinQ property, including the ones Gladys has no
//                     feature for (a job mode, a fan step, a course)
//
// The last two exist because LG's enums are model-specific: Gladys features
// cover the universal parts (power, temperature, sensors), and this escape
// hatch covers the rest without waiting for a new release of the integration.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'actions' });

/** Keep the action message readable in the Configuration screen. */
const MAX_LISTED_PROPERTIES = 25;

/** Human-readable summary of the values a property accepts. */
function describeAcceptedValues(descriptor) {
  const values = descriptor.writeValues ?? descriptor.readValues;
  if (Array.isArray(values)) {
    return values.join(' | ');
  }
  if (values && typeof values === 'object') {
    const step = values.step ? `, step ${values.step}` : '';
    return `${values.min}..${values.max}${step}`;
  }
  return descriptor.valueType;
}

export const ACTIONS = {
  /** Validate the credentials and show what the account holds. */
  async test_connection(gladys, { registry }) {
    const api = registry.requireApi();
    const devices = await api.getDevices();
    logger.info(`test_connection -> ${devices.length} appliance(s)`);

    if (devices.length === 0) {
      return {
        en: 'Connected to LG ThinQ, but this account has no appliance registered.',
        fr: "Connexion à LG ThinQ réussie, mais aucun appareil n'est enregistré sur ce compte.",
      };
    }
    const names = devices
      .map((device) => device.deviceInfo?.alias || device.deviceInfo?.modelName || device.deviceId)
      .join(', ');
    return {
      en: `Connected (region ${api.region}). ${devices.length} appliance(s): ${names}.`,
      fr: `Connecté (région ${api.region}). ${devices.length} appareil(s) : ${names}.`,
    };
  },

  /** Re-run discovery, e.g. after pairing a new appliance in the LG app. */
  async refresh_devices(gladys, { registry, config }) {
    const devices = await registry.discover(gladys, config);
    await gladys.publishDiscoveredDevices(devices);
    await registry.pollAll(gladys, { silent: true });
    return {
      en: `${devices.length} appliance(s) published to Gladys.`,
      fr: `${devices.length} appareil(s) publié(s) dans Gladys.`,
    };
  },

  /** List what can be commanded on one appliance. */
  async list_properties(gladys, { registry, fields }) {
    const model = registry.requireModel(fields.device);
    const writable = [...model.bindings.values()]
      .filter((binding) => binding.descriptor.writable)
      .map(
        (binding) => `${binding.descriptor.path} = ${describeAcceptedValues(binding.descriptor)}`,
      );

    if (writable.length === 0) {
      return {
        en: `${model.name} exposes no writable property.`,
        fr: `${model.name} n'expose aucune propriété modifiable.`,
      };
    }

    const shown = writable.slice(0, MAX_LISTED_PROPERTIES);
    const more = writable.length - shown.length;
    const list = shown.join('\n');
    return {
      en: `${model.name} accepts:\n${list}${more > 0 ? `\n… and ${more} more.` : ''}`,
      fr: `${model.name} accepte :\n${list}${more > 0 ? `\n… et ${more} autre(s).` : ''}`,
    };
  },

  /** Send an arbitrary ThinQ property on one appliance. */
  async send_command(gladys, { registry, fields }) {
    const { model, binding, value } = await registry.sendProperty(gladys, fields);
    return {
      en: `${binding.descriptor.path} set to ${value} on ${model.name}.`,
      fr: `${binding.descriptor.path} réglé sur ${value} sur ${model.name}.`,
    };
  },
};
