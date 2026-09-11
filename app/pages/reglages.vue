<script setup lang="ts">
const { fetch: refreshSession } = useUserSession()

const loggingOut = ref(false)
async function logout() {
  loggingOut.value = true
  try {
    await $fetch('/api/auth/logout', { method: 'POST' })
    await refreshSession()
    await navigateTo('/login')
  }
  finally {
    loggingOut.value = false
  }
}
</script>

<template>
  <main class="page">
    <h1>Réglages</h1>
    <div class="list">
      <NuxtLink to="/admin/shift-codes" class="row">
        Codes de garde
      </NuxtLink>
      <button type="button" class="row logout" :disabled="loggingOut" @click="logout">
        Déconnexion
      </button>
    </div>
  </main>
</template>

<style scoped>
.page {
  max-width: 480px;
  margin: 0 auto;
  padding: 20px;
  font-family: var(--font-body);
  color: var(--text);
}
h1 {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.list {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  overflow: hidden;
  background: var(--surface);
}
.row {
  display: block;
  width: 100%;
  text-align: left;
  padding: 16px 18px;
  border: none;
  border-bottom: 1px solid var(--border);
  background: none;
  font-size: 15px;
  color: var(--text);
  cursor: pointer;
  text-decoration: none;
  font-family: inherit;
}
.row:last-child {
  border-bottom: none;
}
.row.logout {
  color: var(--amber);
}
.row:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
