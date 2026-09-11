<script setup lang="ts">
import { DateTime } from 'luxon'

interface TodayData {
  date: string
  dayType: string
  intensityCeiling: string | null
  metricsDegraded: boolean | null
  garminUsed: boolean
  reason?: string
  garminRestingHr: number | null
  garminHrvLastNight: number | null
  baselineRestingHr: { median: number, p25: number, p75: number } | null
  baselineHrv: { median: number, p25: number, p75: number } | null
  lastGarminSyncAt: string | null
  shift: { code: string, label: string, startsAt: string, endsAt: string } | null
  minutesAvailable: number
  hasSession: boolean
  discipline?: string
  sessionName?: string
  targetIntensity?: string
  durationMinutes?: number
  structureJson?: string | null
  status?: string
  sessionReason?: string
  actualRpe?: number | null
  actualDurationMinutes?: number | null
  notes?: string | null
  progress: { blockNumber: number, weekInBlock: number, blockLengthWeeks: number, phase: string, completedThisWeek: number, weeklyFrequencyTarget: number, deficit: number } | null
}

const requestFetch = useRequestFetch()
const now = DateTime.now()
const today = now.toISODate()!

const { data: day, refresh } = await useFetch<TodayData>(`/api/today/${today}`)

const dateLabel = computed(() => {
  const dt = DateTime.fromISO(today, { locale: 'fr' })
  const s = dt.toFormat('cccc d MMMM')
  return s.charAt(0).toUpperCase() + s.slice(1)
})
const weekLabel = computed(() => `S${DateTime.fromISO(today).weekNumber}`)

const INTENSITY_ORDER = ['rest', 'mobility', 'easy', 'moderate', 'hard']
const INTENSITY_LABELS: Record<string, string> = { rest: 'Repos', mobility: 'Mobilité', easy: 'Facile', moderate: 'Modéré', hard: 'Intense' }
const filledSegments = computed(() => {
  if (!day.value?.intensityCeiling) return 0
  return INTENSITY_ORDER.indexOf(day.value.intensityCeiling) + 1
})

function fmtTime(iso: string) {
  return DateTime.fromISO(iso).toFormat('HH:mm')
}
function fmtDuration(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h} h ${m.toString().padStart(2, '0')}` : `${m} min`
}

const isPostNight = computed(() => day.value?.dayType === 'post_night')
const noWindow = computed(() => (day.value?.minutesAvailable ?? 999) < 15 && !isPostNight.value)
const noGarminSync = computed(() => day.value?.hasSession !== undefined && !day.value.garminUsed && day.value.reason === 'no Garmin sync data for this date')

const rationale = computed(() => {
  if (!day.value) return []
  const d = day.value
  const planningText = d.shift
    ? `${d.shift.label} confirmée (${d.shift.code})`
    : d.dayType === 'leave' ? 'Jour de congé' : 'Pas de garde ce jour — repos'
  const plafondText = d.garminUsed
    ? 'Garmin dans la norme habituelle, aucun abaissement.'
    : d.metricsDegraded
      ? 'Nuit de garde — données Garmin ignorées, plafond fixé par le type de journée.'
      : 'Pas de données Garmin exploitables — plafond fixé uniquement par le type de journée.'
  const seanceText = d.hasSession
    ? d.progress
      ? `${d.progress.completedThisWeek}/${d.progress.weeklyFrequencyTarget} séances cette semaine sur cette discipline — ${d.sessionName} (${d.durationMinutes} min) tient dans le créneau sous le plafond ${INTENSITY_LABELS[d.intensityCeiling ?? '']}.`
      : `${d.sessionName} proposée pour aujourd'hui.`
    : (d.sessionReason ?? 'Aucune séance ne convient aujourd\'hui.')
  return [
    { label: '1 · PLANNING', text: planningText },
    { label: '2 · PLAFOND', text: plafondText },
    { label: '3 · SÉANCE', text: seanceText },
  ]
})
const rationaleOpen = ref(false)

// Week strip: current ISO week (Mon-Sun), pulled from the month endpoint(s) it falls in.
interface WeekDayEntry { date: string, day: number, label: string, isToday: boolean, discipline?: string | null, hasSession: boolean }
const weekDays = ref<WeekDayEntry[]>([])
async function loadWeekStrip() {
  const monday = DateTime.fromISO(today).startOf('week')
  const dates = Array.from({ length: 7 }, (_, i) => monday.plus({ days: i }))
  const months = new Set(dates.map(d => `${d.year}-${d.month}`))
  const byDate = new Map<string, { discipline?: string, hasSession: boolean }>()
  await Promise.all(Array.from(months).map(async (key) => {
    const [y, m] = key.split('-')
    const data = await requestFetch<{ days: { date: string, hasSession: boolean, discipline?: string }[] }>(`/api/training/${y}/${m}`)
    for (const d of data.days) byDate.set(d.date, d)
  }))
  const labels = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
  weekDays.value = dates.map((d, i) => {
    const entry = byDate.get(d.toISODate()!)
    return {
      date: d.toISODate()!,
      day: d.day,
      label: labels[i]!,
      isToday: d.toISODate() === today,
      discipline: entry?.discipline,
      hasSession: entry?.hasSession ?? false,
    }
  })
}
await loadWeekStrip()

const detailOpen = ref(false)
async function onLogged() {
  detailOpen.value = false
  await refresh()
  await loadWeekStrip()
}
</script>

<template>
  <main v-if="day" class="page">
    <div class="header">
      <div class="date-row">
        <div class="date">
          {{ dateLabel }}
        </div>
        <div class="week">
          {{ weekLabel }}
        </div>
      </div>
      <div v-if="day.shift" class="shift-row">
        <span class="shift-code">{{ day.shift.code }}</span>
        <span class="shift-label">{{ fmtTime(day.shift.startsAt) }} – {{ fmtTime(day.shift.endsAt) }} · {{ day.shift.label }}</span>
      </div>
    </div>

    <!-- NO_DATA: roster not confirmed -->
    <div v-if="day.dayType === 'no_data'" class="card">
      <p class="hint">
        {{ day.reason === 'current month not confirmed' ? 'Le planning de ce mois n\'est pas encore confirmé.' : 'Le mois précédent n\'est pas confirmé — impossible de savoir si tu sors d\'une nuit de garde.' }}
        Confirme-le sur l'onglet Planning pour voir ta séance du jour.
      </p>
    </div>

    <template v-else>
      <div class="card ceiling-card">
        <div class="ceiling-header">
          <span class="section-label">PLAFOND D'INTENSITÉ</span>
          <span class="section-label">{{ filledSegments }} / 5</span>
        </div>
        <div class="ceiling-value" :class="{ muted: isPostNight }">
          {{ INTENSITY_LABELS[day.intensityCeiling ?? ''] ?? '—' }}
        </div>
        <div class="segments">
          <div v-for="n in 5" :key="n" class="segment" :class="{ filled: n <= filledSegments, dim: isPostNight }" />
        </div>
        <div class="segment-labels">
          <span v-for="(l, i) in ['REPOS', 'MOBILITÉ', 'FACILE', 'MODÉRÉ', 'INTENSE']" :key="l" :class="{ current: i === filledSegments - 1 }">{{ l }}</span>
        </div>

        <p v-if="isPostNight" class="lead">
          Sortie de garde de nuit. Les métriques de la nuit sont systématiquement dégradées après
          une nuit travaillée — le score Garmin n'est pas utilisé aujourd'hui.
        </p>
        <p v-else-if="noWindow" class="lead">
          Aucune fenêtre exploitable aujourd'hui compte tenu de la garde — la séance est reportée.
        </p>
        <p v-else class="lead">
          {{ day.shift ? `Garde ${day.shift.label.toLowerCase()}, ` : '' }}{{ Math.floor(day.minutesAvailable / 60) }} h
          {{ (day.minutesAvailable % 60).toString().padStart(2, '0') }} libres.
        </p>

        <div v-if="isPostNight" class="degraded-numbers">
          HRV {{ day.garminHrvLastNight ?? '—' }} ms · HR REPOS {{ day.garminRestingHr ?? '—' }} bpm · NON RETENUS
        </div>

        <div v-if="noGarminSync" class="sync-banner">
          <span>⟳</span>
          <span>{{ day.lastGarminSyncAt ? `DERNIÈRE SYNCHRO ${DateTime.fromISO(day.lastGarminSyncAt).toFormat('dd/MM HH:mm')}` : 'AUCUNE SYNCHRO ENREGISTRÉE' }}</span>
        </div>

        <div v-else-if="day.garminUsed" class="numbers-grid">
          <div class="stat">
            <div class="stat-label">
              HR REPOS
            </div>
            <div class="stat-value">
              {{ day.garminRestingHr }}<span class="unit"> bpm</span>
            </div>
            <div v-if="day.baselineRestingHr" class="stat-range">
              hab. {{ day.baselineRestingHr.p25 }}–{{ day.baselineRestingHr.p75 }}
            </div>
          </div>
          <div class="stat">
            <div class="stat-label">
              HRV
            </div>
            <div class="stat-value">
              {{ day.garminHrvLastNight }}<span class="unit"> ms</span>
            </div>
            <div v-if="day.baselineHrv" class="stat-range">
              hab. {{ day.baselineHrv.p25 }}–{{ day.baselineHrv.p75 }}
            </div>
          </div>
          <div class="stat">
            <div class="stat-label">
              TEMPS LIBRE
            </div>
            <div class="stat-value">
              {{ fmtDuration(day.minutesAvailable) }}
            </div>
          </div>
        </div>

        <button type="button" class="rationale-toggle" @click="rationaleOpen = !rationaleOpen">
          <span>Comment c'est calculé</span>
          <span>{{ rationaleOpen ? '–' : '+' }}</span>
        </button>
        <div v-if="rationaleOpen" class="rationale">
          <div v-for="step in rationale" :key="step.label" class="rationale-step">
            <div class="rationale-label">
              {{ step.label }}
            </div>
            <div class="rationale-text">
              {{ step.text }}
            </div>
          </div>
        </div>
      </div>

      <div class="card session-card-wrap">
        <span class="section-label">{{ day.status && day.status !== 'planned' ? 'SÉANCE' : 'SÉANCE PROPOSÉE' }}</span>

        <div v-if="day.hasSession" class="session-card">
          <div class="session-top">
            <span class="chip">{{ { running: 'COURSE', swimming: 'NATATION', strength: 'MUSCU', cycling: 'VÉLO' }[day.discipline ?? ''] ?? day.discipline }}</span>
            <span v-if="day.progress" class="cycle-label">
              SEMAINE {{ day.progress.weekInBlock }}/{{ day.progress.blockLengthWeeks + 1 }} · {{ day.progress.phase === 'deload' ? 'DÉCHARGE' : 'CHARGE' }}
            </span>
          </div>
          <div class="session-name">
            {{ day.sessionName }}
          </div>
          <div class="session-meta">
            <span>{{ day.durationMinutes }} min</span>
            <span>{{ INTENSITY_LABELS[day.targetIntensity ?? ''] ?? day.targetIntensity }}</span>
          </div>

          <template v-if="day.status && day.status !== 'planned'">
            <div class="logged-row">
              <span class="logged-status" :class="day.status">{{ day.status === 'completed' ? 'FAIT' : 'SAUTÉ' }}</span>
              <span v-if="day.actualRpe">RPE {{ day.actualRpe }}</span>
              <span v-if="day.actualDurationMinutes">{{ day.actualDurationMinutes }} min</span>
            </div>
            <p v-if="day.notes" class="notes">
              {{ day.notes }}
            </p>
            <p class="hint">
              Enregistré. Statut non modifiable.
            </p>
          </template>
          <div v-else class="session-actions">
            <button type="button" class="btn primary" @click="detailOpen = !detailOpen">
              Voir la séance
            </button>
            <button type="button" class="btn secondary" @click="detailOpen = true">
              Loguer
            </button>
          </div>
        </div>

        <p v-else class="hint">
          {{ day.sessionReason ?? "Pas de séance aujourd'hui." }}
        </p>

        <TodayDetail
          v-if="detailOpen"
          :date="day.date"
          :date-label="dateLabel"
          :discipline="day.discipline"
          :session-name="day.sessionName"
          :target-intensity="day.targetIntensity"
          :duration-minutes="day.durationMinutes"
          :structure-json="day.structureJson"
          :status="day.status"
          @close="detailOpen = false"
          @logged="onLogged"
        />
      </div>

      <div class="card">
        <TodayWeekStrip :days="weekDays" />
      </div>
    </template>
  </main>
</template>

<style scoped>
.page {
  max-width: 480px;
  margin: 0 auto;
  padding: 16px 16px 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.header {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.date-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.date {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.week {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-label);
}
.shift-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 12px;
}
.shift-code {
  background: var(--mint-soft);
  color: var(--text-secondary);
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid var(--border-strong);
}
.shift-label {
  color: var(--text-muted);
}
.card {
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 18px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.section-label {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--text-label);
}
.ceiling-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.ceiling-value {
  font-size: 34px;
  font-weight: 600;
  color: var(--mint);
  letter-spacing: -0.02em;
  line-height: 1;
}
.ceiling-value.muted {
  color: var(--text-muted);
}
.segments {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 4px;
}
.segment {
  height: 5px;
  border-radius: 3px;
  background: var(--border-strong);
}
.segment.filled {
  background: var(--mint-bar);
}
.segment.dim.filled {
  background: #B6BDB4;
}
.segment-labels {
  display: flex;
  justify-content: space-between;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-faint);
  letter-spacing: 0.04em;
}
.segment-labels .current {
  color: var(--mint);
}
.lead {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-secondary);
}
.degraded-numbers {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-faint);
}
.sync-banner {
  display: flex;
  gap: 8px;
  align-items: center;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--amber);
}
.numbers-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: var(--border-strong);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  overflow: hidden;
}
.stat {
  background: var(--fill);
  padding: 10px 12px;
}
.stat-label {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-label);
  letter-spacing: 0.06em;
}
.stat-value {
  font-family: var(--font-mono);
  font-size: 18px;
  margin-top: 3px;
}
.unit {
  font-size: 11px;
  color: var(--text-label);
}
.stat-range {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-faint);
  margin-top: 2px;
}
.rationale-toggle {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  padding: 10px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--fill);
  font-size: 13px;
  color: var(--text-secondary);
  font-family: inherit;
}
.rationale-toggle:hover {
  border-color: var(--mint);
}
.rationale {
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border-accent);
  margin-left: 6px;
  padding-left: 16px;
  gap: 14px;
}
.rationale-label {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-label);
  letter-spacing: 0.08em;
}
.rationale-text {
  font-size: 13px;
  color: var(--text);
  margin-top: 3px;
}
.session-card {
  background: var(--fill);
  border: 1px solid var(--border-accent);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.session-top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.chip {
  font-family: var(--font-mono);
  font-size: 11px;
  background: var(--mint-chip);
  color: #24352F;
  padding: 3px 8px;
  border-radius: 4px;
  font-weight: 600;
  letter-spacing: 0.06em;
}
.cycle-label {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-label);
}
.session-name {
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.session-meta {
  display: flex;
  gap: 18px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
}
.session-actions {
  display: flex;
  gap: 10px;
  margin-top: 2px;
}
.btn {
  padding: 12px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border: none;
}
.btn.primary {
  flex: 1;
  text-align: center;
  background: var(--mint-chip);
  color: #24352F;
}
.btn.primary:hover {
  background: var(--mint-hover);
}
.btn.secondary {
  padding: 12px 16px;
  border: 1px solid var(--border-accent);
  background: none;
  color: var(--text-secondary);
}
.logged-row {
  display: flex;
  gap: 18px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
}
.logged-status.completed {
  color: var(--mint);
}
.logged-status.skipped {
  color: var(--amber);
}
.notes {
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);
}
.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-faint);
  line-height: 1.5;
}
</style>
