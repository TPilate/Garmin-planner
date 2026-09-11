<template>
  <div class="topbar">
    <NuxtLink to="/reglages" class="settings-link">
      Réglages
    </NuxtLink>
  </div>
</template>

<style scoped>
.topbar {
  display: flex;
  justify-content: flex-end;
  padding: 10px 16px 0;
}
.settings-link {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--text-label);
  text-decoration: none;
}
.settings-link:hover {
  color: var(--mint);
}
</style>
