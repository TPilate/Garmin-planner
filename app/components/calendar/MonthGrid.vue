<script setup lang="ts">
import type { MonthDay } from '~/composables/useMonth'

defineProps<{
  days: MonthDay[]
  disabled?: boolean
}>()
const emit = defineEmits<{ toggle: [date: string] }>()
</script>

<template>
  <div class="grid">
    <CalendarDayCell
      v-for="d in days"
      :key="d.date"
      :day="d.day"
      :code="d.code"
      :is-leave="d.isLeave"
      :disabled="disabled"
      :intensity-ceiling="d.intensityCeiling"
      :metrics-degraded="d.metricsDegraded"
      @click="emit('toggle', d.date)"
    />
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0.4rem;
}
</style>
