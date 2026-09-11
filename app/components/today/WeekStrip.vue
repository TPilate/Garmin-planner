<script setup lang="ts">
interface WeekDay {
  date: string
  day: number
  label: string
  isToday: boolean
  discipline?: string | null
  hasSession: boolean
}

defineProps<{ days: WeekDay[] }>()

const DOT_COLOR: Record<string, string> = {
  running: 'var(--mint)',
  swimming: 'var(--swim)',
  strength: 'var(--strength)',
  cycling: 'var(--strength)',
}
</script>

<template>
  <div class="strip">
    <div v-for="d in days" :key="d.date" class="day" :class="{ today: d.isToday }">
      <div class="label">
        {{ d.label }}
      </div>
      <div class="num">
        {{ d.day }}
      </div>
      <div
        class="dot"
        :style="{ background: d.hasSession && d.discipline ? DOT_COLOR[d.discipline] : 'var(--rest-dot)' }"
      />
    </div>
  </div>
  <div class="legend">
    <span><span class="key" style="color: var(--mint)">●</span> COURSE</span>
    <span><span class="key" style="color: var(--swim)">●</span> NATATION</span>
    <span><span class="key" style="color: var(--strength)">●</span> MUSCU</span>
    <span><span class="key" style="color: var(--rest-dot)">●</span> REPOS</span>
  </div>
</template>

<style scoped>
.strip {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
  margin-top: 4px;
}
.day {
  text-align: center;
  padding: 8px 0;
  border-radius: 8px;
  background: var(--fill);
  border: 1px solid var(--border);
}
.day.today {
  background: var(--mint-soft);
  border-color: #7FBFAA;
}
.label {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-label);
}
.day.today .label {
  color: var(--mint);
}
.num {
  font-family: var(--font-mono);
  font-size: 13px;
  margin: 3px 0;
  color: var(--text-secondary);
}
.day.today .num {
  color: var(--text);
}
.dot {
  width: 5px;
  height: 5px;
  border-radius: 3px;
  margin: 0 auto;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-faint);
  letter-spacing: 0.04em;
  margin-top: 10px;
}
.key {
  font-size: 10px;
}
</style>
