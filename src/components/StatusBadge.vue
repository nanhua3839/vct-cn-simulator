<script setup lang="ts">
import type { QualifiedStatus } from '@/types/points'

const props = defineProps<{
  status: QualifiedStatus
  text?: string
}>()

const statusTextMap: Record<QualifiedStatus, string> = {
  qualified: '已晋级',
  pending: '待定',
  eliminated: '已淘汰',
  locked: '已锁定',
  out: '已无缘',
}
</script>

<template>
  <span class="status-badge" :class="`status-${status}`">
    {{ text ?? statusTextMap[status] }}
  </span>
</template>