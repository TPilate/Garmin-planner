<script setup lang="ts">
defineProps<{
  day: number
  code: string | null
  isLeave: boolean
  disabled?: boolean
  intensityCeiling?: 'rest' | 'mobility' | 'easy' | 'moderate' | 'hard' | null
  metricsDegraded?: boolean | null
  sessionName?: string | null
  discipline?: 'running' | 'swimming' | 'strength' | 'cycling' | null
}>()
defineEmits<{ click: [] }>()

// Shift-code-specific colors are a display-only convenience — falls back to gray for any
// code not in this map, so a newly-added admin shift_codes entry never breaks rendering.
const CODE_COLORS: Record<string, string> = {
  J: '#f59e0b',
  N: '#6366f1',
  '1/2': '#10b981',
}
</script>

<template>
  <button
    type="button"
    class="cell"
    :class="{ leave: isLeave }"
    :style="code ? { borderColor: CODE_COLORS[code] ?? '#9ca3af' } : {}"
    :disabled="disabled"
    @click="$emit('click')"
  >
    <span class="day">
      {{ day }}
      <span v-if="metricsDegraded" class="degraded-mark" title="Données Garmin non fiables (nuit de garde)">🌙</span>
    </span>
    <span v-if="code" class="code">{{ code }}</span>
    <span v-else-if="isLeave" class="code leave-label">congé</span>
    <CalendarIntensityBadge v-if="intensityCeiling !== undefined" :intensity-ceiling="intensityCeiling ?? null" />
    <CalendarSessionBadge v-if="sessionName && discipline" :session-name="sessionName" :discipline="discipline" />
  </button>
</template>

<style scoped>
.cell {
  aspect-ratio: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.15rem;
  border: 2px solid #e5e7eb;
  border-radius: 0.5rem;
  background: white;
  cursor: pointer;
}
.cell:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.cell.leave {
  background: #f3f4f6;
}
.day {
  font-size: 0.8rem;
  color: #6b7280;
}
.degraded-mark {
  font-size: 0.7rem;
}
.code {
  font-weight: 700;
}
.leave-label {
  font-size: 0.6rem;
  font-weight: 400;
}
</style>
