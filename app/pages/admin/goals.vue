<script setup lang="ts">
interface DisciplineGoal {
  discipline: 'running' | 'swimming' | 'strength' | 'cycling'
  active: boolean
  weeklyFrequencyTarget: number
  blockLengthWeeks: number
  planStartDate: string
  baselineJson: string | null
}

const DISCIPLINE_LABELS: Record<string, string> = {
  running: 'Course à pied',
  swimming: 'Natation',
  strength: 'Musculation',
  cycling: 'Vélo (pas encore équipé)',
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
  })
})

const saving = ref<string | null>(null)
async function saveGoal(g: DisciplineGoal) {
  saving.value = g.discipline
  try {
    await $fetch('/api/goals', { method: 'PUT', body: g })
    await refresh()
  }
  finally {
    saving.value = null
  }
}
</script>

<template>
  <main class="page">
    <h1>Objectifs par discipline</h1>
    <p class="hint">
      Le niveau de départ (allure seuil, allure/100m, charges clés) se saisit en JSON libre dans
      "Niveau de départ" — la forme est propre à chaque discipline, pas de format imposé.
    </p>

    <table>
      <thead>
        <tr>
          <th>Discipline</th><th>Actif</th><th>Séances/semaine</th><th>Semaines avant décharge</th>
          <th>Début du plan</th><th>Niveau de départ (JSON)</th><th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="g in rows" :key="g.discipline">
          <td>{{ DISCIPLINE_LABELS[g.discipline] }}</td>
          <td><input v-model="g.active" type="checkbox"></td>
          <td><input v-model.number="g.weeklyFrequencyTarget" type="number" min="1"></td>
          <td><input v-model.number="g.blockLengthWeeks" type="number" min="1"></td>
          <td><input v-model="g.planStartDate" type="date"></td>
          <td><input v-model="g.baselineJson" placeholder='{"allureSeuil":"4:30/km"}'></td>
          <td>
            <button type="button" :disabled="saving === g.discipline" @click="saveGoal(g)">
              Enregistrer
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </main>
</template>

<style scoped>
.page {
  max-width: 900px;
  margin: 0 auto;
  padding: 1rem;
}
.hint {
  color: #6b7280;
  font-size: 0.85rem;
}
table {
  width: 100%;
  border-collapse: collapse;
}
td, th {
  border: 1px solid #e5e7eb;
  padding: 0.4rem;
  text-align: left;
}
input {
  width: 100%;
}
</style>
