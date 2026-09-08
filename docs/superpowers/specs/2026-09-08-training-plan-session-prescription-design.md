# Phase 6 — Plans d'entraînement & prescription de séances

## Contexte

Le projet Garmin Planner adapte déjà, pour chaque jour, un plafond d'intensité
(`rest`/`mobility`/`easy`/`moderate`/`hard`) en croisant le planning de garde
(`server/utils/dayType.ts`) et les données Garmin brutes (HR repos, HRV vs
baseline glissante 28 jours). Ce plafond existe depuis la Phase 4 et est
testé (15/15 tests unitaires).

Ce qui manque, et que cette phase construit : transformer ce plafond en
**séance concrète** ("45min seuil, zone 3" plutôt que juste "moderate"), en
tenant compte d'objectifs de progression par discipline et du temps
réellement disponible autour de chaque garde — pour produire un planning
détaillé, jour par jour, qui dit exactement quoi faire.

Cette spec ne couvre **pas** la récupération des données Garmin (Phase 3,
déjà livrée et testée — `garth` via le worker Python, conservé tel quel après
évaluation des alternatives ci-dessous) ni la dérivation du plafond
d'intensité (Phase 4, déjà livrée).

### Alternatives évaluées pour l'ingestion Garmin (rappel, aucun changement)

- **API officielle Garmin Connect Developer Program** : écartée — réservée
  aux personnes morales, pas de self-serve individuel, inscriptions
  suspendues en 2026.
- **Serveurs MCP Garmin** (`Taxuspt/garmin_mcp`, `Nicolasvegam/garmin-connect-mcp`,
  etc.) : wrappent la même API non-officielle que `garth`. Conçus pour une
  interrogation ponctuelle par un assistant IA, pas pour une synchronisation
  quotidienne non supervisée écrivant en base — ne remplacent pas le besoin
  couvert par le worker Python.
- **Libs Node/TS non-officielles** (`garmin-connect-sdk`, etc.) :
  remplaceraient le worker Python par du TypeScript natif, mais pour un gain
  marginal face au coût de réécriture d'une brique déjà testée bout-en-bout.
  Piste à garder pour une simplification future, hors scope ici.

**Décision** : le worker Python + `garth` est conservé sans modification.

## Décisions confirmées avec l'utilisateur

- **Disciplines** : course à pied, natation, musculation actives dès le
  départ. Vélo modélisé mais **inactif** (`active=false`) — pas d'équipement
  disponible pour l'instant ; l'activer plus tard doit être un simple flip de
  flag + ajout de templates, sans changement d'algorithme.
- **Type d'objectif par discipline** : pas de course/date cible — progression
  continue pilotée par la charge (volume/intensité, périodisation avec
  décharge), avec des indicateurs de forme (allure seuil course, allure/100m
  natation, charges clés muscu, FTP vélo plus tard) suivis pour vérifier que
  ça progresse réellement, sans piloter directement la sélection des
  séances.
- **Musculation** : objectif de progression à part entière (comme une 4e
  discipline), pas un simple support pour l'endurance.
- **Niveau de départ** : saisie manuelle par discipline au démarrage du plan
  (pas de dérivation automatique depuis l'historique Garmin).
- **Contraintes d'accès** : piscine, salle de muscu et lieu de course
  accessibles en continu — seule la fenêtre de temps issue du planning de
  garde contraint le choix. Aucune contrainte d'horaire à modéliser pour ces
  trois disciplines.
- **Fenêtre de temps** : calculée précisément à partir de `startsAt`/`endsAt`
  des gardes (déjà en base, timezone-aware), pas de catégories de durée
  forfaitaires.
- **Bouclage des données** : log manuel uniquement (`logged_sessions`
  existant : `actualRpe`, `actualDurationMinutes`, `notes`). Pas de
  détection automatique via les activités Garmin dans cette phase — scope
  volontairement limité.
- **Séances par jour** : 1 séance maximum, même les jours avec beaucoup de
  temps libre (v1).
- **Répartition hebdomadaire** : fréquence cible par discipline (ex: ~3x
  course, 1-2x natation, 2x muscu par semaine), le système priorise en
  fonction de cette cible plutôt qu'un simple remplissage adaptatif sans
  cible.

## Approche retenue : périodisation calculée, jamais stockée

Trois approches ont été comparées pour savoir "où en est" chaque discipline
dans son cycle de charge/décharge :

1. **État persisté** (table de compteur bloc/semaine avancée explicitement) —
   écarté : introduit un état muable à resynchroniser, ce que le projet évite
   déjà ailleurs (les jours de repos ne sont jamais stockés, seulement
   dérivés).
2. **Calcul à la volée par comptage calendaire pur** — écarté seul : ignore
   les semaines réellement ratées (ex: mois de gardes de nuit difficile), la
   progression avancerait plus vite que la réalité.
3. **Hybride calculé** (retenu) : le bloc/semaine/phase de chaque discipline
   est recalculé à chaque lecture depuis l'historique réel des
   `logged_sessions`, sur le même principe que `computeBaseline()` dans
   `dayType.ts` (fenêtre glissante recalculée, jamais de compteur séparé). Une
   semaine ne fait avancer le bloc que si un minimum de séances ont été
   complétées ; sinon elle se répète la semaine suivante. Aucun nouvel état à
   garder synchronisé, adaptatif aux mois difficiles par construction.

## Architecture & composants

Nouveau sous-système greffé sur l'existant, sans modifier `dayType.ts` :

- **`db/schema/goals.ts`** (nouveau) — table `discipline_goals`.
- **`db/schema/sessions.ts`** (étendu) — `session_templates` et
  `logged_sessions` complétées (voir Modèle de données).
- **`server/utils/trainingPlan.ts`** (nouveau, même famille que
  `dayType.ts`) — fonctions pures :
  - `getAvailableWindow(date)`
  - `getDisciplineProgress(discipline, date)`
  - `getDailyPrescription(date)`
- **UI** — `DayCell.vue`/`IntensityBadge.vue` enrichis (nom de la
  discipline/séance du jour) + vue détail au clic (structure complète de la
  séance, `structureJson`). Réutilise les pages roster existantes.

## Modèle de données

### `discipline_goals` (nouvelle table)

```
discipline             enum('running','swimming','strength','cycling')  PK
active                 bool
weeklyFrequencyTarget  int              -- ex: 3 pour course, 2 pour natation/muscu
blockLengthWeeks       int, default 4  -- semaines de charge avant décharge (5e semaine = deload)
planStartDate          text (date)     -- point de départ du calcul de bloc/semaine
baselineJson           text            -- niveau de départ saisi manuellement (allure seuil,
                                        -- allure/100m, charges clés) ; ignoré pour cycling
                                        -- tant qu'inactive
createdAt/updatedAt    timestamp_ms
```

### `session_templates` (existante, complétée)

```
+ durationMinutes  int              -- durée nécessaire, comparée à la fenêtre libre du jour
+ phase            enum('build','deload','any'), default 'any'
```

### `logged_sessions` (existante, complétée)

```
+ status  enum('planned','completed','skipped'), default 'planned'
```

Une ligne `planned` est créée la première fois que le jour est consulté
(généré à la lecture, comme `day-summary` — jamais pré-généré en masse). Si
l'utilisateur logue une séance manuellement sur un jour déjà `planned`, la
même ligne passe à `completed`/`skipped` plutôt que d'en créer une seconde —
cohérent avec la règle "1 séance par jour max".

## Algorithme de prescription — `getDailyPrescription(date)`

1. **Ceiling du jour** — appelle `getDaySummary(date)` (existant, inchangé).
   Si `ceiling === 'rest'` ou `dayType === 'no_data'` → pas de séance, fin.
2. **Fenêtre de temps** — `getAvailableWindow(date)` : minutes libres
   avant/après la garde (`max(startsAt - startOfDay, endOfDay - endsAt)`),
   ou plage large si repos/congé (pas de ligne `shifts` ce jour-là).
3. **Progression par discipline active** — pour chaque discipline avec
   `active=true` (vélo exclu tant que `active=false`) :
   - `getDisciplineProgress(discipline, date)` : une seule requête récupère
     tous les `logged_sessions` de la discipline depuis `planStartDate`,
     agrégation en mémoire par semaine ISO → détermine le bloc/semaine/phase
     courants. Une semaine ISO fait avancer le compteur de bloc si elle
     contient au moins `weeklyFrequencyTarget - 1` séances `completed` de
     cette discipline (tolère une séance manquée sur la cible) ; en-dessous,
     la semaine suivante répète la même position de bloc/semaine au lieu
     d'avancer.
   - `deficit = weeklyFrequencyTarget - séances completed cette semaine ISO`.
4. **Priorité** — trie les disciplines avec `deficit > 0` par urgence
   (`deficit / joursRestantsDansLaSemaineISO`) décroissante. Égalité
   départagée par la discipline dont la dernière séance loggée est la plus
   ancienne (déterministe — jamais de choix aléatoire, un jour non-encore-
   loggé doit toujours renvoyer la même proposition si on le recharge).
5. **Sélection du template** — pour la discipline en tête de priorité :
   cherche un `session_templates` non archivé avec `targetIntensity <=
   ceiling` (échelle `INTENSITY_ORDER` existante), `durationMinutes <=
   fenêtre`, `phase ∈ {phase courante, 'any'}`. Plusieurs candidats : écarte
   ceux utilisés dans les N derniers jours (variété), puis prend le plus
   petit `id` restant (déterministe). Aucun candidat pour cette discipline →
   essaie la discipline suivante dans l'ordre de priorité.
6. **Fallback** — aucune discipline ne matche (fenêtre trop courte ou
   ceiling trop bas pour tous les templates disponibles) → pas de séance ce
   jour-là, avec une raison explicite (même principe que le `reason` déjà
   présent dans `DaySummary`).
7. **Persistance** — upsert d'une ligne `logged_sessions(status='planned')`
   pour cette date, uniquement si aucune ligne n'existe déjà pour ce jour
   (ne jamais écraser une séance déjà loguée, `completed` ou `skipped`).

## Cas limites & gestion d'erreurs

- **Roster non confirmé** — `getDaySummary` renvoie déjà `no_data` ;
  `getDailyPrescription` répercute l'absence de prescription sans logique
  nouvelle.
- **Discipline sans `discipline_goals` configuré** (avant la saisie
  initiale) — exclue silencieusement des candidats, jamais une erreur.
- **Vélo** — filtré au même endroit que "pas de template disponible" via
  `active=false`, zéro branche spéciale dans l'algorithme.
- **Séance déjà loguée le jour même** — la génération ne touche jamais une
  ligne `completed`/`skipped` existante ; elle ne crée que si la date est
  vide.
- **Aucun template ne matche** — résultat explicite "pas de séance, raison:
  ..." plutôt qu'un silence ambigu.
- **Changement rétroactif de `weeklyFrequencyTarget`/`blockLengthWeeks`** —
  tout étant recalculé à la lecture, un changement de config ne casse rien ;
  il change le calcul pour les jours futurs seulement, les séances déjà
  `completed` ne sont jamais recalculées.
- **Semaine ISO à cheval sur un mois de roster non confirmé** —
  `getDisciplineProgress` compte les séances *loggées*, pas les jours de
  roster ; aucune dépendance au statut de confirmation du roster (seul
  `getDaySummary` du jour courant en dépend).

## Plan de tests

Même rigueur que `dayType.ts` (fichier le plus critique du projet à ce
jour, 15/15 tests) — `trainingPlan.ts` recevra la même exigence, vitest +
base de test dédiée migrée séparément de la base de dev :

- `getAvailableWindow` : `half_day` / `long_day` / `night` / `off` / congé,
  cas de changement d'heure (réutilise `shiftResolution`).
- `getDisciplineProgress` : semaine qui avance vs semaine qui se répète
  (seuil de complétion), cycle build→deload correct, disciplines
  indépendantes les unes des autres.
- `getDailyPrescription` : `ceiling=rest` → rien ; fenêtre trop courte →
  rien ; ordre de priorité par déficit ; tie-break déterministe (pas de
  flakiness sur relecture) ; vélo inactif ignoré sans branche spéciale ; ne
  jamais écraser une séance déjà loguée ; fallback explicite si aucun
  template ne matche.

## Hors scope (explicite)

- Détection automatique des séances via les activités Garmin (pace,
  distance, FC par activité) — le champ `activities` de l'ingestion continue
  à n'extraire que le VO2max ; le bouclage reste manuel.
- Objectif de type "course avec date cible" — uniquement de la progression
  continue pour cette phase.
- Plus d'une séance par jour.
- Vélo actif (équipement non disponible) — le modèle de données anticipe son
  activation future, mais aucun template ni logique de contrainte d'accès
  vélo (extérieur/home-trainer) n'est construit maintenant.
- Migration de l'ingestion Garmin vers une lib Node/TS (évaluée, non
  retenue pour cette phase).
