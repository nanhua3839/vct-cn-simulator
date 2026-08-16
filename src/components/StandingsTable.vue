<script setup lang="ts">
import type { TeamWithStanding } from '@/types/bracket'
import StatusBadge from './StatusBadge.vue'
import TooltipWrapper from './TooltipWrapper.vue'

defineProps<{
  teams: TeamWithStanding[]
  title: string
}>()
</script>

<template>
  <div class="card">
    <div class="card-body">
      <h3 class="mb-3 text-lg font-bold text-gray-900">{{ title }}</h3>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-500">
              <th class="py-2 pr-2">#</th>
              <th class="py-2 pr-2">队伍</th>
              <th class="py-2 pr-2 text-center">胜</th>
              <th class="py-2 pr-2 text-center">负</th>
              <th class="py-2 pr-2">状态</th>
              <th class="py-2 pr-2">出线条件</th>
              <th class="py-2">理论排名</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="team in teams"
              :key="team.teamId"
              class="border-b border-gray-100 transition-colors hover:bg-gray-50"
              :class="{
                'bg-green-50/50': team.status === 'qualified' || team.status === 'locked',
                'bg-red-50/50': team.status === 'eliminated' || team.status === 'out',
              }"
            >
              <td class="py-2 pr-2 font-bold text-gray-700">{{ team.rank }}</td>
              <td class="py-2 pr-2 font-medium text-gray-900">{{ team.teamNameCn }}</td>
              <td class="py-2 pr-2 text-center font-mono">{{ team.wins }}</td>
              <td class="py-2 pr-2 text-center font-mono">{{ team.losses }}</td>
              <td class="py-2 pr-2">
                <StatusBadge :status="team.status" />
              </td>
              <td class="py-2 pr-2 text-xs text-gray-600 max-w-40">
                <TooltipWrapper :text="team.condition">
                  <span class="truncate block">{{ team.condition || '—' }}</span>
                </TooltipWrapper>
              </td>
              <td class="py-2 text-xs text-gray-500">
                <TooltipWrapper :text="`理论排名范围：第 ${team.theoreticalMinRank} - ${team.theoreticalMaxRank} 名`">
                  <span>{{ team.theoreticalMinRank }} - {{ team.theoreticalMaxRank }}</span>
                </TooltipWrapper>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>