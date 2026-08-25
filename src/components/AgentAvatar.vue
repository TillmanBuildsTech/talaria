<template>
  <span
    class="rounded-full flex items-center justify-center shrink-0 font-semibold select-none"
    :style="{ backgroundColor: color || '#64748b', width: size + 'px', height: size + 'px', fontSize: Math.max(8, size * 0.4) + 'px' }"
    :title="display || name"
  >
    <span class="text-white leading-none">{{ initials }}</span>
  </span>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  name: { type: String, default: '' },
  display: { type: String, default: '' },
  color: { type: String, default: '' },
  size: { type: Number, default: 10 }
})

const initials = computed(() => {
  const label = props.display || props.name
  const words = label
    .replace(/[-_]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return (label.slice(0, 1) || '?').toUpperCase()
})
</script>