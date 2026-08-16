<script setup lang="ts">
defineProps<{
  text: string
}>()
</script>

<template>
  <span class="tooltip">
    <slot />
    <span class="tooltip-content">{{ text }}</span>
  </span>
</template>