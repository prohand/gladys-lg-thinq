// -----------------------------------------------------------------------------
// Dashboard widgets (manifest `widgets`).
//
//   appliance   one appliance: its live values, what it is doing, on/off
//   overview    every LG appliance of the house on one card, with its state
//
// The content is declarative (the core renders it, theme and dark mode
// included) and rebuilt from memory: a widget never calls LG by itself. The
// tiles are bound to the device features, so the core keeps them live on its
// own; the status lines are nudged by the registry when a read changes them
// (`onChange`), and otherwise expire with the refresh interval.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { createdExternalIds } from './devices/index.js';
import { readStateValue } from './devices/profile.js';
import { isRunStateBinding, runStateColor, translateValue } from './devices/runState.js';

export const WIDGET_KEYS = {
  APPLIANCE: 'appliance',
  OVERVIEW: 'overview',
};

/** Content budget of the core: past these, it drops what comes last. */
const MAX_COMPONENTS = 8;
const MAX_TILES = 6;
const MAX_STATUS_ITEMS = 10;
const TILE_LABEL_LENGTH = 24;
const STATUS_TEXT_LENGTH = 40;
const HEADING_LENGTH = 40;

/** Bounds of `ttl_seconds`. */
const MIN_TTL_SECONDS = 10;
const MAX_TTL_SECONDS = 3600;

const TEXTS = {
  connection: { en: 'Connection', fr: 'Connexion' },
  connected: { en: 'Connected', fr: 'Connecté' },
  unreachable: { en: 'Unreachable', fr: 'Injoignable' },
  waiting: { en: 'Waiting for a read', fr: 'En attente de lecture' },
  on: { en: 'On', fr: 'Marche' },
  off: { en: 'Off', fr: 'Arrêt' },
  refresh: { en: 'Refresh', fr: 'Actualiser' },
  refreshed: { en: 'Appliance refreshed', fr: 'Appareil actualisé' },
  allRefreshed: { en: 'Appliances refreshed', fr: 'Appareils actualisés' },
  unknownAppliance: {
    en: 'This appliance is not known to the LG ThinQ integration: check its configuration, or pick another appliance in the widget settings.',
    fr: "Cet appareil n'est pas connu de l'intégration LG ThinQ : vérifiez sa configuration, ou choisissez un autre appareil dans les réglages du widget.",
  },
  noAppliance: {
    en: 'No LG appliance added yet: add them from the Discovery tab of the integration.',
    fr: "Aucun appareil LG ajouté pour l'instant : ajoutez-les depuis l'onglet Découverte de l'intégration.",
  },
};

/** Shorten a text to the core bound, visibly. */
function clip(text, max) {
  const value = String(text);
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Apply `clip` to every language of a multi-language text. */
function clipAll(texts, max) {
  return Object.fromEntries(Object.entries(texts).map(([lang, text]) => [lang, clip(text, max)]));
}

/** The content lives as long as the data behind it: one refresh interval. */
function ttlSeconds(config) {
  const seconds = Number(config?.poll_frequency) || 60;
  return Math.min(Math.max(Math.round(seconds), MIN_TTL_SECONDS), MAX_TTL_SECONDS);
}

/** Name of the Gladys feature behind a binding. */
function featureName(model, externalId) {
  return model.device.features.find((feature) => feature.external_id === externalId)?.name ?? '';
}

/** Has the user added this appliance to Gladys (so its features exist)? */
function isCreated(gladys, model) {
  const created = createdExternalIds(gladys);
  return !created || created.has(model.externalId);
}

/** The connection line of a status list. */
function connectionItem(model) {
  if (model.online === false) {
    return { label: TEXTS.connection, value: TEXTS.unreachable, color: WIDGET_COLORS.DANGER };
  }
  if (!model.lastState) {
    return { label: TEXTS.connection, value: TEXTS.waiting, color: WIDGET_COLORS.NEUTRAL };
  }
  return { label: TEXTS.connection, value: TEXTS.connected, color: WIDGET_COLORS.SUCCESS };
}

/** One status line per text feature the appliance reported (run state, modes). */
function textItems(model) {
  if (!model.lastState) {
    return [];
  }
  const items = [];
  for (const [externalId, binding] of model.bindings) {
    if (binding.shape.kind !== 'text' || !binding.descriptor.readable) {
      continue;
    }
    const raw = readStateValue(model.lastState, binding.descriptor);
    if (raw === undefined || raw === null) {
      continue;
    }
    items.push({
      label: clip(featureName(model, externalId), STATUS_TEXT_LENGTH),
      value: clipAll(translateValue(raw), STATUS_TEXT_LENGTH),
      color: isRunStateBinding(binding) ? runStateColor(raw) : WIDGET_COLORS.INFO,
    });
  }
  return items;
}

/** Live tiles: the readable numeric features, in profile order. */
function tiles(model, max) {
  const components = [];
  for (const [externalId, binding] of model.bindings) {
    if (components.length >= max) {
      break;
    }
    if (binding.shape.kind !== 'number' || !binding.descriptor.readable) {
      continue;
    }
    components.push({
      type: 'value',
      label: clip(featureName(model, externalId), TILE_LABEL_LENGTH),
      device_feature: externalId,
    });
  }
  return components;
}

/** On / Off buttons, bound to the appliance power feature when it has one. */
function powerButtons(model) {
  for (const [externalId, binding] of model.bindings) {
    const { descriptor, shape } = binding;
    if (descriptor.resource !== 'operation' || shape.kind !== 'binary' || !descriptor.writable) {
      continue;
    }
    return [
      {
        type: 'button',
        label: TEXTS.on,
        icon: 'power',
        style: 'primary',
        device_feature: externalId,
        value: 1,
      },
      {
        type: 'button',
        label: TEXTS.off,
        icon: 'power',
        style: 'secondary',
        device_feature: externalId,
        value: 0,
      },
    ];
  }
  return [];
}

const refreshButton = {
  type: 'button',
  label: TEXTS.refresh,
  icon: 'refresh-cw',
  style: 'secondary',
  action: { key: 'refresh' },
};

/** Content of the `appliance` widget. */
export function buildApplianceContent(gladys, { registry, config, settings }) {
  const model = registry.models.get(settings?.device);
  if (!model) {
    return {
      ttl_seconds: MIN_TTL_SECONDS * 6,
      components: [{ type: 'text', variant: 'body', text: TEXTS.unknownAppliance }],
    };
  }
  // A feature Gladys does not hold yet cannot back a tile nor a button: the
  // core would drop them anyway, with a warning in its logs.
  const created = isCreated(gladys, model);
  const heading = { type: 'text', variant: 'heading', text: clip(model.name, HEADING_LENGTH) };
  const status = {
    type: 'status',
    items: [connectionItem(model), ...textItems(model)].slice(0, MAX_STATUS_ITEMS),
  };
  const buttons = [...(created ? powerButtons(model) : []), refreshButton];
  // The tiles take whatever the budget leaves: 3 next to on/off, up to 6.
  const room = Math.min(MAX_TILES, MAX_COMPONENTS - 2 - buttons.length);
  return {
    ttl_seconds: ttlSeconds(config),
    components: [heading, ...(created ? tiles(model, room) : []), status, ...buttons],
  };
}

/** One status line summing up an appliance, for the `overview` widget. */
function overviewItem(model) {
  if (model.online === false || !model.lastState) {
    const { value, color } = connectionItem(model);
    return { label: clip(model.name, STATUS_TEXT_LENGTH), value, color };
  }
  const runStates = [];
  for (const binding of model.bindings.values()) {
    if (!isRunStateBinding(binding)) {
      continue;
    }
    const raw = readStateValue(model.lastState, binding.descriptor);
    if (raw !== undefined && raw !== null) {
      runStates.push(raw);
    }
  }
  if (runStates.length === 0) {
    return {
      label: clip(model.name, STATUS_TEXT_LENGTH),
      value: TEXTS.connected,
      color: WIDGET_COLORS.SUCCESS,
    };
  }
  // A washtower has two run states (washer, dryer): both fit on one line.
  const value = Object.fromEntries(
    ['en', 'fr'].map((lang) => [
      lang,
      clip(runStates.map((raw) => translateValue(raw)[lang]).join(' / '), STATUS_TEXT_LENGTH),
    ]),
  );
  return { label: clip(model.name, STATUS_TEXT_LENGTH), value, color: runStateColor(runStates[0]) };
}

/** Content of the `overview` widget. */
export function buildOverviewContent(gladys, { registry, config }) {
  const created = createdExternalIds(gladys);
  const models = [...registry.models.values()].filter(
    (model) => !created || created.has(model.externalId),
  );
  if (models.length === 0) {
    return {
      ttl_seconds: ttlSeconds(config),
      components: [{ type: 'text', variant: 'body', text: TEXTS.noAppliance }],
    };
  }
  const shown = models.slice(0, MAX_STATUS_ITEMS);
  const hidden = models.length - shown.length;
  return {
    ttl_seconds: ttlSeconds(config),
    components: [
      { type: 'status', items: shown.map(overviewItem) },
      ...(hidden > 0
        ? [
            {
              type: 'text',
              variant: 'caption',
              text: { en: `… and ${hidden} more`, fr: `… et ${hidden} autre(s)` },
            },
          ]
        : []),
      refreshButton,
    ],
  };
}

export const WIDGETS = {
  [WIDGET_KEYS.APPLIANCE]: {
    get: buildApplianceContent,
    /** The Refresh button: read the appliance now. */
    async action(gladys, { registry, actionKey, settings }) {
      if (actionKey !== 'refresh') {
        throw new Error(`Unknown widget action: ${actionKey}`);
      }
      const model = registry.requireModel(settings?.device);
      await registry.pollModel(gladys, model, { silent: true });
      return TEXTS.refreshed;
    },
  },
  [WIDGET_KEYS.OVERVIEW]: {
    get: buildOverviewContent,
    /** The Refresh button: read every added appliance now. */
    async action(gladys, { registry, actionKey }) {
      if (actionKey !== 'refresh') {
        throw new Error(`Unknown widget action: ${actionKey}`);
      }
      await registry.pollAll(gladys, { silent: true });
      return TEXTS.allRefreshed;
    },
  },
};
