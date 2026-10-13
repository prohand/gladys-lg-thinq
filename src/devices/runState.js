// -----------------------------------------------------------------------------
// What an appliance is doing, in words and in colors.
//
// LG reports the progress of a washer, a dryer, a dishwasher or an oven in one
// enum, `runState.currentState` (RUNNING, RINSING, END...). The scene triggers
// watch it for transitions and the dashboard widgets display it, so both read
// it through this module: one list of "finished" values, one translation table
// per language.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { LANGUAGES } from '../languages.js';
import { humanize } from './profile.js';

/** The values meaning "the cycle is over", across the appliance families. */
const FINISHED_RUN_STATES = new Set(['END', 'DONE', 'COMPLETE', 'CLEANING_DONE']);

/** The values meaning "nothing is going on". */
const IDLE_RUN_STATES = new Set(['POWER_OFF', 'INITIAL', 'SLEEP', 'STANDBY']);

/** The values meaning "something needs a human". */
const ALERT_RUN_STATES = new Set(['ERROR']);
const PAUSED_RUN_STATES = new Set(['PAUSE', 'PAUSED']);

/**
 * Names of the enum values LG uses most, per language. Anything missing falls
 * back to the humanized LG value ("SOAKING" -> "Soaking"): new values stay
 * readable.
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

const GERMAN_VALUES = {
  POWER_ON: 'Eingeschaltet',
  POWER_OFF: 'Ausgeschaltet',
  ON: 'Aktiviert',
  OFF: 'Deaktiviert',
  INITIAL: 'Bereit',
  RUNNING: 'Läuft',
  PAUSE: 'Pausiert',
  PAUSED: 'Pausiert',
  END: 'Beendet',
  DONE: 'Beendet',
  COMPLETE: 'Beendet',
  ERROR: 'Fehler',
  RESERVED: 'Programmiert',
  DETECTING: 'Erkennung',
  SOAKING: 'Einweichen',
  RINSING: 'Spülen',
  SPINNING: 'Schleudern',
  DRYING: 'Trocknen',
  COOLING: 'Abkühlen',
  STEAM_SOFTENING: 'Dampfglätten',
  PREHEATING: 'Vorheizen',
  COOKING_IN_PROGRESS: 'Garen',
  CLEANING: 'Reinigung',
  CLEANING_DONE: 'Reinigung beendet',
  CHARGING: 'Lädt',
  HOMING: 'Rückkehr zur Station',
  SLEEP: 'Standby',
  STANDBY: 'Standby',
  COOL: 'Kühlen',
  HEAT: 'Heizen',
  AIR_DRY: 'Entfeuchten',
  FAN: 'Lüften',
  AUTO: 'Auto',
  LOW: 'Niedrig',
  MID: 'Mittel',
  HIGH: 'Hoch',
};

const SPANISH_VALUES = {
  POWER_ON: 'Encendido',
  POWER_OFF: 'Apagado',
  ON: 'Activado',
  OFF: 'Desactivado',
  INITIAL: 'En espera',
  RUNNING: 'En curso',
  PAUSE: 'En pausa',
  PAUSED: 'En pausa',
  END: 'Terminado',
  DONE: 'Terminado',
  COMPLETE: 'Terminado',
  ERROR: 'Error',
  RESERVED: 'Programado',
  DETECTING: 'Detección',
  SOAKING: 'Remojo',
  RINSING: 'Aclarado',
  SPINNING: 'Centrifugado',
  DRYING: 'Secado',
  COOLING: 'Enfriamiento',
  STEAM_SOFTENING: 'Antiarrugas con vapor',
  PREHEATING: 'Precalentamiento',
  COOKING_IN_PROGRESS: 'Cocción',
  CLEANING: 'Limpieza',
  CLEANING_DONE: 'Limpieza terminada',
  CHARGING: 'Cargando',
  HOMING: 'Volviendo a la base',
  SLEEP: 'En reposo',
  STANDBY: 'En reposo',
  COOL: 'Frío',
  HEAT: 'Calor',
  AIR_DRY: 'Deshumidificación',
  FAN: 'Ventilación',
  AUTO: 'Auto',
  LOW: 'Bajo',
  MID: 'Medio',
  HIGH: 'Alto',
};

/** The tables above, per language. English is the humanized LG value. */
const TRANSLATED_VALUES = { fr: FRENCH_VALUES, de: GERMAN_VALUES, es: SPANISH_VALUES };

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

/** An LG enum value, readable in every language the integration speaks. */
export function translateValue(raw) {
  const value = String(raw);
  const english = humanize(value) || value;
  const key = value.toUpperCase();
  return Object.fromEntries(
    LANGUAGES.map((lang) => [lang, TRANSLATED_VALUES[lang]?.[key] ?? english]),
  );
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
