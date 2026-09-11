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
</script>

<template>
  <button
    type="button"
    class="cell"
    :class="{ leave: isLeave, coded: code }"
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
  gap: 2px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--fill);
  cursor: pointer;
  font-family: var(--font-body);
}
.cell.coded {
  border-color: var(--border-accent);
}
.cell:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.cell.leave {
  background: var(--fill-strong);
}
.day {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
}
.degraded-mark {
  font-size: 0.7rem;
}
.code {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
}
.leave-label {
  font-size: 9px;
  font-weight: 400;
}
</style>
