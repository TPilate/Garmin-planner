<script setup lang="ts">
const route = useRoute()
const { loggedIn } = useUserSession()
const showNav = computed(() => loggedIn.value && route.path !== '/login')
</script>

<template>
  <TopBar v-if="showNav" />
  <NuxtPage />
  <BottomNav v-if="showNav" />
</template>

<style>
:root {
  --bg: #EFEDE7;
  --surface: #FBFAF7;
  --fill: #F5F3ED;
  --fill-strong: #F1EFE8;
  --border: #E9E6DD;
  --border-strong: #DEDAD0;
  --border-accent: #D0CBBE;

  --text: #2E332F;
  --text-secondary: #565C56;
  --text-label: #5F665E;
  --text-muted: #6E756D;
  --text-faint: #6B7269;

  --mint: #3B7A67;
  --mint-hover: #93CDBA;
  --mint-chip: #A8D8C8;
  --mint-bar: #86C7B2;
  --mint-soft: #E4F1EB;

  --amber: #A9762C;
  --amber-dark: #6B5326;
  --amber-muted: #8A7442;
  --amber-bg: #FBF1E0;
  --amber-border: #E8D3AC;

  --swim: #5A7FCC;
  --swim-soft: #9DB3E5;
  --strength: #A9762C;
  --strength-soft: #E0A96E;
  --rest-dot: #D0CBBE;

  --font-body: 'Archivo', Helvetica, sans-serif;
  --font-mono: 'IBM Plex Mono', monospace;
}

* {
  box-sizing: border-box;
}
html,
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-body);
}
a {
  color: var(--mint);
}
</style>
