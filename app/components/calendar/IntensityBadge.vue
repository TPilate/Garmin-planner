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
// Single mint accent, varying only in strength with intensity — the design reserves color for
// the intensity ceiling and today's session, deliberately not a per-level rainbow.
const STYLES: Record<string, { bg: string, color: string }> = {
  rest: { bg: 'var(--border-strong)', color: 'var(--text-faint)' },
  mobility: { bg: 'var(--fill-strong)', color: 'var(--text-label)' },
  easy: { bg: 'var(--mint-soft)', color: 'var(--text-secondary)' },
  moderate: { bg: 'var(--mint-chip)', color: '#24352F' },
  hard: { bg: 'var(--mint)', color: 'white' },
}
</script>

<template>
  <span
    v-if="intensityCeiling"
    class="badge"
    :style="{ background: STYLES[intensityCeiling]?.bg, color: STYLES[intensityCeiling]?.color }"
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
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.04em;
  padding: 1px 5px;
  border-radius: 4px;
  font-weight: 600;
  line-height: 1.4;
}
.badge.unknown {
  background: var(--fill);
  color: var(--text-faint);
}
</style>
