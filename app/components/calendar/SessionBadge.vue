<script setup lang="ts">
defineProps<{
  sessionName: string
  discipline: 'running' | 'swimming' | 'strength' | 'cycling'
}>()

const DISCIPLINE_ICONS: Record<string, string> = {
  running: '🏃',
  swimming: '🏊',
  strength: '🏋️',
  cycling: '🚴',
}
</script>

<template>
  <span class="session-badge" :title="sessionName">
    {{ DISCIPLINE_ICONS[discipline] ?? '•' }} {{ sessionName }}
  </span>
</template>

<style scoped>
.session-badge {
  display: block;
  font-family: var(--font-mono);
  font-size: 8px;
  color: var(--text-label);
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  max-width: 100%;
}
</style>
