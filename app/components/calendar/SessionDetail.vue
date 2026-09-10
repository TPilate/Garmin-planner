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
  padding: 0.75rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  position: relative;
}
.close {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
}
.meta {
  color: #6b7280;
  font-size: 0.85rem;
}
.log-form {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-top: 0.75rem;
}
.actions {
  display: flex;
  gap: 0.5rem;
}
.error {
  color: #b91c1c;
  font-size: 0.85rem;
  margin: 0;
}
</style>
