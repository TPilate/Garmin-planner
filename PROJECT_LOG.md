# Journal de projet — Garmin Planner

Ce fichier trace les décisions majeures et l'avancement, pour garder le contexte entre sessions. Le plan complet (schéma, algorithme de dérivation des types de jour, phasage) est dans `C:\Users\kyura\.claude\plans\planning-task-shift-aware-unified-mccarthy.md`.

## Décisions d'architecture (confirmées avec l'utilisateur)

- **Offline** : serveur-autoritaire pour le MVP. Lecture seule en cache hors-ligne (PWA), toute écriture nécessite le réseau.
- **Hébergement** : VPS/cloud + Turso (libSQL). Litestream abandonné (Turso gère déjà la réplication/backup).
- **Auth** : PIN unique partagé, cookie de session scellé (`nuxt-auth-utils`), pas de table utilisateurs.
- **Ingestion Garmin** : le worker Python n'a **aucun accès direct à la DB**. Il appelle `garth` puis POST les payloads bruts vers `/api/internal/garmin/ingest` (token bearer), qui écrit via Drizzle côté Nitro. Choix délibéré pour rendre Python "schema-blind" par construction.
- **Driver DB** : `@libsql/client` partout (local en fichier, prod sur Turso) — pas de `better-sqlite3` séparé, pour éviter toute divergence de dialecte SQL entre deux bindings.

## Avancement

### Phase 1 — Squelette, auth, plomberie DB (terminée et testée)
- [x] `package.json` (Nuxt 4.5.2, @vite-pwa/nuxt, drizzle-orm, @libsql/client, drizzle-kit, nuxt-auth-utils, zod, vitest)
- [x] `nuxt.config.ts` — PWA config (cache lecture-seule via StaleWhileRevalidate sur `/api/roster` et `/api/day-summary`, manifest, devOptions pour tester sur iPhone réel)
- [x] `drizzle.config.ts` — dialect sqlite, driver turso
- [x] `.env.example` — TURSO_URL, TURSO_AUTH_TOKEN, SESSION_SECRET, APP_PIN, INGEST_TOKEN, APP_TIMEZONE
- [x] `db/schema/shifts.ts` — shift_codes, roster_months, shifts, leave_periods (avec commentaires expliquant chaque choix de modélisation : category vs code littéral, append vs derive-from-absence, etc.)
- [x] `db/schema/garmin.ts` — raw_garmin_payloads (append-only), garmin_daily_metrics (raw vs derived séparés)
- [x] `db/schema/ocr.ts` — ocr_uploads (phase 5, schéma préparé à l'avance)
- [x] `db/schema/sessions.ts` — session_templates, logged_sessions (phase 6, sketch)
- [x] `db/schema/index.ts` — barrel export
- [x] `db/client.ts` — client Drizzle partagé (@libsql/client)
- [x] `db/seed.ts` — seed des shift_codes (J/N/1-2)
- [x] Auth : `server/utils/session.ts`, `server/middleware/0.auth.ts`, `server/api/auth/{login,logout}.post.ts`, `app/pages/login.vue`, `app/middleware/auth.global.ts`, `app/pages/index.vue` (redirect), `app/pages/roster/[year]/[month].vue` (stub, contenu réel en phase 2)
- [x] `npm install` + première génération/application de migration Drizzle (`db/migrations/0000_perpetual_doctor_strange.sql`, 9 tables)
- [x] Squelette worker Python (`python-worker/garmin_sync/{source,garth_source,ingest_client,main}.py`) + script de spike `scripts/spike-garth-sync.py` (phase 0b, aucune écriture DB)
- [x] Smoke-test manuel du serveur de dev : `/` redirige vers `/login` si non authentifié (302), mauvais PIN → 401, bon PIN → 200 + cookie de session scellé (`nuxt-session`, HttpOnly/Secure/SameSite=Lax), accès API non authentifié → 401 via le middleware Nitro. **Tout fonctionne comme prévu.**

**Problèmes d'environnement rencontrés et résolus :**
- Nuxt 4.5.2 (via rolldown-vite) exige Node `^20.19.0 || ^22.12.0 || >=23`. La machine avait Node v20.15.0 (nvm-windows). `nvm install 22`/`nvm use 22` ont échoué silencieusement (nvm-windows a besoin d'une élévation UAC que ce shell non-interactif ne peut pas fournir). **Contournement temporaire** : Node 22.23.2 portable téléchargé et extrait dans le dossier scratchpad de session (`.../scratchpad/node22/`) — **ce dossier disparaît à la fin de la session**. ⚠️ Pour que `npm install`/`npm run dev` fonctionnent après cette session, il faut installer Node 22+ durablement sur la machine (soit `nvm install 22 && nvm use 22` depuis un terminal PowerShell/cmd lancé **en administrateur**, soit l'installeur officiel nodejs.org).
- `npm install` seul plante avec `Cannot read properties of null (reading 'edgesOut')` (bug connu de l'arborist npm face au graphe de peerDependencies optionnelles de `@vite-pwa/nuxt`/vite, reproductible même avec npm 10.9.8 sous Node 22). **Solution** : utiliser `npm install --legacy-peer-deps`. À utiliser systématiquement pour ce projet tant que ce bug npm n'est pas corrigé en amont.
- `drizzle.config.ts` : `driver: 'turso'` n'est plus une valeur valide dans drizzle-kit 0.31.10 (enum restreint à `d1-http`/`expo`/`durable-sqlite`/`aws-data-api`/`pglite`). Retiré du config — `dialect: 'sqlite'` + `dbCredentials.url` suffit, que l'URL soit un fichier local ou une URL Turso/libSQL.

### Phase 2 — Grille de roster manuelle (terminée et testée en backend ; UI non testée dans un navigateur)
- [x] `server/utils/calendar.ts` — squelette du mois généré côté serveur (jamais confié au client/modèle), calcul premier/dernier jour, jour précédent (pour la logique cross-mois de dayType.ts en phase 4)
- [x] `server/utils/shiftResolution.ts` — résolution `startsAt`/`endsAt` via **luxon**, timezone-aware (corrige le risque DST identifié dans le plan)
- [x] `server/api/roster/[year]/[month].get.ts` — fusionne squelette calendaire + shifts + congés ; absence de code = repos (jamais stocké)
- [x] `server/api/roster/[year]/[month].put.ts` — sauvegarde en masse ; upsert `roster_months` en `draft` ; **éditer un mois confirmé le repasse en draft** (garde-fou : un mois édité-mais-non-revu ne doit jamais ressembler à un mois revu)
- [x] `server/api/roster/[year]/[month]/confirm.post.ts` — vérification de plausibilité [18,22] jours travaillés, override explicite requis sinon
- [x] `server/api/roster/leave.post.ts` — tag d'une période de congé/maladie
- [x] `server/api/shift-codes.get.ts` / `.put.ts` — lecture + upsert admin
- [x] UI : `app/composables/useMonth.ts`, `app/components/calendar/{MonthGrid,DayCell}.vue`, `app/pages/roster/[year]/[month].vue` (grille tap-to-cycle, navigation mois précédent/suivant, bouton confirmer avec prompt d'override), `app/pages/admin/shift-codes.vue` (CRUD simple)
- [x] **Tests end-to-end réels via curl** (serveur de dev lancé, authentifié) : GET roster renvoie bien 30 jours avec `code: null` par défaut ; PUT avec un `N` le 6/09 confirmé en base avec `starts_at = 2026-09-06T18:00Z` → `ends_at = 2026-09-07T06:00Z` (soit 20h00→08h00 heure de Paris, **traversée de minuit correcte**) ; confirm sans override sur 2 jours travaillés → `requiresOverride: true` ; avec override → statut `confirmed` ; ré-éditer un mois confirmé → repasse bien en `draft` ; POST congé fonctionne. **Base de données remise à zéro (migrée + seedée) après les tests.**
- [ ] UI non vérifiée dans un vrai navigateur (seul le backend a été testé via curl) — à faire avant de considérer la phase 2 pleinement livrée.

### Phase 3 — Worker Garmin + endpoint d'ingestion (terminée et testée)
- [x] `server/api/internal/garmin/ingest.post.ts` — auth par bearer token (`INGEST_TOKEN`, comparaison timing-safe), jamais le cookie de session ; stocke le payload brut (append-only) puis normalise
- [x] `server/utils/garminNormalize.ts` — mapping metricType → colonnes de `garmin_daily_metrics`, **marqué explicitement comme brouillon** (les chemins JSON exacts de garth ne sont pas confirmés — c'est justement l'objet du spike phase 0b) ; chaque accès est défensif (optional chaining) pour qu'une forme inattendue laisse un champ à `null` plutôt que de faire planter toute la normalisation du jour
- [x] Merge additif : deux ingestions sur la même date (ex: `resting_hr` puis `sleep`) fusionnent leurs colonnes respectives dans **une seule ligne** `garmin_daily_metrics`, sans écraser les champs déjà écrits par un autre `metricType`
- [x] **Tests end-to-end réels via curl** : sans token → 401 ; mauvais token → 401 ; bon token + `resting_hr` puis `sleep` sur la même date → vérifié en base : une seule ligne avec `resting_hr=52`, `sleep_score=78`, `sleep_duration_minutes=420`, et `raw_garmin_payloads` contient bien les 2 entrées séparées (append-only confirmé)

### Phase 4 — Dérivation jour/intensité + vue mensuelle (ligne de livraison MVP — terminée et testée)
- [x] `server/utils/dayType.ts` — implémentation complète de l'algorithme du plan : guard NO_DATA (mois courant + mois du jour précédent doivent être confirmés, gère le passage inter-mois), POST_NIGHT prioritaire même en cas de nuits consécutives, ceilings par type de jour, ajustement Garmin par baseline (médiane/IQR glissants sur 28 jours, uniquement `restingHr`/`hrvLastNight` bruts — jamais les scores dérivés Garmin), plancher MOBILITY (Garmin ne force jamais REST hors POST_NIGHT), fail-safe UNKNOWN → REST
- [x] **Bug de conception détecté et corrigé avant tout test** : le calcul de la baseline appelait initialement `getDaySummary()` (récursif) pour exclure les jours dégradés, ce qui aurait ré-invoqué le calcul de baseline pour chacun des 28 jours de la fenêtre → explosion combinatoire. Corrigé en extrayant `classifyDay()`, une classification légère (roster/shift uniquement, sans Garmin ni baseline) que `computeBaseline()` peut appeler en boucle sans jamais récurser dans un autre calcul de baseline.
- [x] `server/api/day-summary/[year]/[month].get.ts` — un `DaySummary` par jour du mois, squelette généré côté serveur
- [x] UI : `app/components/calendar/{IntensityBadge,DegradedBanner}.vue`, `DayCell.vue` enrichi (badge de ceiling + repère 🌙 sur les jours dégradés), page roster enrichie (bannière de dégradation, rechargement du day-summary après save/confirm)
- [x] **Suite de tests unitaires réelle** (`vitest`, base SQLite de test dédiée migrée via `drizzle-orm/libsql/migrator`, jamais la base de dev) — **15/15 tests passent**, couvrant chaque branche : NO_DATA (jamais entré / draft / garde inter-mois non confirmée), OFF/HALF/LONG_DAY/PRE_NIGHT/POST_NIGHT/LEAVE/UNKNOWN, nuits consécutives (POST_NIGHT gagne quand même), ajustement baseline à -1/-2 crans (calculs de médiane/IQR vérifiés à la main), plancher MOBILITY jamais franchi même avec un Garmin très anormal sur un `long_day`. Fichiers : `vitest.config.ts`, `test/setup.ts`, `test/helpers.ts`, `test/dayType.test.ts`.
- [x] **Bug SSR découvert et corrigé via test réel du rendu de page** : le premier chargement serveur de `/roster/[year]/[month]` renvoyait 401 parce que les appels `$fetch` internes pendant le SSR ne transmettent pas automatiquement le cookie de session de la requête entrante. Corrigé en remplaçant `$fetch` par `useRequestFetch()` dans `app/composables/useMonth.ts` (compose Nuxt dédié qui propage les headers/cookies de la requête en cours). Revérifié après coup : page rendue en 200, badges d'intensité et bannière de dégradation visibles dans le HTML SSR (`Statut : Confirmé`, badges `Mobilité`/`Intense`, bannière "2 jours... ont des données Garmin non fiables", 2 repères 🌙).
- [ ] **UI non vérifiée visuellement dans un vrai navigateur** — l'extension Claude in Chrome n'a pas été connectée dans cette session (proposée, déclinée). Tout a été validé via curl/HTML brut côté SSR, ce qui couvre beaucoup mais pas l'interactivité client (clic pour cycler les codes, navigation mois précédent/suivant, etc.). **À faire par toi dans un navigateur avant de considérer l'UI pleinement validée.**

### Spikes (0a iOS push, 0b garth headless) — non exécutés, nécessitent ton implication directe
- [ ] **0a (notification iOS réelle)** : nécessite un vrai iPhone et une installation sur l'écran d'accueil — je ne peux pas exécuter cette étape à ta place. Le scaffold PWA (`nuxt.config.ts` avec `@vite-pwa/nuxt`, manifest, `devOptions.enabled`) est en place et prêt à recevoir la logique VAPID/Web Push quand tu seras prêt à tester.
- [ ] **0b (fiabilité de garth sur 2-3 semaines)** : `scripts/spike-garth-sync.py` est prêt (aucune écriture DB, dump JSON quotidien dans `scripts/spike-garth-sync-output/`) mais nécessite tes identifiants Garmin réels et 2-3 semaines d'exécution quotidienne non supervisée (cron/tâche planifiée) — je ne peux pas faire s'écouler ce temps ni fournir tes identifiants. **C'est la prochaine étape concrète que toi seul peux lancer.**

## Points d'attention reportés du plan (à ne pas oublier)
- Ceiling du jour `HALF` fixé à `HARD` par hypothèse (le brief ne donnait qu'un rang relatif) — à corriger si l'usage réel contredit.
- `shift_codes.category` non reconnu → fail-safe `UNKNOWN → REST`, avec avertissement à prévoir dans l'écran admin.
- `starts_at`/`ends_at` des shifts DOIVENT être calculés avec une lib timezone-aware (Luxon/date-fns-tz) sur `APP_TIMEZONE`, jamais en arithmétique naïve (risque silencieux aux 2 nuits de changement d'heure/an).
- `server/utils/dayType.ts` est le fichier le plus critique du projet (risque de bug silencieux le plus élevé) — tests unitaires obligatoires sur chaque branche avant de considérer le MVP livré.
