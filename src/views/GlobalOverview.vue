<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { store, initData, resetMatches } from '@/store'
import type { Stage } from '@/types/match'

const router = useRouter()

onMounted(() => {
  if (!store.loaded) initData()
})

/** 判断某阶段的所有比赛是否已完成 */
function isStageComplete(stage: Stage): boolean {
  const stageMatches = store.matches.filter((m) => m.stage === stage)
  if (stageMatches.length === 0) return false
  return stageMatches.every((m) => m.status === 'finished')
}

/** 判断某阶段是否有比赛 */
function isStageStarted(stage: Stage): boolean {
  return store.matches.some((m) => m.stage === stage)
}

/** 当前进行中的阶段组名 */
const currentStageGroup = computed(() => {
  const groups = [
    { name: 'stage2', stages: ['stage2_regular', 'stage2_playins', 'stage2_playoff'] as Stage[] },
    { name: 'stage1', stages: ['stage1_regular', 'stage1_playoff'] as Stage[] },
    { name: 'kickoff', stages: ['kickoff'] as Stage[] },
  ]
  for (const group of groups) {
    for (const stage of group.stages) {
      const stageMatches = store.matches.filter((m) => m.stage === stage)
      if (stageMatches.length > 0 && !stageMatches.every((m) => m.status === 'finished')) {
        return group.name
      }
    }
  }
  return null
})

/** 时间轴卡片定义 */
interface TimelineCard {
  id: string
  label: string
  route: string
  dateRange: string
  slots: string
  globalEvent: string
  subStages: string
  stageKeys: Stage[]
  /** 是否为全球赛事层面的卡片 */
  isGlobal: boolean
}

const timelineCards: TimelineCard[] = [
  {
    id: 'kickoff',
    label: '启点赛',
    route: '/kickoff',
    dateRange: '2025年1月',
    slots: '3 个名额',
    globalEvent: '圣地亚哥大师赛',
    subStages: '三败淘汰 · 12 队 → 3 队',
    stageKeys: ['kickoff'],
    isGlobal: false,
  },
  {
    id: 'stage1',
    label: '第一赛段',
    route: '/stage1',
    dateRange: '2025年3月 - 5月',
    slots: '3 个名额',
    globalEvent: '伦敦大师赛',
    subStages: '常规赛 → 排位赛 → 季后赛',
    stageKeys: ['stage1_regular', 'stage1_playoff'],
    isGlobal: false,
  },
  {
    id: 'stage2',
    label: '第二赛段',
    route: '/stage2',
    dateRange: '2025年6月 - 8月',
    slots: '冠亚军直通',
    globalEvent: '上海全球冠军赛',
    subStages: '常规赛 → 排位赛 → 入围赛 → 季后赛',
    stageKeys: ['stage2_regular', 'stage2_playins', 'stage2_playoff'],
    isGlobal: false,
  },
  {
    id: 'points',
    label: '积分排行',
    route: '/points',
    dateRange: '全年累计',
    slots: '2 个名额',
    globalEvent: '上海全球冠军赛',
    subStages: '全年冠军赛积分排名',
    stageKeys: [],
    isGlobal: false,
  },
  {
    id: 'global',
    label: '全球赛事',
    route: '/global',
    dateRange: '全年',
    slots: '3 项赛事',
    globalEvent: '全球舞台',
    subStages: '圣地亚哥 · 伦敦 · 上海',
    stageKeys: [],
    isGlobal: true,
  },
]

/** 计算卡片的状态 */
function getCardStatus(
  card: TimelineCard,
): 'current' | 'completed' | 'upcoming' | 'info' {
  if (card.isGlobal) return 'info'
  if (card.stageKeys.length === 0) return 'info'
  if (currentStageGroup.value === card.id) return 'current'
  if (card.stageKeys.every((s) => isStageComplete(s))) return 'completed'
  if (card.stageKeys.some((s) => isStageStarted(s))) return 'current'
  return 'upcoming'
}

/** 跳转到对应路由 */
function navigateTo(route: string) {
  router.push(route)
}

/** 统计各阶段已完成的比赛场次 */
function completedCount(stage: Stage): number {
  return store.matches.filter((m) => m.stage === stage && m.status === 'finished').length
}

function totalCount(stage: Stage): number {
  return store.matches.filter((m) => m.stage === stage).length
}
</script>

<template>
  <div>
    <h1 class="page-title">全局晋级状态总览</h1>
    <p class="page-subtitle">
      全年赛事进程一览 —— 追踪 VCT CN 各阶段赛程进展、晋级名额与对应全球赛事。
    </p>

    <!-- 加载 / 错误 / 空状态 -->
    <div v-if="store.loading" class="card card-body text-sm text-gray-500">数据加载中…</div>
    <div v-else-if="store.error" class="card card-body text-sm text-red-600">{{ store.error }}</div>
    <div v-else-if="!store.teams.length" class="card card-body text-sm text-gray-500">暂无数据。</div>

    <template v-else>
      <!-- 模拟模式横幅 -->
      <div
        v-if="store.isSimulated"
        class="mb-4 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"
      >
        <svg class="h-5 w-5 shrink-0 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 18h.01M12 6v8m0 0a2 2 0 100 4 2 2 0 000-4z" />
        </svg>
        <span class="font-medium">模拟模式 · 所有比赛可编辑</span>
        <button
          class="ml-auto rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-blue-700 shadow-sm transition-colors hover:bg-blue-50"
          @click="resetMatches()"
        >
          重置
        </button>
      </div>

      <!-- 模拟模式入口 -->
      <div class="mb-4 flex items-center justify-end">
        <button
          class="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
          :class="{
            'border-blue-200 bg-blue-50 text-blue-700': store.isSimulated,
            'border-gray-300 bg-white text-gray-700 hover:border-blue-300 hover:text-blue-600': !store.isSimulated,
          }"
          @click="store.isSimulated = !store.isSimulated"
        >
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          {{ store.isSimulated ? '退出模拟模式' : '进入模拟模式' }}
        </button>
      </div>

      <!-- 全年时间轴 -->
      <div class="relative mb-8">
        <!-- 横向滚动容器 -->
        <div class="overflow-x-auto pb-4">
          <div class="flex min-w-[640px] items-stretch gap-0 px-1">
            <!-- 卡片 + 连接线 -->
            <template v-for="(card, idx) in timelineCards" :key="card.id">
              <!-- 连接箭头（非最后一个） -->
              <div
                v-if="idx > 0"
                class="flex shrink-0 items-center px-0"
              >
                <svg
                  class="h-5 w-5 text-gray-300"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
              </div>

              <!-- 卡片 -->
              <button
                class="group relative flex w-52 shrink-0 cursor-pointer flex-col rounded-xl border-2 p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md"
                :class="{
                  'border-emerald-400 bg-emerald-50 shadow-emerald-100': getCardStatus(card) === 'current',
                  'border-gray-200 bg-white text-gray-400': getCardStatus(card) === 'completed',
                  'border-gray-200 bg-white hover:border-gray-300': getCardStatus(card) === 'upcoming' || getCardStatus(card) === 'info',
                }"
                @click="navigateTo(card.route)"
              >
                <!-- 发光边框（当前阶段） -->
                <div
                  v-if="getCardStatus(card) === 'current'"
                  class="pointer-events-none absolute -inset-0.5 rounded-xl opacity-40 blur-sm"
                  :class="{
                    'bg-emerald-400': true,
                  }"
                />

                <!-- 顶部圆点指示器 -->
                <div class="relative z-10 mb-2 flex items-center gap-2">
                  <span
                    class="inline-block h-2.5 w-2.5 rounded-full"
                    :class="{
                      'bg-emerald-500': getCardStatus(card) === 'current',
                      'bg-gray-300': getCardStatus(card) === 'completed',
                      'bg-gray-200': getCardStatus(card) === 'upcoming' || getCardStatus(card) === 'info',
                    }"
                  />
                  <span
                    class="text-xs font-semibold uppercase tracking-wider"
                    :class="{
                      'text-emerald-700': getCardStatus(card) === 'current',
                      'text-gray-400': getCardStatus(card) === 'completed',
                      'text-gray-500': getCardStatus(card) === 'upcoming' || getCardStatus(card) === 'info',
                    }"
                  >
                    {{ card.dateRange }}
                  </span>
                </div>

                <!-- 阶段名称 -->
                <h3
                  class="relative z-10 mb-1 text-base font-bold"
                  :class="{
                    'text-emerald-900': getCardStatus(card) === 'current',
                    'text-gray-900': getCardStatus(card) === 'info' || getCardStatus(card) === 'upcoming',
                    'text-gray-400': getCardStatus(card) === 'completed',
                  }"
                >
                  {{ card.label }}
                </h3>

                <!-- 子阶段说明 -->
                <p
                  class="relative z-10 mb-2 text-xs leading-snug"
                  :class="{
                    'text-emerald-600': getCardStatus(card) === 'current',
                    'text-gray-400': getCardStatus(card) === 'completed',
                    'text-gray-500': getCardStatus(card) === 'upcoming' || getCardStatus(card) === 'info',
                  }"
                >
                  {{ card.subStages }}
                </p>

                <!-- 晋级名额 -->
                <div
                  class="relative z-10 mt-auto rounded-lg px-2.5 py-1.5 text-center text-xs font-semibold"
                  :class="{
                    'bg-emerald-100 text-emerald-800': getCardStatus(card) === 'current',
                    'bg-gray-100 text-gray-500': getCardStatus(card) === 'completed',
                    'bg-blue-50 text-blue-700': getCardStatus(card) === 'info' && card.id !== 'global',
                    'bg-purple-50 text-purple-700': card.id === 'global',
                    'bg-gray-50 text-gray-500': getCardStatus(card) === 'upcoming',
                  }"
                >
                  {{ card.slots }}
                </div>

                <!-- 对应全球赛事 -->
                <div
                  v-if="card.globalEvent"
                  class="relative z-10 mt-1.5 text-center text-[10px] font-medium tracking-tight"
                  :class="{
                    'text-emerald-500': getCardStatus(card) === 'current',
                    'text-gray-300': getCardStatus(card) === 'completed',
                    'text-gray-400': getCardStatus(card) !== 'current' && getCardStatus(card) !== 'completed',
                  }"
                >
                  → {{ card.globalEvent }}
                </div>
              </button>
            </template>
          </div>
        </div>

        <!-- 时间轴底栏 -->
        <div class="mt-2 flex items-center gap-4 text-[11px] text-gray-400">
          <span class="flex items-center gap-1">
            <span class="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            进行中
          </span>
          <span class="flex items-center gap-1">
            <span class="inline-block h-2 w-2 rounded-full bg-gray-300" />
            已完成
          </span>
          <span class="flex items-center gap-1">
            <span class="inline-block h-2 w-2 rounded-full bg-gray-200" />
            未开始
          </span>
        </div>
      </div>

      <!-- 赛事进度详情 -->
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <!-- 启点赛进度 -->
        <div class="card card-body">
          <div class="mb-2 flex items-center gap-2">
            <span class="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            <h3 class="text-sm font-semibold text-gray-900">启点赛</h3>
          </div>
          <div class="mb-1 flex items-baseline gap-1">
            <span class="text-lg font-bold text-gray-900">{{ completedCount('kickoff') }}</span>
            <span class="text-xs text-gray-400">/ {{ totalCount('kickoff') }} 场</span>
          </div>
          <div class="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              class="h-full rounded-full bg-emerald-400 transition-all duration-500"
              :style="{ width: totalCount('kickoff') > 0 ? `${(completedCount('kickoff') / totalCount('kickoff')) * 100}%` : '0%' }"
            />
          </div>
          <p class="mt-1 text-[10px] text-gray-400">前 3 名晋级圣地亚哥大师赛</p>
        </div>

        <!-- 第一赛段进度 -->
        <div class="card card-body">
          <div class="mb-2 flex items-center gap-2">
            <span class="inline-block h-2 w-2 rounded-full" :class="isStageComplete('stage1_playoff') ? 'bg-gray-300' : 'bg-emerald-500'" />
            <h3 class="text-sm font-semibold text-gray-900">第一赛段</h3>
          </div>
          <div class="space-y-1">
            <div>
              <div class="flex items-baseline justify-between">
                <span class="text-xs text-gray-500">常规赛</span>
                <span class="text-xs tabular-nums text-gray-400">{{ completedCount('stage1_regular') }}/{{ totalCount('stage1_regular') }}</span>
              </div>
              <div class="h-1 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  class="h-full rounded-full bg-blue-400 transition-all duration-500"
                  :style="{ width: totalCount('stage1_regular') > 0 ? `${(completedCount('stage1_regular') / totalCount('stage1_regular')) * 100}%` : '0%' }"
                />
              </div>
            </div>
            <div>
              <div class="flex items-baseline justify-between">
                <span class="text-xs text-gray-500">季后赛</span>
                <span class="text-xs tabular-nums text-gray-400">{{ completedCount('stage1_playoff') }}/{{ totalCount('stage1_playoff') }}</span>
              </div>
              <div class="h-1 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  class="h-full rounded-full bg-blue-400 transition-all duration-500"
                  :style="{ width: totalCount('stage1_playoff') > 0 ? `${(completedCount('stage1_playoff') / totalCount('stage1_playoff')) * 100}%` : '0%' }"
                />
              </div>
            </div>
          </div>
          <p class="mt-1 text-[10px] text-gray-400">前 3 名晋级伦敦大师赛</p>
        </div>

        <!-- 第二赛段进度 -->
        <div class="card card-body">
          <div class="mb-2 flex items-center gap-2">
            <span class="inline-block h-2 w-2 rounded-full" :class="isStageComplete('stage2_playoff') ? 'bg-gray-300' : 'bg-emerald-500'" />
            <h3 class="text-sm font-semibold text-gray-900">第二赛段</h3>
          </div>
          <div class="space-y-1">
            <div>
              <div class="flex items-baseline justify-between">
                <span class="text-xs text-gray-500">常规赛</span>
                <span class="text-xs tabular-nums text-gray-400">{{ completedCount('stage2_regular') }}/{{ totalCount('stage2_regular') }}</span>
              </div>
              <div class="h-1 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  class="h-full rounded-full bg-violet-400 transition-all duration-500"
                  :style="{ width: totalCount('stage2_regular') > 0 ? `${(completedCount('stage2_regular') / totalCount('stage2_regular')) * 100}%` : '0%' }"
                />
              </div>
            </div>
            <div>
              <div class="flex items-baseline justify-between">
                <span class="text-xs text-gray-500">入围赛</span>
                <span class="text-xs tabular-nums text-gray-400">{{ completedCount('stage2_playins') }}/{{ totalCount('stage2_playins') }}</span>
              </div>
              <div class="h-1 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  class="h-full rounded-full bg-violet-400 transition-all duration-500"
                  :style="{ width: totalCount('stage2_playins') > 0 ? `${(completedCount('stage2_playins') / totalCount('stage2_playins')) * 100}%` : '0%' }"
                />
              </div>
            </div>
            <div>
              <div class="flex items-baseline justify-between">
                <span class="text-xs text-gray-500">季后赛</span>
                <span class="text-xs tabular-nums text-gray-400">{{ completedCount('stage2_playoff') }}/{{ totalCount('stage2_playoff') }}</span>
              </div>
              <div class="h-1 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  class="h-full rounded-full bg-violet-400 transition-all duration-500"
                  :style="{ width: totalCount('stage2_playoff') > 0 ? `${(completedCount('stage2_playoff') / totalCount('stage2_playoff')) * 100}%` : '0%' }"
                />
              </div>
            </div>
          </div>
          <p class="mt-1 text-[10px] text-gray-400">冠亚军直通上海全球冠军赛</p>
        </div>
      </div>

      <!-- 快速统计 -->
      <div class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="card card-body text-center">
          <div class="text-2xl font-bold text-gray-900">{{ store.teams.length }}</div>
          <div class="text-xs text-gray-500">参赛队伍</div>
        </div>
        <div class="card card-body text-center">
          <div class="text-2xl font-bold text-gray-900">{{ store.matches.length }}</div>
          <div class="text-xs text-gray-500">全年比赛场次</div>
        </div>
        <div class="card card-body text-center">
          <div class="text-2xl font-bold text-green-600">4</div>
          <div class="text-xs text-gray-500">全球冠军赛名额</div>
        </div>
        <div class="card card-body text-center">
          <div class="text-2xl font-bold text-blue-600">6</div>
          <div class="text-xs text-gray-500">大师赛总名额</div>
        </div>
      </div>

      <!-- 重置按钮 -->
      <div class="mt-8 flex justify-center">
        <button
          class="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-5 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
          @click="resetMatches()"
        >
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          重置默认数据
        </button>
      </div>
    </template>
  </div>
</template>