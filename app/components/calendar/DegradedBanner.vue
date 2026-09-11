<script setup lang="ts">
defineProps<{
  degradedDayCount: number
}>()
</script>

<template>
  <div v-if="degradedDayCount > 0" class="banner">
    <span class="glyph">🌙</span>
    <span>
      {{ degradedDayCount }} jour{{ degradedDayCount > 1 ? 's' : '' }} ce mois-ci
      {{ degradedDayCount > 1 ? 'ont' : 'a' }} des données Garmin non fiables (nuit de garde) —
      le planificateur ignore ces scores et applique uniquement les règles de garde.
    </span>
  </div>
</template>

<style scoped>
.banner {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  background: var(--amber-bg);
  border: 1px solid var(--amber-border);
  color: var(--amber-dark);
  padding: 12px 14px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.45;
}
.glyph {
  font-size: 14px;
}
</style>
