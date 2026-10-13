// -----------------------------------------------------------------------------
// The languages the integration writes its messages in.
//
// Every user-facing text (action results, connection status, widget content)
// is a multi-language object the core renders in the reader's language, with
// English as its fallback for any other one. These are the four languages of
// the Gladys interface.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

/** A text that reads the same in every language (a name, a ThinQ path). */
export function sameInEveryLanguage(text) {
  return Object.fromEntries(LANGUAGES.map((lang) => [lang, text]));
}
