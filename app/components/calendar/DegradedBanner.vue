<script setup lang="ts">
defineProps<{
  degradedDayCount: number
}>()
</script>

<template>
  <div v-if="degradedDayCount > 0" class="banner">
    ⚠️ {{ degradedDayCount }} jour{{ degradedDayCount > 1 ? 's' : '' }} ce mois-ci
    {{ degradedDayCount > 1 ? 'ont' : 'a' }} des données Garmin non fiables (nuit de garde) —
    le planificateur ignore ces scores et applique uniquement les règles de garde.
  </div>
</template>

<style scoped>
.banner {
  background: #fef3c7;
  border: 2px solid #f59e0b;
  color: #92400e;
  padding: 0.6rem 0.8rem;
  border-radius: 0.5rem;
  font-weight: 600;
  font-size: 0.85rem;
  margin-bottom: 0.75rem;
}
</style>
