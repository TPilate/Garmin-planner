<script setup lang="ts">
const pin = ref('')
const error = ref('')
const loading = ref(false)
const { fetch: refreshSession } = useUserSession()

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: { pin: pin.value } })
    await refreshSession()
    await navigateTo('/')
  }
  catch {
    error.value = 'Code incorrect.'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="login">
    <form @submit.prevent="submit">
      <label for="pin">Code d'accès</label>
      <input id="pin" v-model="pin" type="password" inputmode="numeric" autofocus>
      <button type="submit" :disabled="loading">
        Entrer
      </button>
      <p v-if="error" class="error">
        {{ error }}
      </p>
    </form>
  </main>
</template>

<style scoped>
.login {
  display: flex;
  min-height: 100vh;
  align-items: center;
  justify-content: center;
  font-family: var(--font-body);
}
form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(280px, 90vw);
}
label {
  font-size: 13px;
  color: var(--text-secondary);
}
input {
  padding: 12px 14px;
  border: 1px solid var(--border-accent);
  border-radius: 8px;
  background: var(--surface);
  font-family: var(--font-mono);
  font-size: 16px;
  color: var(--text);
}
button {
  padding: 14px;
  border-radius: 8px;
  border: none;
  background: var(--mint-chip);
  color: #24352F;
  font-weight: 600;
  font-size: 15px;
  cursor: pointer;
}
button:hover {
  background: var(--mint-hover);
}
button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.error {
  color: #B4472A;
  font-size: 13px;
  margin: 0;
}
</style>
