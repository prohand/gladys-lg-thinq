// -----------------------------------------------------------------------------
// The languages the messages are written in: every user-facing text carries
// the four languages of the Gladys interface, an LG value nobody translated
// stays readable in all of them.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES, sameInEveryLanguage } from '../src/languages.js';
import { translateValue } from '../src/devices/runState.js';
import { describeFailure } from '../src/runtime.js';
import { ThinqApiError } from '../src/thinq/errors.js';

test('the integration speaks the four languages of the Gladys interface', () => {
  assert.deepEqual(LANGUAGES, ['en', 'fr', 'de', 'es']);
  assert.deepEqual(sameInEveryLanguage('Salon'), {
    en: 'Salon',
    fr: 'Salon',
    de: 'Salon',
    es: 'Salon',
  });
});

test('an LG value is translated in every language, unknown ones fall back to English', () => {
  assert.deepEqual(translateValue('RINSING'), {
    en: 'Rinsing',
    fr: 'Rinçage',
    de: 'Spülen',
    es: 'Aclarado',
  });
  assert.deepEqual(
    translateValue('turbo_boost'),
    sameInEveryLanguage(translateValue('turbo_boost').en),
  );
});

test('the connection status messages carry every language', () => {
  for (const err of [
    new Error('boom'),
    new ThinqApiError('1218', 'Invalid token', 400),
    new ThinqApiError('1306', 'Too many calls', 429),
  ]) {
    const message = describeFailure(err);
    assert.deepEqual(Object.keys(message), LANGUAGES);
  }
});
