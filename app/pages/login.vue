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
}
form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: min(280px, 90vw);
}
.error {
  color: #dc2626;
}
</style>
