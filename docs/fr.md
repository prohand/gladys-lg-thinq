# LG ThinQ

Cette intégration connecte Gladys Assistant aux appareils enregistrés sur votre
compte LG — climatiseur, lave-linge, sèche-linge, lave-vaisselle, réfrigérateur,
four, purificateur d'air, aspirateur robot… — via l'**API officielle LG ThinQ
Connect**.

C'est une intégration **cloud** : Gladys parle aux serveurs LG, et LG parle à vos
appareils. Rien n'est rétro-conçu, et aucun mot de passe n'est stocké : le seul
identifiant est un jeton que vous créez vous-même et que vous pouvez révoquer à
tout moment.

## Avant de commencer

Il vous faut :

- un **compte LG ThinQ** avec vos appareils déjà ajoutés dans l'application
  mobile LG ThinQ (cette intégration découvre les appareils, elle ne les appaire
  pas) ;
- des appareils **en ligne** dans l'application ;
- le **pays** dans lequel le compte LG a été créé — LG héberge les comptes sur
  des serveurs régionaux, et une mauvaise région répond simplement
  « utilisateur inconnu ».

## Étape 1 — Créer un jeton d'accès personnel

1. Ouvrez <https://connect-pat.lgthinq.com> et connectez-vous avec **le même
   compte LG** que dans l'application ThinQ.
2. Cliquez sur **Create New Token**.
3. Donnez un nom au jeton (par exemple `Gladys`).
4. Cochez les **autorisations** correspondant aux appareils que vous voulez
   utiliser dans Gladys. Une autorisation manquante rend l'appareil invisible
   pour l'intégration : dans le doute, cochez tout.
5. Cliquez sur **Create Token** et copiez le jeton — LG ne l'affiche qu'une fois.

La documentation LG de cet écran :
<https://thinq.developer.lge.com/en/cloud/docs/thinq-connect/PAT-en/>

## Étape 2 — Configurer l'intégration dans Gladys

1. Ouvrez l'intégration LG ThinQ dans Gladys, onglet **Configuration**.
2. Collez le jeton dans **Jeton d'accès personnel**.
3. Choisissez le **pays du compte LG**.
4. Enregistrez.
5. Cliquez sur **Tester la connexion** : Gladys répond avec la région jointe et
   la liste des appareils trouvés. Si cela fonctionne, vos appareils apparaissent
   dans l'onglet **Appareils** en quelques secondes.

Les autres réglages sont optionnels :

- **Intervalle de rafraîchissement** — la fréquence de lecture de chaque appareil
  (5 minutes par défaut). LG limite le nombre d'appels d'API par client et chaque
  appareil coûte un appel par rafraîchissement : ne le baissez que si vous avez
  peu d'appareils.
- **Unité de température** — LG publie chaque température deux fois, en Celsius
  et en Fahrenheit. Seule l'unité choisie devient une fonctionnalité Gladys.
- **Exposer toutes les propriétés numériques** — désactivé par défaut. Activez-le
  pour récupérer aussi les décalages de programmation et les compteurs exposés
  par LG ; utile pour explorer ce que remonte un appareil précis.

## Ce que vous obtenez

L'intégration lit le **profil** de chaque appareil — la description par LG de ce
que ce modèle précis sait remonter et accepter — et en déduit les fonctionnalités
Gladys. Ce que vous voyez dépend donc de votre matériel, pas d'une liste figée :

| Ce que LG expose                                 | Ce que vous obtenez dans Gladys                        |
| ------------------------------------------------ | ------------------------------------------------------ |
| Marche/arrêt, et autres options on/off           | Un interrupteur pilotable, utilisable dans les scènes  |
| Température de consigne                          | Une consigne, avec les bornes de votre modèle          |
| Température, humidité, PM2.5, PM10, CO2 mesurées | Des capteurs, avec historique et graphiques            |
| Usure du filtre, batterie                        | Des capteurs, en pourcentage                           |
| Temps restant d'un cycle                         | Une durée, en heures et minutes                        |
| Porte ouverte/fermée                             | Un capteur d'ouverture                                 |
| Mode en cours, état, nom du programme            | Une fonctionnalité texte, utilisable comme déclencheur |

Tout est rafraîchi selon l'intervalle configuré, et Gladys affiche un **badge**
sur chaque appareil : `cloud` quand LG répond, `unreachable` (orange) quand
l'appareil est débranché ou hors réseau.

## Piloter ce dont Gladys n'a pas de fonctionnalité

Les modes LG dépendent du modèle : votre climatiseur peut accepter `COOL`,
`HEAT`, `AIR_DRY`, quand un autre accepte aussi `ENERGY_SAVING`. Les
fonctionnalités Gladys couvrent l'universel (marche/arrêt, température,
capteurs) ; tout le reste est accessible par deux boutons de l'onglet
**Configuration** :

1. **Lister les propriétés** — choisissez un appareil, et Gladys affiche chaque
   propriété acceptée avec les valeurs exactes autorisées, par exemple :

   ```
   airConJobMode.currentJobMode = COOL | HEAT | AIR_DRY
   temperatureInUnits.targetTemperatureC = 18..30, step 1
   airFlow.windStrength = LOW | MID | HIGH
   ```

2. **Envoyer une commande** — choisissez l'appareil, collez le nom de la
   propriété et la valeur. La commande est vérifiée contre le profil avant
   l'envoi : une faute de frappe est refusée avec la liste des valeurs
   autorisées, plutôt qu'un échec silencieux.

## Dépannage

**« LG a refusé les identifiants »** — le jeton ou le pays est incorrect. Les
jetons sont liés au compte qui les a créés : vérifiez que vous utilisez le même
compte LG que dans l'application ThinQ, et choisissez le pays de création du
compte.

**Un appareil manque** — soit son autorisation n'était pas cochée à la création
du jeton (recréez un jeton avec les bonnes autorisations), soit il a été ajouté
dans l'application LG après la dernière lecture de Gladys. Cliquez sur
**Rafraîchir la liste des appareils**.

**Un appareil affiche un badge orange `unreachable`** — LG le signale comme non
connecté. Vérifiez qu'il est alimenté et connecté au Wi-Fi dans l'application LG
ThinQ ; le badge disparaît au rafraîchissement suivant.

**« Quota d'appels dépassé »** — augmentez l'intervalle de rafraîchissement. LG
compte les appels de chaque client, et un rafraîchissement coûte un appel par
appareil.

**Une commande est refusée** — LG rejette les commandes qu'un appareil ne peut
pas honorer dans son état actuel (démarrer un lave-linge dont la porte est
ouverte, changer le mode alors qu'il est éteint). La raison s'affiche sous le
bouton et dans les logs de l'intégration.

## Vie privée

Le jeton d'accès personnel est stocké chiffré par Gladys et n'est jamais renvoyé
à votre navigateur. Il peut être révoqué à tout moment depuis
<https://connect-pat.lgthinq.com>, ce qui coupe immédiatement l'accès de cette
intégration sans toucher à votre compte LG.
