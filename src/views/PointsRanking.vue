<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { store, initData } from '@/store'
import { updateEngine } from '@/engine'
import type { EngineResult } from '@/engine'
import type { Team } from '@/types/team'
import StatusBadge from '@/components/StatusBadge.vue'
import TooltipWrapper from '@/components/TooltipWrapper.vue'

onMounted(() => {
  if (!store.loaded) initData()
})

const engineResult = ref<EngineResult | null>(null)

function compute(): void {
  if (!store.loaded || store.loading) return
  engineResult.value = updateEngine(store.teams, store.matches, store.points)
}

// 响应 store 变化
watch(
  () => [store.loaded, store.teams, store.matches, store.points],
  () => compute(),
  { deep: true, immediate: true },
)

// 队伍名映射
const teamMap = computed<Map<string, Team>>(() => {
  const map = new Map<string, Team>()
  for (const t of store.teams) {
    map.set(t.teamId, t)
  }
  return map
})

const totalSlots = 4

const lockedSlots = computed<number>(() => {
  return engineResult.value?.championshipQualifiers.qualified.length ?? 0
})

const remainingSlots = computed<number>(() => {
  return totalSlots - lockedSlots.value
})

/** 已直通队伍（第二赛段季后赛冠亚军，stage2PlayoffPoints >= 6） */
const directQualified = computed<string[]>(() => {
  if (!engineResult.value) return []
  return engineResult.value.sortedPoints
    .filter((p) => p.qualifiedStatus === 'qualified' && p.stage2PlayoffPoints >= 6)
    .map((p) => p.teamId)
})

/** 仍在争夺剩余名额的队伍 ID 集合 */
const contendingSet = computed<Set<string>>(() => {
  if (!engineResult.value) return new Set()
  return new Set(engineResult.value.championshipQualifiers.remaining)
})

function teamName(teamId: string): string {
  return teamMap.value.get(teamId)?.teamNameCn ?? teamId
}

function teamShortName(teamId: string): string {
  const t = teamMap.value.get(teamId)
  return t?.teamNameCn ?? t?.teamNameEn ?? teamId
}

function rowClass(p: { teamId: string; qualifiedStatus: string }): string {
  if (p.qualifiedStatus === 'qualified') return 'bg-green-50'
  if (contendingSet.value.has(p.teamId)) return 'bg-yellow-50'
  return ''
}
</script>

<template>
  <div>
    <h1 class="page-title">冠军赛积分排行</h1>
    <p class="page-subtitle">全年积分实时排行 · 全球冠军赛名额争夺</p>

    <!-- 加载中 -->
    <div v-if="store.loading" class="card card-body text-sm text-gray-500">数据加载中…</div>
    <div v-else-if="store.error" class="card card-body text-sm text-red-600">{{ store.error }}</div>
    <div v-else-if="!engineResult" class="card card-body text-sm text-gray-500">暂无数据。</div>

    <template v-else>
      <!-- ── 名额概况 ── -->
      <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div class="card card-body text-center">
          <div class="text-2xl font-bold text-gray-900">{{ totalSlots }}</div>
          <div class="mt-1 text-xs text-gray-500">总名额</div>
        </div>
        <div class="card card-body text-center">
          <div class="text-2xl font-bold text-emerald-600">{{ lockedSlots }}</div>
          <div class="mt-1 text-xs text-gray-500">已锁定名额</div>
        </div>
        <div class="card card-body text-center">
          <div class="text-2xl font-bold text-amber-600">{{ remainingSlots }}</div>
          <div class="mt-1 text-xs text-gray-500">剩余争夺名额</div>
        </div>
        <div class="card card-body">
          <div class="mb-1 text-xs font-semibold text-gray-500">已直通队伍</div>
          <div v-if="directQualified.length" class="flex flex-wrap gap-1">
            <span
              v-for="tid in directQualified"
              :key="tid"
              class="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700"
            >
              {{ teamShortName(tid) }}
            </span>
          </div>
          <div v-else class="text-xs text-gray-400">暂无</div>
        </div>
      </div>

      <!-- ── 积分排行表 ── -->
      <div class="card overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[900px] text-left text-sm">
            <thead class="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th class="w-10 px-3 py-3 font-medium">#</th>
                <th class="px-3 py-3 font-medium">队伍</th>
                <th class="px-3 py-3 text-center font-medium">
                  <TooltipWrapper text="启点赛名次积分">启点赛</TooltipWrapper>
                </th>
                <th class="px-3 py-3 text-center font-medium">
                  <TooltipWrapper text="第一赛段常规赛每胜 1 分">S1 常规赛</TooltipWrapper>
                </th>
                <th class="px-3 py-3 text-center font-medium">
                  <TooltipWrapper text="第一赛段季后赛名次积分">S1 季后赛</TooltipWrapper>
                </th>
                <th class="px-3 py-3 text-center font-medium">
                  <TooltipWrapper text="第二赛段常规赛每胜 1 分">S2 常规赛</TooltipWrapper>
                </th>
                <th class="px-3 py-3 text-center font-medium">
                  <TooltipWrapper text="第二赛段季后赛名次积分">S2 季后赛</TooltipWrapper>
                </th>
                <th class="px-3 py-3 text-center font-medium">
                  <TooltipWrapper text="圣地亚哥 + 伦敦大师赛成绩积分">大师赛</TooltipWrapper>
                </th>
                <th class="px-3 py-3 text-center font-medium">总积分</th>
                <th class="px-3 py-3 text-center font-medium">晋级状态</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(p, idx) in engineResult.sortedPoints"
                :key="p.teamId"
                class="border-b border-gray-100 transition-colors last:border-0"
                :class="rowClass(p)"
              >
                <td class="px-3 py-3 font-medium text-gray-500">{{ idx + 1 }}</td>
                <td class="px-3 py-3">
                  <div class="flex items-center gap-3">
                    <span
                      class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600"
                    >
                      {{ teamShortName(p.teamId).slice(0, 1) }}
                    </span>
                    <div>
                      <div class="font-semibold text-gray-900">{{ teamName(p.teamId) }}</div>
                      <div class="text-xs text-gray-400">{{ p.teamId }}</div>
                    </div>
                  </div>
                </td>
                <td class="px-3 py-3 text-center text-gray-700">{{ p.kickoffPoints }}</td>
                <td class="px-3 py-3 text-center text-gray-700">{{ p.stage1RegularPoints }}</td>
                <td class="px-3 py-3 text-center text-gray-700">{{ p.stage1PlayoffPoints }}</td>
                <td class="px-3 py-3 text-center text-gray-700">{{ p.stage2RegularPoints }}</td>
                <td class="px-3 py-3 text-center text-gray-700">{{ p.stage2PlayoffPoints }}</td>
                <td class="px-3 py-3 text-center text-gray-700">{{ p.mastersPoints }}</td>
                <td class="px-3 py-3 text-center font-bold text-gray-900">{{ p.totalPoints }}</td>
                <td class="px-3 py-3 text-center">
                  <StatusBadge :status="p.qualifiedStatus" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 同分规则说明 -->
      <div class="mt-4 flex items-center gap-2 text-xs text-gray-500">
        <span
          class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600"
        >
          ⓘ 同分规则
        </span>
        <span>同分时优先对比大师赛成绩，再对比第二赛段季后赛名次</span>
      </div>

      <!-- ── 积分来源说明 ── -->
      <div class="card card-body mt-6">
        <h3 class="mb-3 text-sm font-semibold text-gray-700">积分来源说明</h3>
        <div class="grid grid-cols-1 gap-3 text-xs text-gray-600 sm:grid-cols-2 lg:grid-cols-3">
          <div class="space-y-1">
            <div class="font-medium text-gray-700">启点赛</div>
            <div>第 1 名 6 分 · 第 2 名 5 分 · 第 3 名 4 分 · 第 4 名 3 分 · 5–6 名 2 分 · 7–8 名 1 分</div>
          </div>
          <div class="space-y-1">
            <div class="font-medium text-gray-700">第一赛段</div>
            <div>常规赛每胜 1 场得 1 分；季后赛第 1 名 6 分 · 第 2 名 4 分 · 第 3 名 3 分 · 第 4 名 2 分</div>
          </div>
          <div class="space-y-1">
            <div class="font-medium text-gray-700">第二赛段</div>
            <div>常规赛每胜 1 场得 1 分；季后赛第 1 名 8 分 · 第 2 名 6 分 · 第 3 名 5 分 · 第 4 名 4 分</div>
          </div>
          <div class="space-y-1">
            <div class="font-medium text-gray-700">大师赛</div>
            <div>圣地亚哥大师赛 + 伦敦大师赛成绩积分，具体分值由赛事排名决定</div>
          </div>
          <div class="space-y-1 sm:col-span-2 lg:col-span-1">
            <div class="font-medium text-gray-700">全球冠军赛名额</div>
            <div>CN 赛区共 4 个名额：第二赛段季后赛冠亚军直通，剩余 2 个按全年总积分顺延</div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>