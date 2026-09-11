<script setup lang="ts">
interface DisciplineGoal {
  discipline: 'running' | 'swimming' | 'strength' | 'cycling'
  active: boolean
  weeklyFrequencyTarget: number
  blockLengthWeeks: number
  planStartDate: string
  baselineJson: string | null
  progress?: { blockNumber: number, weekInBlock: number, phase: string } | null
}

const DISCIPLINE_LABELS: Record<string, string> = {
  running: 'Course',
  swimming: 'Natation',
  strength: 'Musculation',
  cycling: 'Vélo',
}
const ALL_DISCIPLINES: DisciplineGoal['discipline'][] = ['running', 'swimming', 'strength', 'cycling']

const { data, refresh } = await useFetch<DisciplineGoal[]>('/api/goals')

// One row per discipline, always all 4 shown — missing ones (no goal saved yet) get sane
// defaults locally until the user hits "Enregistrer" for that row.
const rows = computed<DisciplineGoal[]>(() => {
  const existing = new Map((data.value ?? []).map(g => [g.discipline, g]))
  return ALL_DISCIPLINES.map(discipline => existing.get(discipline) ?? {
    discipline,
    active: false,
    weeklyFrequencyTarget: 3,
    blockLengthWeeks: 4,
    planStartDate: new Date().toISOString().slice(0, 10),
    baselineJson: null,
    progress: null,
  })
})

function positionLabel(g: DisciplineGoal): string {
  if (!g.active || !g.progress) return '—'
  return `${g.progress.weekInBlock}/${g.blockLengthWeeks + 1} ${g.progress.phase === 'deload' ? 'décharge' : 'charge'}`
}

const expanded = ref<string | null>(null)
function toggleExpand(discipline: string) {
  expanded.value = expanded.value === discipline ? null : discipline
}

const saving = ref<string | null>(null)
const error = ref<string | null>(null)

// v-model.number sends "" (not null) when a numeric field is cleared — the zod schema on the
// server requires a positive integer and rejects "" with a 400. Coerce before sending.
function numberOrNull(value: unknown): number | null {
  return value === '' || value == null ? null : (value as number)
}

async function saveGoal(g: DisciplineGoal) {
  saving.value = g.discipline
  error.value = null
  try {
    await $fetch('/api/goals', {
      method: 'PUT',
      body: {
        discipline: g.discipline,
        active: g.active,
        weeklyFrequencyTarget: numberOrNull(g.weeklyFrequencyTarget),
        blockLengthWeeks: numberOrNull(g.blockLengthWeeks),
        planStartDate: g.planStartDate,
        baselineJson: g.baselineJson,
      },
    })
    await refresh()
  }
  catch {
    error.value = `Impossible d'enregistrer l'objectif pour ${DISCIPLINE_LABELS[g.discipline]}. Vérifie les champs et réessaie.`
  }
  finally {
    saving.value = null
  }
}
</script>

<template>
  <main class="page">
    <h1>Objectifs</h1>
    <p class="hint">
      Fréquence cible et longueur de cycle par discipline. La progression est continue — pas de
      date de course.
    </p>
    <p v-if="error" class="error">
      {{ error }}
    </p>

    <div class="list">
      <div v-for="g in rows" :key="g.discipline" class="row">
        <div class="row-top" @click="toggleExpand(g.discipline)">
          <div class="name-group">
            <span class="dot" :class="{ off: !g.active }" />
            <span class="name">{{ DISCIPLINE_LABELS[g.discipline] }}</span>
          </div>
          <span class="state">{{ g.active ? 'ACTIF' : 'INACTIF' }}</span>
        </div>
        <div class="stats">
          <div>
            <div class="stat-label">
              FRÉQ. / SEM
            </div>
            <div class="stat-value">
              {{ g.active ? g.weeklyFrequencyTarget : '—' }}
            </div>
          </div>
          <div>
            <div class="stat-label">
              CYCLE
            </div>
            <div class="stat-value">
              {{ g.active ? `${g.blockLengthWeeks} sem` : '—' }}
            </div>
          </div>
          <div>
            <div class="stat-label">
              POSITION
            </div>
            <div class="stat-value">
              {{ positionLabel(g) }}
            </div>
          </div>
        </div>

        <button type="button" class="edit-toggle" @click="toggleExpand(g.discipline)">
          {{ expanded === g.discipline ? 'Fermer' : 'Modifier' }}
        </button>

        <div v-if="expanded === g.discipline" class="edit-form">
          <label class="checkbox">
            <input v-model="g.active" type="checkbox">
            <span>Actif</span>
          </label>
          <div class="field-row">
            <label class="field">
              <span class="field-label">Séances / semaine</span>
              <input v-model.number="g.weeklyFrequencyTarget" type="number" min="1" class="input">
            </label>
            <label class="field">
              <span class="field-label">Semaines avant décharge</span>
              <input v-model.number="g.blockLengthWeeks" type="number" min="1" class="input">
            </label>
          </div>
          <label class="field">
            <span class="field-label">Début du plan</span>
            <input v-model="g.planStartDate" type="date" class="input">
          </label>
          <label class="field">
            <span class="field-label">Niveau de départ (JSON libre)</span>
            <input v-model="g.baselineJson" placeholder='{"allureSeuil":"4:30/km"}' class="input">
          </label>
          <button type="button" class="save-btn" :disabled="saving === g.discipline" @click="saveGoal(g)">
            Enregistrer
          </button>
        </div>
      </div>
    </div>

    <p class="footnote">
      La position dans le cycle est recalculée à chaque lecture depuis l'historique des séances
      loguées.
    </p>
  </main>
</template>

<style scoped>
.page {
  max-width: 480px;
  margin: 0 auto;
  padding: 16px 16px 32px;
  font-family: var(--font-body);
  color: var(--text);
}
h1 {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0;
}
.hint {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.5;
}
.error {
  font-size: 13px;
  color: #B4472A;
}
.list {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-strong);
  border-radius: 14px;
  overflow: hidden;
  background: var(--surface);
}
.row {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.row:last-child {
  border-bottom: none;
}
.row-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
}
.name-group {
  display: flex;
  align-items: center;
  gap: 10px;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 4px;
  background: var(--mint-bar);
}
.dot.off {
  background: var(--rest-dot);
}
.name {
  font-size: 16px;
  font-weight: 600;
}
.state {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--text-label);
}
.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.stat-label {
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--text-faint);
  letter-spacing: 0.06em;
}
.stat-value {
  font-family: var(--font-mono);
  font-size: 15px;
  color: var(--text-secondary);
  margin-top: 2px;
}
.edit-toggle {
  align-self: flex-start;
  background: none;
  border: none;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--mint);
  cursor: pointer;
  padding: 0;
}
.edit-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}
.checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--text-secondary);
}
.field-row {
  display: flex;
  gap: 10px;
}
.field {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.field-label {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-label);
  letter-spacing: 0.04em;
}
.input {
  padding: 10px 12px;
  background: var(--fill);
  border: 1px solid var(--border-accent);
  border-radius: 8px;
  font-family: var(--font-mono);
  font-size: 14px;
  color: var(--text);
}
.save-btn {
  padding: 12px;
  border-radius: 8px;
  border: none;
  background: var(--mint-chip);
  color: #24352F;
  font-weight: 600;
  cursor: pointer;
}
.save-btn:hover {
  background: var(--mint-hover);
}
.save-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.footnote {
  margin: 16px 4px 0;
  font-size: 12px;
  color: var(--text-faint);
  line-height: 1.5;
}
</style>
