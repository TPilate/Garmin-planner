<script setup lang="ts">
const props = defineProps<{
  day: {
    date: string
    hasSession: boolean
    discipline?: string
    sessionName?: string
    targetIntensity?: string
    durationMinutes?: number
    structureJson?: string | null
    status?: 'planned' | 'completed' | 'skipped'
    reason?: string
  }
}>()
const emit = defineEmits<{ close: []; logged: [] }>()

const structure = computed(() => {
  if (!props.day.structureJson) return null
  try {
    return JSON.parse(props.day.structureJson) as Record<string, string>
  }
  catch {
    return null
  }
})

const rpe = ref<number | null>(null)
const duration = ref<number | null>(props.day.durationMinutes ?? null)
const notes = ref('')
const logging = ref(false)
const error = ref<string | null>(null)

// v-model.number sends "" (not null) when the field is cleared — the zod schema on the server
// rejects that with a 400. Coerce to null before sending so "cleared" round-trips as "no value".
function numberOrNull(value: unknown): number | null {
  return value === '' || value == null ? null : (value as number)
}

async function log(status: 'completed' | 'skipped') {
  logging.value = true
  error.value = null
  try {
    await $fetch('/api/training/log', {
      method: 'POST',
      body: {
        date: props.day.date,
        status,
        actualRpe: numberOrNull(rpe.value),
        actualDurationMinutes: numberOrNull(duration.value),
        notes: notes.value || null,
      },
    })
    emit('logged')
  }
  catch {
    error.value = 'Impossible d\'enregistrer la séance. Vérifie les champs et réessaie.'
  }
  finally {
    logging.value = false
  }
}
</script>

<template>
  <div class="detail">
    <button type="button" class="close" @click="emit('close')">
      ✕
    </button>

    <template v-if="day.hasSession">
      <h2>{{ day.sessionName }}</h2>
      <p class="meta">{{ day.discipline }} · {{ day.targetIntensity }} · {{ day.durationMinutes }} min · {{ day.status }}</p>
      <ul v-if="structure">
        <li v-for="(value, key) in structure" :key="key">
          <strong>{{ key }}</strong> : {{ value }}
        </li>
      </ul>

      <div v-if="day.status === 'planned'" class="log-form">
        <label>RPE (1-10) <input v-model.number="rpe" type="number" min="1" max="10"></label>
        <label>Durée réelle (min) <input v-model.number="duration" type="number" min="1"></label>
        <label>Notes <input v-model="notes"></label>
        <p v-if="error" class="error">
          {{ error }}
        </p>
        <div class="actions">
          <button type="button" :disabled="logging" @click="log('completed')">
            Fait
          </button>
          <button type="button" :disabled="logging" @click="log('skipped')">
            Sauté
          </button>
        </div>
      </div>
    </template>
    <p v-else>
      Pas de séance ce jour-là{{ day.reason ? ` (${day.reason})` : '' }}.
    </p>
  </div>
</template>

<style scoped>
.detail {
  margin-top: 1rem;
  padding: 16px;
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  background: var(--surface);
  position: relative;
  font-family: var(--font-body);
  color: var(--text);
}
.detail h2 {
  font-size: 19px;
  margin: 0 0 4px;
}
.close {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  background: none;
  border: none;
  color: var(--text-label);
  cursor: pointer;
  font-size: 14px;
}
.meta {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 12px;
}
.detail ul {
  margin: 12px 0 0;
  padding-left: 18px;
  font-size: 14px;
  color: var(--text-secondary);
}
.log-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 16px;
}
.log-form label {
  font-size: 13px;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.log-form input {
  padding: 10px 12px;
  border: 1px solid var(--border-accent);
  border-radius: 8px;
  background: var(--fill);
  font-family: var(--font-mono);
  font-size: 14px;
  color: var(--text);
}
.actions {
  display: flex;
  gap: 10px;
}
.actions button {
  padding: 12px;
  border-radius: 8px;
  border: 1px solid var(--border-accent);
  background: var(--mint-chip);
  color: #24352F;
  font-weight: 600;
  cursor: pointer;
}
.actions button:last-child {
  background: none;
  color: var(--text-secondary);
}
.error {
  color: #B4472A;
  font-size: 0.85rem;
  margin: 0;
}
</style>
