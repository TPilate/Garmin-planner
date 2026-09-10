<script setup lang="ts">
interface ShiftCode {
  code: string
  label: string
  active: boolean
}

const route = useRoute()
const year = computed(() => Number(route.params.year))
const month = computed(() => Number(route.params.month))

const { days, status, loading, load, loadDaySummaries, loadTrainingPlan, save, confirmMonth } = useMonth(year, month)
const { data: shiftCodesData } = await useFetch<ShiftCode[]>('/api/shift-codes')

async function loadAll() {
  await load()
  // Only meaningful once the month is confirmed (day-summary returns NO_DATA otherwise) —
  // fetched unconditionally since that's cheap and keeps the logic in one place.
  await loadDaySummaries()
  await loadTrainingPlan()
}

await loadAll()
watch([year, month], loadAll)

const degradedDayCount = computed(() => days.value.filter(d => d.metricsDegraded === true).length)

const activeCodes = computed(() => (shiftCodesData.value ?? []).filter(c => c.active).map(c => c.code))

// Tap-to-cycle: null -> J -> N -> 1/2 -> null (order follows shift_codes, never hardcoded here).
// This is the review/correction UI too — the same interaction confirms or fixes an OCR pre-fill
// once phase 5 lands.
function cycleCode(date: string) {
  if (status.value === 'confirmed') return
  const day = days.value.find(d => d.date === date)
  if (!day) return
  const options = [null, ...activeCodes.value]
  const currentIndex = options.indexOf(day.code)
  day.code = options[(currentIndex + 1) % options.length] ?? null
}

const saving = ref(false)
async function onSave() {
  saving.value = true
  try {
    await save()
    await loadDaySummaries() // now NO_DATA everywhere, since saving reverts the month to draft
    await loadTrainingPlan()
  }
  finally {
    saving.value = false
  }
}

const confirming = ref(false)
const overridePrompt = ref<{ workedDays: number, expectedRange: [number, number] } | null>(null)

async function onConfirm(override = false) {
  confirming.value = true
  try {
    const result = await confirmMonth(override)
    if (!result.ok && result.requiresOverride) {
      overridePrompt.value = { workedDays: result.workedDays, expectedRange: result.expectedRange! }
      return
    }
    overridePrompt.value = null
    status.value = 'confirmed'
    await loadDaySummaries()
    await loadTrainingPlan()
  }
  finally {
    confirming.value = false
  }
}

function prevMonth() {
  const m = month.value === 1 ? 12 : month.value - 1
  const y = month.value === 1 ? year.value - 1 : year.value
  return navigateTo(`/roster/${y}/${m}`)
}
function nextMonth() {
  const m = month.value === 12 ? 1 : month.value + 1
  const y = month.value === 12 ? year.value + 1 : year.value
  return navigateTo(`/roster/${y}/${m}`)
}
</script>

<template>
  <main class="page">
    <header class="topbar">
      <button type="button" @click="prevMonth">
        ←
      </button>
      <h1>{{ month }}/{{ year }}</h1>
      <button type="button" @click="nextMonth">
        →
      </button>
    </header>

    <p class="status" :class="status">
      Statut : {{ status === 'confirmed' ? 'Confirmé' : 'Brouillon' }}
    </p>

    <CalendarDegradedBanner :degraded-day-count="degradedDayCount" />

    <CalendarMonthGrid
      :days="days"
      :disabled="loading"
      @toggle="cycleCode"
    />

    <footer class="actions">
      <button type="button" :disabled="saving || loading" @click="onSave">
        Enregistrer
      </button>
      <button type="button" :disabled="confirming || loading" @click="onConfirm(false)">
        Confirmer le mois
      </button>
    </footer>

    <div v-if="overridePrompt" class="override">
      <p>
        {{ overridePrompt.workedDays }} jours travaillés détectés, hors de la plage attendue
        [{{ overridePrompt.expectedRange[0] }}–{{ overridePrompt.expectedRange[1] }}].
        Un mois type comporte généralement ce nombre de jours travaillés — vérifie la grille
        avant de forcer la confirmation.
      </p>
      <button type="button" @click="onConfirm(true)">
        Confirmer quand même
      </button>
      <button type="button" @click="overridePrompt = null">
        Annuler
      </button>
    </div>
  </main>
</template>

<style scoped>
.page {
  max-width: 480px;
  margin: 0 auto;
  padding: 1rem;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.status {
  font-size: 0.85rem;
  margin: 0.25rem 0 0.75rem;
}
.status.confirmed {
  color: #059669;
}
.status.draft {
  color: #d97706;
}
.actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}
.override {
  margin-top: 1rem;
  padding: 0.75rem;
  border: 1px solid #f59e0b;
  border-radius: 0.5rem;
  background: #fffbeb;
}
</style>
