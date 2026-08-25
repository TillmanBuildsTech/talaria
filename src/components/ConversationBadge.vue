<template>
  <!-- DM: a colored dot. Group: overlapping member dots. -->
  <span class="w-8 shrink-0 flex items-center">
    <template v-if="isGroup">
      <span class="flex">
        <span
          v-for="(name, i) in shown"
          :key="name"
          class="w-4 h-4 rounded-full border-2 border-slate-950 flex items-center justify-center"
          :style="{ backgroundColor: color(name), marginLeft: i ? -8 : 0 }"
          :title="store.agentDisplay(name)"
        />
        <span
          v-if="overlap > 0"
          class="w-4 h-4 rounded-full border-2 border-slate-950 bg-slate-700 text-[8px] text-slate-300 flex items-center justify-center"
          :style="{ marginLeft: -8 }"
        >+{{ overlap }}</span>
      </span>
    </template>
    <template v-else-if="agent">
      <span
        class="w-2 h-2 rounded-full"
        :style="{ backgroundColor: color(agent) }"
        :title="store.agentDisplay(agent)"
      />
    </template>
  </span>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  conv: { type: Object, required: true },
  store: { type: Object, required: true }
})

const isGroup = computed(() => props.conv.kind === 'group')
const agent = computed(() => (props.conv.agentIds && props.conv.agentIds.length ? props.conv.agentIds[0] : null))
const shown = computed(() => {
  const ids = props.conv.agentIds || []
  return ids.slice(0, 3)
})
const overlap = computed(() => {
  const ids = props.conv.agentIds || []
  return ids.length > 3 ? ids.length - 3 : 0
})

function color(name) {
  return props.store.agentColor(name)
}
</script>