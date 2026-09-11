<script setup lang="ts">
const props = defineProps<{
  date: string
  dateLabel: string
  discipline?: string
  sessionName?: string
  targetIntensity?: string
  durationMinutes?: number
  structureJson?: string | null
  status?: string
}>()
const emit = defineEmits<{ close: []; logged: [] }>()

const DISCIPLINE_LABELS: Record<string, string> = {
  running: 'COURSE',
  swimming: 'NATATION',
  strength: 'MUSCU',
  cycling: 'VÉLO',
}

const structure = computed(() => {
  if (!props.structureJson) return null
  try {
    return JSON.parse(props.structureJson) as Record<string, string>
  }
  catch {
    return null
  }
})

const rpe = ref(5)
const duration = ref<number | null>(props.durationMinutes ?? null)
const notes = ref('')
const logging = ref(false)
const error = ref<string | null>(null)

function numberOrNull(v: number | string | null): number | null {
  if (v === '' || v === null || v === undefined) return null
  return typeof v === 'number' ? v : Number(v)
}

async function log(status: 'completed' | 'skipped') {
  logging.value = true
  error.value = null
  try {
    await $fetch('/api/training/log', {
      method: 'POST',
      body: {
        date: props.date,
        status,
        actualRpe: status === 'completed' ? numberOrNull(rpe.value) : null,
        actualDurationMinutes: numberOrNull(duration.value),
        notes: notes.value || null,
      },
    })
    emit('logged')
  }
  catch {
    error.value = "L'enregistrement a échoué — réessaie."
  }
  finally {
    logging.value = false
  }
}
</script>

<template>
  <div class="sheet">
    <div class="header">
      <button type="button" class="back" @click="emit('close')">
        ← {{ dateLabel }}
      </button>
      <template v-if="discipline">
        <div class="chips">
          <span class="chip">{{ DISCIPLINE_LABELS[discipline] ?? discipline }}</span>
        </div>
        <div class="name">
          {{ sessionName }}
        </div>
        <div class="meta">
          <span v-if="durationMinutes">{{ durationMinutes }} min</span>
          <span v-if="targetIntensity">{{ targetIntensity }}</span>
        </div>
      </template>
    </div>

    <div v-if="structure" class="structure">
      <span class="section-label">STRUCTURE</span>
      <div class="blocks">
        <div v-for="(value, key) in structure" :key="key" class="block">
          <span class="block-key">{{ key }}</span>
          <span class="block-value">{{ value }}</span>
        </div>
      </div>
    </div>

    <div class="log-area">
      <template v-if="status === 'planned'">
        <span class="section-label">BOUCLAGE</span>

        <div>
          <div class="rpe-header">
            <span>RPE ressenti</span>
            <span class="rpe-value">{{ rpe }}</span>
          </div>
          <div class="rpe-bars">
            <button
              v-for="n in 10"
              :key="n"
              type="button"
              class="rpe-bar"
              :class="{ filled: n <= rpe }"
              :aria-label="`RPE ${n}`"
              @click="rpe = n"
            />
          </div>
        </div>

        <div class="row">
          <div class="field">
            <div class="field-label">
              DURÉE RÉELLE (MIN)
            </div>
            <input v-model.number="duration" type="number" min="1" class="input">
          </div>
        </div>

        <div class="field">
          <div class="field-label">
            NOTES
          </div>
          <textarea v-model="notes" class="input textarea" rows="3" />
        </div>

        <p v-if="error" class="error">
          {{ error }}
        </p>

        <div class="actions">
          <button type="button" class="btn primary" :disabled="logging" @click="log('completed')">
            Enregistrer
          </button>
          <button type="button" class="btn secondary" :disabled="logging" @click="log('skipped')">
            Sauté
          </button>
        </div>
        <p class="hint">
          Le statut est définitif — il alimente le cycle charge/décharge et n'est pas modifiable
          après enregistrement.
        </p>
      </template>

      <template v-else-if="status">
        <span class="section-label">BOUCLAGE</span>
        <div class="logged-status" :class="status">
          {{ status === 'completed' ? 'FAIT' : 'SAUTÉ' }}
        </div>
        <p class="hint">
          Enregistré — statut non modifiable.
        </p>
      </template>

      <p v-else class="hint">
        Pas de séance ce jour-là.
      </p>
    </div>
  </div>
</template>

<style scoped>
.sheet {
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 18px;
  overflow: hidden;
  margin-top: 16px;
}
.header {
  padding: 16px 20px 18px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.back {
  align-self: flex-start;
  background: none;
  border: none;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-label);
  cursor: pointer;
  padding: 0;
}
.chips {
  display: flex;
  align-items: center;
  gap: 8px;
}
.chip {
  font-family: var(--font-mono);
  font-size: 11px;
  background: var(--mint-chip);
  color: #24352F;
  padding: 3px 8px;
  border-radius: 4px;
  font-weight: 600;
  letter-spacing: 0.06em;
}
.name {
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.meta {
  display: flex;
  gap: 18px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
}
.structure {
  padding: 20px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.section-label {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--text-label);
}
.blocks {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.block {
  display: flex;
  gap: 12px;
  align-items: baseline;
  padding: 12px 14px;
  background: var(--fill);
  border-radius: 8px;
  border: 1px solid var(--border);
}
.block-key {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--mint);
  min-width: 60px;
  text-transform: capitalize;
}
.block-value {
  font-size: 14px;
  color: var(--text-secondary);
}
.log-area {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.rpe-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--text-secondary);
}
.rpe-value {
  font-family: var(--font-mono);
  font-size: 15px;
  color: var(--mint);
}
.rpe-bars {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 3px;
}
.rpe-bar {
  height: 26px;
  border-radius: 4px;
  background: var(--border);
  border: none;
  cursor: pointer;
  padding: 0;
}
.rpe-bar.filled {
  background: var(--mint-bar);
}
.row {
  display: flex;
  gap: 10px;
}
.field {
  flex: 1;
}
.field-label {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-label);
  letter-spacing: 0.06em;
  margin-bottom: 6px;
}
.input {
  width: 100%;
  padding: 12px 14px;
  background: var(--fill);
  border: 1px solid var(--border-accent);
  border-radius: 8px;
  font-family: var(--font-mono);
  font-size: 15px;
  color: var(--text);
}
.textarea {
  font-family: var(--font-body);
  font-size: 14px;
  resize: vertical;
}
.error {
  margin: 0;
  font-size: 13px;
  color: #B4472A;
}
.actions {
  display: flex;
  gap: 10px;
}
.btn {
  padding: 14px;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  border: none;
}
.btn.primary {
  flex: 1;
  text-align: center;
  background: var(--mint-chip);
  color: #24352F;
}
.btn.primary:hover {
  background: var(--mint-hover);
}
.btn.secondary {
  padding: 14px 18px;
  border: 1px solid var(--border-accent);
  background: none;
  color: var(--text-muted);
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-faint);
  line-height: 1.5;
}
.logged-status {
  font-size: 17px;
  font-weight: 600;
}
.logged-status.completed {
  color: var(--mint);
}
.logged-status.skipped {
  color: var(--amber);
}
</style>
