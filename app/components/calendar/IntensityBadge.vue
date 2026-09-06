<script setup lang="ts">
defineProps<{
  intensityCeiling: 'rest' | 'mobility' | 'easy' | 'moderate' | 'hard' | null
}>()

const LABELS: Record<string, string> = {
  rest: 'Repos',
  mobility: 'Mobilité',
  easy: 'Facile',
  moderate: 'Modéré',
  hard: 'Intense',
}
const COLORS: Record<string, string> = {
  rest: '#9ca3af',
  mobility: '#60a5fa',
  easy: '#34d399',
  moderate: '#fbbf24',
  hard: '#ef4444',
}
</script>

<template>
  <span
    v-if="intensityCeiling"
    class="badge"
    :style="{ background: COLORS[intensityCeiling] }"
  >
    {{ LABELS[intensityCeiling] }}
  </span>
  <span v-else class="badge unknown">
    —
  </span>
</template>

<style scoped>
.badge {
  display: inline-block;
  font-size: 0.55rem;
  padding: 0.05rem 0.3rem;
  border-radius: 0.25rem;
  color: white;
  font-weight: 600;
  line-height: 1.4;
}
.badge.unknown {
  background: #e5e7eb;
  color: #6b7280;
}
</style>
