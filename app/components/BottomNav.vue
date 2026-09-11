<script setup lang="ts">
const rosterLink = computed(() => {
  const now = new Date()
  return `/roster/${now.getFullYear()}/${now.getMonth() + 1}`
})
</script>

<template>
  <nav class="bottom-nav">
    <NuxtLink to="/today" class="tab" active-class="active">
      <span class="glyph">●</span>
      <span>Aujourd'hui</span>
    </NuxtLink>
    <NuxtLink :to="rosterLink" class="tab" active-class="active">
      <span class="glyph">▦</span>
      <span>Planning</span>
    </NuxtLink>
    <NuxtLink to="/admin/goals" class="tab" active-class="active">
      <span class="glyph">◎</span>
      <span>Objectifs</span>
    </NuxtLink>
  </nav>
</template>

<style scoped>
.bottom-nav {
  position: sticky;
  bottom: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-top: 1px solid var(--border);
  background: var(--fill-strong);
}
.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 0 14px;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--text-label);
  text-decoration: none;
}
.glyph {
  font-size: 14px;
}
.tab.active {
  color: var(--mint);
}
</style>
