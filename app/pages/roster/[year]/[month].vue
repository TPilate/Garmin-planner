<script setup lang="ts">
interface ShiftCode {
  code: string
  label: string
  active: boolean
}

const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

const route = useRoute()
const year = computed(() => Number(route.params.year))
const month = computed(() => Number(route.params.month))

const { days, status, loading, trainingDays, load, loadDaySummaries, loadTrainingPlan, save, confirmMonth } = useMonth(year, month)
const { data: shiftCodesData } = await useFetch<ShiftCode[]>('/api/shift-codes')

const selectedTrainingDay = ref<TrainingDay | null>(null)

// trainingDays is already populated by loadTrainingPlan() (called from loadAll() below), so
// opening the detail panel is just a lookup — no extra fetch needed.
function openSessionDetail(date: string) {
  selectedTrainingDay.value = trainingDays.value.find(d => d.date === date) ?? null
}

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
function onDayClick(date: string) {
  if (status.value === 'confirmed') {
    openSessionDetail(date)
    return
  }
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
      <button type="button" class="nav-arrow" @click="prevMonth">
        ‹
      </button>
      <h1>{{ MONTH_NAMES[month - 1] }} {{ year }}</h1>
      <button type="button" class="nav-arrow" @click="nextMonth">
        ›
      </button>
    </header>

    <div v-if="status !== 'confirmed'" class="warning-banner">
      <span class="warning-glyph">!</span>
      <div>
        <div class="warning-title">
          Mois non confirmé
        </div>
        <div class="warning-text">
          Aucune séance n'est proposée tant que le mois n'est pas confirmé.
        </div>
      </div>
    </div>
    <p v-else class="status">
      Confirmé
    </p>

    <CalendarDegradedBanner :degraded-day-count="degradedDayCount" />

    <CalendarMonthGrid
      :days="days"
      :disabled="loading"
      @toggle="onDayClick"
    />

    <CalendarSessionDetail
      v-if="selectedTrainingDay"
      :day="selectedTrainingDay"
      @close="selectedTrainingDay = null"
      @logged="async () => { const loggedDate = selectedTrainingDay!.date; await loadTrainingPlan(); openSessionDetail(loggedDate) }"
    />

    <footer class="actions">
      <button type="button" class="btn secondary" :disabled="saving || loading" @click="onSave">
        Enregistrer
      </button>
      <button type="button" class="btn primary" :disabled="confirming || loading" @click="onConfirm(false)">
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
      <div class="override-actions">
        <button type="button" class="btn primary" @click="onConfirm(true)">
          Confirmer quand même
        </button>
        <button type="button" class="btn secondary" @click="overridePrompt = null">
          Annuler
        </button>
      </div>
    </div>
  </main>
</template>

<style scoped>
.page {
  max-width: 480px;
  margin: 0 auto;
  padding: 16px 16px 32px;
  font-family: var(--font-body);
  color: var(--text);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.topbar h1 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}
.nav-arrow {
  background: none;
  border: none;
  font-family: var(--font-mono);
  font-size: 15px;
  color: var(--text-label);
  cursor: pointer;
  padding: 4px 8px;
}
.status {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--mint);
  margin: 0;
}
.warning-banner {
  padding: 12px 14px;
  background: var(--amber-bg);
  border: 1px solid var(--amber-border);
  border-radius: 8px;
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.warning-glyph {
  color: var(--amber);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.3;
}
.warning-title {
  font-size: 13px;
  color: var(--amber-dark);
  font-weight: 500;
}
.warning-text {
  font-size: 12px;
  color: var(--amber-muted);
  margin-top: 2px;
  line-height: 1.45;
}
.actions {
  display: flex;
  gap: 10px;
}
.btn {
  flex: 1;
  text-align: center;
  padding: 14px;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
}
.btn.primary {
  background: var(--mint-chip);
  color: #24352F;
}
.btn.primary:hover {
  background: var(--mint-hover);
}
.btn.secondary {
  background: none;
  border-color: var(--border-accent);
  color: var(--text-secondary);
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.override {
  padding: 14px;
  border: 1px solid var(--amber-border);
  border-radius: 8px;
  background: var(--amber-bg);
}
.override p {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--amber-dark);
  line-height: 1.5;
}
.override-actions {
  display: flex;
  gap: 10px;
}
</style>
