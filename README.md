# Garmin Planner

Application personnelle qui adapte un programme d'entraînement (course à
pied, natation, musculation) au planning de gardes hospitalières, en
croisant le planning de gardes avec les données de récupération remontées
par une montre Garmin.

## Le problème que ça résout

Un planning de garde irrégulier (jour/nuit/demi-journée) rend impossible
de suivre un plan d'entraînement classique construit à l'avance sur des
semaines types. L'app fait l'inverse : chaque jour, elle calcule ce qui est
raisonnable de faire (temps disponible, niveau de fatigue) et propose une
séance concrète adaptée, plutôt que d'imposer un planning figé.

## Comment ça marche, en résumé

Trois couches s'empilent, chacune ne dépendant que de la précédente :

1. **Planning de gardes** — saisie manuelle mensuelle (grille tap-to-cycle),
   confirmée explicitement avant d'être utilisée par le reste de l'app.
   Un mois non confirmé ne "ressemble" jamais à un mois de repos — c'est un
   garde-fou central du projet.
2. **Plafond d'intensité du jour** (`server/utils/dayType.ts`) — pour
   chaque jour, dérive un type (repos / demi-journée / garde longue /
   avant-nuit / après-nuit / congé) à partir du planning, puis ajuste ce
   plafond à la baisse si les données Garmin brutes (HR repos, HRV) de la
   nuit dernière sortent de la fourchette habituelle. Une nuit de garde
   dégrade toujours les métriques Garmin de la nuit suivante — l'app le
   sait et ignore le score Garmin ces nuits-là plutôt que de se laisser
   tromper.
3. **Séance prescrite du jour** (`server/utils/trainingPlan.ts`) — transforme
   ce plafond en séance concrète : calcule le temps réellement libre autour
   de la garde, regarde où en est chaque discipline dans son cycle
   charge/décharge (recalculé à chaque lecture depuis l'historique des
   séances loguées, jamais stocké comme un compteur à part), et choisit la
   discipline la plus urgente + une séance qui rentre dans le créneau et le
   plafond du jour.

Les données Garmin elles-mêmes arrivent via un worker Python (`garth`,
API non-officielle Garmin Connect — la seule option viable pour un usage
individuel, voir `docs/superpowers/specs/`) qui pousse des payloads bruts
vers `/api/internal/garmin/ingest`, stockés en append-only puis normalisés.

## Ce qu'on peut faire aujourd'hui dans l'app

- Se connecter avec un PIN partagé (pas de compte utilisateur).
- Saisir et confirmer le planning de garde mois par mois (`/roster/année/mois`).
- Voir, pour chaque jour confirmé, le plafond d'intensité et la séance
  proposée (badge discipline + nom), avec une bannière si les données
  Garmin du mois sont dégradées.
- Configurer les objectifs par discipline (`/admin/goals`) : actif ou non,
  fréquence hebdo cible, longueur du cycle charge/décharge, date de départ,
  niveau de départ libre (JSON).
- Cliquer un jour confirmé pour voir le détail de la séance (structure
  complète) et la loguer comme faite/sautée, avec RPE/durée réelle/notes.
- Gérer les codes de garde (`/admin/shift-codes`) : horaires, catégorie
  (jour long / nuit / demi-journée), utilisés par tout le reste sans jamais
  hardcoder un code littéral.

Navigation : barre en haut (Planning / Objectifs / Codes de garde /
Déconnexion), visible partout sauf sur l'écran de connexion.

## Ce qui n'est PAS encore fait

- Vélo : modélisé dans le schéma (discipline avec `active=false`) mais sans
  équipement ni séances — l'activer plus tard est censé être un simple
  flip de flag, sans toucher à l'algorithme.
- Pas de détection automatique des séances réellement faites via les
  activités Garmin (pace, distance, FC par sortie) — le bouclage est
  manuel (log "Fait"/"Sauté").
- Pas d'objectif type "course avec date cible" — uniquement de la
  progression continue par charge/décharge.
- Pas de notifications push (le scaffold PWA existe, la logique non).
- Pas de moyen de corriger une séance déjà loguée une fois le statut posé.

## Stack technique

- **Nuxt 4** (Nitro côté serveur) + **Vue 3**, PWA (`@vite-pwa/nuxt`, cache
  lecture-seule des endpoints GET).
- **Drizzle ORM** + **`@libsql/client`** — SQLite en local (`db/local.db`),
  Turso en prod. Un seul driver partout, jamais `better-sqlite3`.
- **Luxon** pour tout calcul de date/heure impliquant un fuseau horaire
  (obligatoire pour les horaires de garde traversant minuit et les
  changements d'heure — piège déjà rencontré une fois sur ce projet).
- **Zod** pour la validation des entrées API, **Vitest** pour les tests.
- Auth par PIN unique, session scellée (`nuxt-auth-utils`).
- Worker Python séparé (`python-worker/`) pour l'ingestion Garmin —
  volontairement "schema-blind" : il ne fait qu'appeler `garth` et poster
  des payloads bruts, jamais d'accès direct à la base.

## Démarrer en local

```bash
npm install --legacy-peer-deps   # requis sur ce projet, voir note ci-dessous
cp .env.example .env             # renseigner APP_PIN, NUXT_SESSION_PASSWORD, etc.
npm run db:migrate                # applique les migrations sur db/local.db
npx tsx db/seed.ts                # seed les codes de garde + la bibliothèque de séances
npm run dev
```

Pour voir une séance proposée sur le calendrier : confirmer un mois de
planning (et le mois précédent), puis activer au moins une discipline sur
`/admin/goals`.

**Notes d'environnement** (déjà rencontrées, à ne pas re-découvrir) :
- Node **≥20.19 ou ≥22.12** requis (dépendance de Nuxt 4.5.2).
- `npm install` seul plante sur ce projet — toujours utiliser
  `--legacy-peer-deps`.
- `npm test` doit rester sans filtre pour que les fichiers de test
  partagent correctement la même base SQLite de test
  (`vitest.config.ts` force `fileParallelism: false` pour cette raison).

## Pour aller plus loin

- `PROJECT_LOG.md` — journal de bord détaillé, phase par phase, avec les
  décisions d'architecture et les bugs déjà rencontrés/corrigés.
- `docs/superpowers/specs/` et `docs/superpowers/plans/` — spec de design
  et plan d'implémentation de la couche plans d'entraînement/prescription
  de séances (dernière fonctionnalité livrée).
