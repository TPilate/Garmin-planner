<script setup lang="ts">
interface ShiftCode {
  code: string
  label: string
  startTime: string
  endTime: string
  crossesMidnight: boolean
  durationMinutes: number
  category: 'long_day' | 'night' | 'half_day'
  active: boolean
}

const { data, refresh } = await useFetch<ShiftCode[]>('/api/shift-codes')
const codes = computed(() => data.value ?? [])

const saving = ref<string | null>(null)
async function saveCode(c: ShiftCode) {
  saving.value = c.code
  try {
    await $fetch('/api/shift-codes', { method: 'PUT', body: c })
    await refresh()
  }
  finally {
    saving.value = null
  }
}

const newCode = ref<ShiftCode>({
  code: '',
  label: '',
  startTime: '07:00',
  endTime: '15:00',
  crossesMidnight: false,
  durationMinutes: 480,
  category: 'long_day',
  active: true,
})

async function addCode() {
  await saveCode(newCode.value)
  newCode.value = { ...newCode.value, code: '', label: '' }
}
</script>

<template>
  <main class="page">
    <h1>Codes de garde</h1>
    <p class="hint">
      Les codes sont hospitaliers et peuvent changer — la logique de planification ne dépend
      que de la catégorie (jour long / nuit / demi-journée), jamais du code littéral.
    </p>

    <table>
      <thead>
        <tr>
          <th>Code</th><th>Libellé</th><th>Début</th><th>Fin</th><th>Traverse minuit</th>
          <th>Catégorie</th><th>Actif</th><th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in codes" :key="c.code">
          <td>{{ c.code }}</td>
          <td><input v-model="c.label"></td>
          <td><input v-model="c.startTime" type="time"></td>
          <td><input v-model="c.endTime" type="time"></td>
          <td><input v-model="c.crossesMidnight" type="checkbox"></td>
          <td>
            <select v-model="c.category">
              <option value="long_day">
                Jour long
              </option>
              <option value="night">
                Nuit
              </option>
              <option value="half_day">
                Demi-journée
              </option>
            </select>
          </td>
          <td><input v-model="c.active" type="checkbox"></td>
          <td>
            <button type="button" :disabled="saving === c.code" @click="saveCode(c)">
              Enregistrer
            </button>
          </td>
        </tr>
        <tr>
          <td><input v-model="newCode.code" placeholder="ex: RTT"></td>
          <td><input v-model="newCode.label" placeholder="libellé"></td>
          <td><input v-model="newCode.startTime" type="time"></td>
          <td><input v-model="newCode.endTime" type="time"></td>
          <td><input v-model="newCode.crossesMidnight" type="checkbox"></td>
          <td>
            <select v-model="newCode.category">
              <option value="long_day">
                Jour long
              </option>
              <option value="night">
                Nuit
              </option>
              <option value="half_day">
                Demi-journée
              </option>
            </select>
          </td>
          <td><input v-model="newCode.active" type="checkbox"></td>
          <td>
            <button type="button" :disabled="!newCode.code || !newCode.label" @click="addCode">
              Ajouter
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </main>
</template>

<style scoped>
.page {
  max-width: 900px;
  margin: 0 auto;
  padding: 1rem;
}
.hint {
  color: #6b7280;
  font-size: 0.85rem;
}
table {
  width: 100%;
  border-collapse: collapse;
}
td, th {
  border: 1px solid #e5e7eb;
  padding: 0.4rem;
  text-align: left;
}
input[type='text'], input:not([type]) {
  width: 100%;
}
</style>
