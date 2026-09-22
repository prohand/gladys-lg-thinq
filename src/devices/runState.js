// -----------------------------------------------------------------------------
// What an appliance is doing, in words and in colors.
//
// LG reports the progress of a washer, a dryer, a dishwasher or an oven in one
// enum, `runState.currentState` (RUNNING, RINSING, END...). The scene triggers
// watch it for transitions and the dashboard widgets display it, so both read
// it through this module: one list of "finished" values, one translation table.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { humanize } from './profile.js';

/** The values meaning "the cycle is over", across the appliance families. */
const FINISHED_RUN_STATES = new Set(['END', 'DONE', 'COMPLETE', 'CLEANING_DONE']);

/** The values meaning "nothing is going on". */
const IDLE_RUN_STATES = new Set(['POWER_OFF', 'INITIAL', 'SLEEP', 'STANDBY']);

/** The values meaning "something needs a human". */
const ALERT_RUN_STATES = new Set(['ERROR']);
const PAUSED_RUN_STATES = new Set(['PAUSE', 'PAUSED']);

/**
 * French names of the enum values LG uses most. Anything missing falls back to
 * the humanized LG value ("SOAKING" -> "Soaking"): new values stay readable.
 */
const FRENCH_VALUES = {
  POWER_ON: 'Allumé',
  POWER_OFF: 'Éteint',
  ON: 'Activé',
  OFF: 'Désactivé',
  INITIAL: 'En attente',
  RUNNING: 'En cours',
  PAUSE: 'En pause',
  PAUSED: 'En pause',
  END: 'Terminé',
  DONE: 'Terminé',
  COMPLETE: 'Terminé',
  ERROR: 'Erreur',
  RESERVED: 'Programmé',
  DETECTING: 'Détection',
  SOAKING: 'Trempage',
  RINSING: 'Rinçage',
  SPINNING: 'Essorage',
  DRYING: 'Séchage',
  COOLING: 'Refroidissement',
  STEAM_SOFTENING: 'Défroissage vapeur',
  PREHEATING: 'Préchauffage',
  COOKING_IN_PROGRESS: 'Cuisson',
  CLEANING: 'Nettoyage',
  CLEANING_DONE: 'Nettoyage terminé',
  CHARGING: 'En charge',
  HOMING: 'Retour à la base',
  SLEEP: 'Veille',
  STANDBY: 'Veille',
  COOL: 'Froid',
  HEAT: 'Chaud',
  AIR_DRY: 'Déshumidification',
  FAN: 'Ventilation',
  AUTO: 'Auto',
  LOW: 'Faible',
  MID: 'Moyen',
  HIGH: 'Fort',
};

/** Is this binding the progress of the appliance (`runState.currentState`)? */
export function isRunStateBinding(binding) {
  const { descriptor } = binding;
  return (
    descriptor.resource === 'runState' &&
    descriptor.property === 'currentState' &&
    descriptor.readable
  );
}

/** Does this run state mean the cycle has just come to an end? */
export function isFinishedRunState(value) {
  return FINISHED_RUN_STATES.has(String(value ?? '').toUpperCase());
}

/** An LG enum value, readable in both languages the integration speaks. */
export function translateValue(raw) {
  const value = String(raw);
  const english = humanize(value) || value;
  return { en: english, fr: FRENCH_VALUES[value.toUpperCase()] ?? english };
}

/** The dot color a run state gets in a widget status list. */
export function runStateColor(raw) {
  const value = String(raw ?? '').toUpperCase();
  if (FINISHED_RUN_STATES.has(value)) {
    return WIDGET_COLORS.SUCCESS;
  }
  if (ALERT_RUN_STATES.has(value)) {
    return WIDGET_COLORS.DANGER;
  }
  if (PAUSED_RUN_STATES.has(value)) {
    return WIDGET_COLORS.WARNING;
  }
  if (IDLE_RUN_STATES.has(value)) {
    return WIDGET_COLORS.NEUTRAL;
  }
  return WIDGET_COLORS.PRIMARY;
}
