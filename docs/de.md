# LG ThinQ

Diese Integration verbindet Gladys Assistant mit den Geräten, die in Ihrem
LG-Konto registriert sind — Klimaanlage, Waschmaschine, Trockner,
Geschirrspüler, Kühlschrank, Backofen, Luftreiniger, Saugroboter… — über die
**offizielle ThinQ Connect API von LG**.

Es ist eine **Cloud**-Integration: Gladys spricht mit den Servern von LG, und LG
spricht mit Ihren Geräten. Nichts ist per Reverse Engineering nachgebaut, und
es wird kein Passwort gespeichert: Die einzige Zugangsberechtigung ist ein
Token, das Sie selbst erstellen und jederzeit widerrufen können.

## Bevor Sie beginnen

Sie benötigen:

- **Gladys 5.2** oder neuer;
- ein **LG ThinQ-Konto**, in dem Ihre Geräte bereits in der mobilen LG ThinQ
  App hinzugefügt sind (diese Integration entdeckt Geräte, sie koppelt sie
  nicht);
- Geräte, die in der App **online** sind;
- das **Land**, in dem Ihr LG-Konto erstellt wurde — LG speichert die Konten auf
  regionalen Servern, und die falsche Region antwortet einfach mit „unbekannter
  Benutzer“.

## Schritt 1 — Ein Personal Access Token erstellen

1. Öffnen Sie <https://connect-pat.lgthinq.com> und melden Sie sich mit **dem
   gleichen LG-Konto** an, das Sie in der ThinQ App verwenden.
2. Klicken Sie auf **Create New Token**.
3. Geben Sie dem Token einen Namen (zum Beispiel `Gladys`).
4. Haken Sie die **Berechtigungen** (Scopes) der Geräte an, die Sie in Gladys
   verwenden möchten. Fehlt eine Berechtigung, ist das Gerät für die
   Integration unsichtbar — haken Sie im Zweifel alles an.
5. Klicken Sie auf **Create Token** und kopieren Sie das Token — LG zeigt es nur
   ein einziges Mal an.

Die Dokumentation von LG zu dieser Seite:
<https://thinq.developer.lge.com/en/cloud/docs/thinq-connect/PAT-en/>

## Schritt 2 — Die Integration in Gladys konfigurieren

1. Öffnen Sie die Integration LG ThinQ in Gladys, Tab **Konfiguration**.
2. Fügen Sie das Token in **Personal Access Token** ein.
3. Wählen Sie das **Land des LG-Kontos**.
4. Klicken Sie auf **Konfiguration speichern**.
5. Klicken Sie auf **Verbindung testen**: Gladys antwortet mit der erreichten
   Region und der Liste der gefundenen Geräte. Wenn das klappt, erscheinen Ihre
   Geräte innerhalb weniger Sekunden im Tab **Geräte**.

Die übrigen Einstellungen sind optional:

- **Aktualisierungsintervall** — wie oft jedes Gerät abgefragt wird (Standard
  5 Minuten, höchstens einmal pro Minute). LG begrenzt die API-Aufrufe pro
  Client, und jedes Gerät kostet einen Aufruf pro Aktualisierung: Senken Sie
  den Wert nur, wenn Sie wenige Geräte besitzen.
- **Temperatureinheit** — LG veröffentlicht jede Temperatur doppelt, in Celsius
  und in Fahrenheit. Nur die gewählte Einheit wird zu einer Gladys-Funktion.
- **Alle numerischen Eigenschaften bereitstellen** — standardmäßig aus.
  Schalten Sie es ein, um auch die Zeitplan-Verschiebungen und Zähler zu
  erhalten, die LG bereitstellt; nützlich, um zu erkunden, was ein bestimmtes
  Gerät meldet.

## Was Sie erhalten

Die Integration liest das **Profil** jedes Geräts — die Beschreibung von LG,
was genau dieses Modell melden und annehmen kann — und baut daraus die
Gladys-Funktionen. Was Sie sehen, hängt also von Ihrer Hardware ab, nicht von
einer fest einprogrammierten Liste:

| Was LG bereitstellt                                     | Was Sie in Gladys erhalten                        |
| ------------------------------------------------------- | ------------------------------------------------- |
| Ein/Aus und andere Ein/Aus-Optionen                     | Ein Schalter, steuerbar und in Szenen verwendbar  |
| Zieltemperatur                                          | Ein Sollwert, mit den Grenzen Ihres Modells       |
| Aktuelle Temperatur, Luftfeuchtigkeit, PM2.5, PM10, CO2 | Sensoren, mit Verlauf und Diagrammen              |
| Filterlebensdauer, Akku                                 | Sensoren, in Prozent                              |
| Restzeit eines Zyklus                                   | Eine Dauer, in Stunden und Minuten                |
| Tür offen/geschlossen                                   | Ein Öffnungssensor                                |
| Betriebsmodus, Betriebszustand, Programmname            | Eine Textfunktion, als Szenen-Auslöser verwendbar |

Ein Gerät wird abgefragt, sobald Sie es hinzufügen, sodass seine Funktionen
sofort einen Wert haben; danach wird alles im konfigurierten Intervall
aktualisiert. Gladys zeigt an jedem Gerät ein **Abzeichen**: `cloud`, wenn LG
antwortet, `unreachable` (orange), wenn das Gerät ausgesteckt oder nicht im
Netzwerk ist.

## Etwas steuern, wofür Gladys keine Funktion hat

Die Modi von LG sind modellspezifisch: Ihre Klimaanlage akzeptiert vielleicht
`COOL`, `HEAT`, `AIR_DRY`, während eine andere auch `ENERGY_SAVING` akzeptiert.
Die Gladys-Funktionen decken das Universelle ab (Ein/Aus, Temperatur, Sensoren);
alles andere ist über zwei Schaltflächen im Tab **Konfiguration** erreichbar:

1. **Eigenschaften auflisten** — wählen Sie ein Gerät, und Gladys zeigt jede
   Eigenschaft, die es akzeptiert, mit den genau zulässigen Werten, zum
   Beispiel:

   ```
   airConJobMode.currentJobMode = COOL | HEAT | AIR_DRY
   temperatureInUnits.targetTemperatureC = 18..30, step 1
   airFlow.windStrength = LOW | MID | HIGH
   ```

2. **Befehl senden** — wählen Sie das Gerät, fügen Sie den Namen der
   Eigenschaft und den Wert ein. Der Befehl wird vor dem Senden mit dem Profil
   abgeglichen, sodass ein Tippfehler mit der Liste der zulässigen Werte
   abgelehnt wird, statt stillschweigend zu scheitern.

## Dashboard-Widgets

In einem Dashboard **Bearbeiten** → ein Widget hinzufügen → Bereich
**Integrations-Widgets**:

- **LG-Gerät** — ein Gerät, in den Widget-Einstellungen gewählt: seine
  Live-Werte (Temperaturen, Luftfeuchtigkeit, Restzeit…), was es gerade tut
  (Zustand, Modus), seine Verbindung zur LG-Cloud sowie die Schaltflächen
  **Ein** / **Aus**, **Aktualisieren** und **Befehl senden**;
- **LG-Geräte** — alle LG-Geräte auf einer Karte, jedes mit seinem Zustand
  („Läuft“, „Beendet“, „Nicht erreichbar“…) und einer Schaltfläche
  **Aktualisieren**.

Die Werte folgen dem Aktualisierungsintervall; **Aktualisieren** fragt LG
sofort ab, außer bei einem Gerät, das in den letzten 2 Minuten bereits
abgefragt wurde: Dann wird seine letzte Abfrage angezeigt (jeder LG-Aufruf
zählt gegen Ihr Kontingent). Nur die zu Gladys hinzugefügten Geräte werden
angezeigt.

**Befehl senden** öffnet ein kleines Formular in der Karte: Wählen Sie eine der
Eigenschaften, die das Gerät akzeptiert (seine änderbaren Eigenschaften, nach
Namen aufgelistet), und geben Sie den Wert ein — `COOL`, `22`, `true`… Es
macht genau dasselbe wie die Schaltfläche **Befehl senden** im Tab
Konfiguration: Der Wert wird mit dem abgeglichen, was das Gerät akzeptiert,
bevor irgendetwas gesendet wird, und **Eigenschaften auflisten** zeigt die
akzeptierten Werte. Bei einem Gerät ohne änderbare Eigenschaft fehlt die
Schaltfläche.

## Szenen

### Auslöser

Im Szenen-Editor, Kategorie **Integrationen**:

| Auslöser                                      | Wann                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| **LG-Gerät: Zyklus beendet**                  | Eine Waschmaschine, ein Trockner, Geschirrspüler oder Backofen ist fertig |
| **LG-Gerät: Zustand geändert**                | Der Betriebszustand ändert sich (`RUNNING`, `RINSING`, `END`…)            |
| **LG-Gerät: Verbindung verloren / wieder da** | Das Gerät verlässt die LG-Cloud oder kehrt zurück                         |

Ein leer gelassener Filter bedeutet „beliebig“. Der Filter **Neuer Zustand**
erwartet den genauen LG-Wert, in Großbuchstaben (`END`, `RUNNING`…):
**Eigenschaften auflisten** zeigt die Werte jedes Geräts.

Die nächsten Aktionen der Szene können den Gerätenamen, das Teilgerät
(Waschmaschine oder Trockner eines WashTower), den neuen und den vorherigen
Zustand wiederverwenden. Beispiel: „Zyklus beendet“ → eine Nachricht senden
„{{triggerEvent.data.device_name}} ist fertig“.

Gut zu wissen:

- Änderungen werden **bei der nächsten Abfrage** des Geräts erkannt: Ein Zyklus,
  der endet, wird höchstens ein Aktualisierungsintervall später gemeldet;
- beim Start der Integration wird nichts ausgelöst: Eine Änderung braucht ein
  „Vorher“ und ein „Nachher“;
- eine durch eine Aktion verursachte Abfrage (Schaltfläche, Szene, Befehl) löst
  nicht sofort etwas aus — das erledigt die nächste reguläre Abfrage. So kann
  sich eine Szene nicht selbst in einer Schleife erneut auslösen.

### Aktionen

| Aktion                      | Was sie tut                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **LG-Gerät: Befehl senden** | Wie die Schaltfläche **Befehl senden**: jede Eigenschaft, vor dem Senden geprüft                                   |
| **LG-Gerät: Zustand lesen** | Fragt das Gerät sofort ab und übergibt den nächsten Aktionen: verbunden (ja/nein), Betriebszustand, Restzeit (min) |

Beispiel: jeden Abend um 22 Uhr „Zustand lesen“ der Waschmaschine → Bedingung
„Betriebszustand = `END`“ → Benachrichtigung „Waschmaschine ausräumen“.

„Zustand lesen“ ruft LG höchstens einmal alle 2 Minuten pro Gerät auf:
innerhalb dieses Abstands erhält die Szene die letzte Abfrage.

## Fehlerbehebung

**„LG hat die Zugangsdaten abgelehnt“** — das Token oder das Land ist falsch.
Tokens sind an das Konto gebunden, das sie erstellt hat: Prüfen Sie, dass Sie
dasselbe LG-Konto wie in der ThinQ App verwendet haben, und wählen Sie das
Land, in dem das Konto erstellt wurde.

**Ein Gerät fehlt** — entweder wurde seine Berechtigung beim Erstellen des
Tokens nicht angehakt (erstellen Sie ein neues Token mit den richtigen
Berechtigungen), oder es wurde der LG-App hinzugefügt, nachdem Gladys zuletzt
nachgesehen hat. Klicken Sie auf **Geräteliste aktualisieren**.

**Ein Gerät zeigt ein oranges Abzeichen `unreachable`** — LG meldet es als
nicht verbunden. Prüfen Sie in der LG ThinQ App, dass es mit Strom versorgt
und mit dem WLAN verbunden ist; das Abzeichen verschwindet bei der nächsten
Aktualisierung von selbst.

**Ein gerade hinzugefügtes Gerät zeigt „Kein aktueller Wert“** — das Gerät wird
in dem Moment abgefragt, in dem Sie es hinzufügen; das bedeutet also, dass LG
in diesem Augenblick nichts zu melden hatte: Das Gerät ist meist nicht im
Netzwerk (achten Sie auf das orange Abzeichen). Die nächste Aktualisierung
füllt die Funktionen, sobald LG wieder antwortet.

**Das Widget LG-Gerät zeigt „settings.device: must be at most 100
characters“** — das Gerät wurde mit Version 2.0.0 oder älter hinzugefügt, deren
Kennung für ein Widget zu lang war. Löschen Sie nach dem Update das Gerät in
Gladys, fügen Sie es über den Tab **Entdecken** erneut hinzu und wählen Sie es
dann in den Widget-Einstellungen neu aus. Der Verlauf des alten Geräts und die
Szenen, die es verwenden, müssen neu angelegt werden.

**„Aufrufkontingent überschritten“** — erhöhen Sie das
Aktualisierungsintervall. LG zählt die Aufrufe jedes Clients, und eine
Aktualisierung kostet einen Aufruf pro Gerät.

**Ein Befehl wird abgelehnt** — LG lehnt Befehle ab, die ein Gerät in seinem
aktuellen Zustand nicht ausführen kann (eine Waschmaschine mit offener Tür
starten, den Modus ändern, während sie aus ist). Der Grund wird unter der
Schaltfläche und in den Protokollen der Integration angezeigt.

## Datenschutz

Das Personal Access Token wird von Gladys verschlüsselt gespeichert und nie an
Ihren Browser zurückgesendet. Es kann jederzeit unter
<https://connect-pat.lgthinq.com> widerrufen werden, was den Zugriff dieser
Integration sofort unterbindet, ohne Ihr LG-Konto zu berühren.
