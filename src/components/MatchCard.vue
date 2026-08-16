<script setup lang="ts">
import type { Match } from '@/types/match'
import type { Team } from '@/types/team'

const props = defineProps<{
  match: Match
  teamA: Team | null
  teamB: Team | null
  size?: 'sm' | 'md'
}>()

const emit = defineEmits<{
  (e: 'edit', match: Match): void
}>()

function handleClick() {
  emit('edit', props.match)
}

const statusLabel: Record<string, string> = {
  finished: '已完成',
  live: '进行中',
  upcoming: '未开始',
}

function roundLabel(round: string): string {
  const map: Record<string, string> = {
    UB_R1: '胜者组第1轮',
    UB_R2: '胜者组第2轮',
    UB_R3: '胜者组第3轮',
    UB_F: '胜者组决赛',
    MB_R1: '突围组第1轮',
    MB_R2: '突围组第2轮',
    MB_R3: '突围组第3轮',
    MB_F: '突围组决赛',
    LB_R1: '败者组第1轮',
    LB_R2: '败者组第2轮',
    LB_R3: '败者组第3轮',
    LB_R4: '败者组第4轮',
    LB_F: '败者组决赛',
    GF: '总决赛',
  }
  return map[round] || round
}
</script>

<template>
  <div
    class="match-card"
    :class="{
      'match-card--sm': size === 'sm' || !size,
      'match-card--md': size === 'md',
      'match-card--winner': match.winner !== null,
      'match-card--live': match.status === 'live',
    }"
    @click="handleClick"
  >
    <div class="match-card__header">
      <span class="match-card__round">{{ roundLabel(match.round) }}</span>
      <span v-if="match.status === 'live'" class="match-card__live-dot">●</span>
    </div>

    <div class="match-card__team" :class="{ 'match-card__team--winner': match.winner === match.teamA }">
      <span class="match-card__team-name">{{ teamA?.teamNameCn ?? '待定' }}</span>
      <span class="match-card__score">{{ match.scoreA }}</span>
    </div>

    <div class="match-card__team" :class="{ 'match-card__team--winner': match.winner === match.teamB }">
      <span class="match-card__team-name">{{ teamB?.teamNameCn ?? '待定' }}</span>
      <span class="match-card__score">{{ match.scoreB }}</span>
    </div>

    <div class="match-card__status">
      <span class="status-badge" :class="{
        'status-locked': match.status === 'finished',
        'status-pending': match.status === 'upcoming',
        'status-qualified': match.status === 'live',
      }">
        {{ statusLabel[match.status] }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.match-card {
  @apply rounded-lg border border-gray-300 bg-white cursor-pointer select-none
         transition-shadow duration-150;
}

.match-card:hover {
  @apply shadow-md;
}

.match-card--sm {
  @apply w-44 text-xs;
}

.match-card--md {
  @apply w-60 text-sm;
}

.match-card--winner {
  @apply border-green-400;
}

.match-card--live {
  @apply border-yellow-400 ring-2 ring-yellow-200;
}

.match-card__header {
  @apply flex items-center justify-between px-2 py-1 border-b border-gray-100 bg-gray-50
         rounded-t-lg;
}

.match-card__round {
  @apply text-gray-500 font-medium;
}

.match-card__live-dot {
  @apply text-red-500 animate-pulse text-xs;
}

.match-card__team {
  @apply flex items-center justify-between px-2 py-1;
}

.match-card__team--winner {
  @apply bg-green-50 font-semibold text-green-800;
}

.match-card__team-name {
  @apply truncate flex-1;
}

.match-card__score {
  @apply ml-2 font-mono font-bold text-gray-700 min-w-[1.5rem] text-right;
}

.match-card__status {
  @apply px-2 pb-1.5 pt-0.5 flex justify-end;
}
</style>