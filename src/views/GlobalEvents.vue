<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { store, initData } from '@/store'
import { updateEngine } from '@/engine'
import StatusBadge from '@/components/StatusBadge.vue'

// ── 赛事定义 ──

interface SlotInfo {
  label: string
  teamId: string | null
  determined: boolean
}

interface EventCard {
  id: string
  name: string
  icon: string
  time: string
  location: string
  totalSlots: number
  source: string
  qualifiers: string[]
  determined: boolean
}

// ── 状态 ──

const loading = ref(true)

// 赛事数据
const eventCards = ref<EventCard[]>([])

// 冠军赛名额详情
const championSlots = ref<SlotInfo[]>([])

// ── 辅助函数 ──

function getTeamName(teamId: string): string {
  return store.teams.find((t) => t.teamId === teamId)?.teamNameCn ?? teamId
}

/** 判断某阶段所有比赛是否已完成 */
function isStageComplete(stage: string): boolean {
  const stageMatches = store.matches.filter((m) => m.stage === stage)
  if (stageMatches.length === 0) return false
  return stageMatches.every((m) => m.status === 'finished')
}

/** 获取三败淘汰制（启点赛）前三名 */
function getKickoffTop3(): string[] {
  const kickoff = store.matches.filter((m) => m.stage === 'kickoff')
  const ubFinal = kickoff.find((m) => m.round === 'UB_F')
  const mbFinal = kickoff.find((m) => m.round === 'MB_F')
  const lbFinal = kickoff.find((m) => m.round === 'LB_F')
  const result: string[] = []
  if (ubFinal?.winner) result.push(ubFinal.winner)
  if (mbFinal?.winner) result.push(mbFinal.winner)
  if (lbFinal?.winner) result.push(lbFinal.winner)
  return result
}

/** 获取双败淘汰制（第一赛段季后赛）前三名 */
function getStage1PlayoffTop3(): string[] {
  const s1p = store.matches.filter((m) => m.stage === 'stage1_playoff')
  const gf = s1p.find((m) => m.round === 'GF')
  const lbFinal = s1p.find((m) => m.round === 'LB_F')
  const result: string[] = []
  if (gf?.winner && gf?.teamA && gf?.teamB) {
    result.push(gf.winner)
    const runnerUp = gf.winner === gf.teamA ? gf.teamB : gf.teamA
    result.push(runnerUp)
  }
  if (lbFinal?.winner && lbFinal?.teamA && lbFinal?.teamB) {
    const third = lbFinal.winner === lbFinal.teamA ? lbFinal.teamB : lbFinal.teamA
    result.push(third)
  }
  return result
}

/** 获取第二赛段季后赛冠亚军 */
function getStage2PlayoffTop2(): string[] {
  const s2p = store.matches.filter((m) => m.stage === 'stage2_playoff')
  const gf = s2p.find((m) => m.round === 'GF')
  if (gf?.winner && gf?.teamA && gf?.teamB) {
    const runnerUp = gf.winner === gf.teamA ? gf.teamB : gf.teamA
    return [gf.winner, runnerUp]
  }
  return []
}

/** 构建赛事数据 */
function buildEvents() {
  const engineResult = updateEngine(store.teams, store.matches, store.points)

  const kickoffComplete = isStageComplete('kickoff')
  const s1PlayoffComplete = isStageComplete('stage1_playoff')
  const s2PlayoffComplete = isStageComplete('stage2_playoff')

  // 圣地亚哥大师赛
  const santiagoTop3 = kickoffComplete ? getKickoffTop3() : []
  eventCards.value = [
    {
      id: 'santiago',
      name: '圣地亚哥大师赛',
      icon: '🏔️',
      time: '2025 年 3 月',
      location: '智利 · 圣地亚哥',
      totalSlots: 3,
      source: '启点赛前 3 名',
      qualifiers: santiagoTop3,
      determined: kickoffComplete,
    },
    {
      id: 'london',
      name: '伦敦大师赛',
      icon: '🎡',
      time: '2025 年 6 月',
      location: '英国 · 伦敦',
      totalSlots: 3,
      source: '第一赛段季后赛前 3 名',
      qualifiers: s1PlayoffComplete ? getStage1PlayoffTop3() : [],
      determined: s1PlayoffComplete,
    },
    {
      id: 'champions',
      name: '上海全球冠军赛',
      icon: '🏆',
      time: '2025 年 8 月',
      location: '中国 · 上海',
      totalSlots: 4,
      source: '第二赛段前 2 名 + 积分前 2 名',
      qualifiers: engineResult.championshipQualifiers.qualified,
      determined: s2PlayoffComplete,
    },
  ]

  // 冠军赛名额详情
  const s2Top2 = getStage2PlayoffTop2()
  const directQualified = s2Top2.filter(Boolean)
  const sortedPoints = engineResult.sortedPoints.filter(
    (p) => !directQualified.includes(p.teamId),
  )

  championSlots.value = [
    {
      label: '第二赛段季后赛冠军',
      teamId: s2Top2[0] ?? null,
      determined: s2PlayoffComplete && s2Top2.length > 0,
    },
    {
      label: '第二赛段季后赛亚军',
      teamId: s2Top2[1] ?? null,
      determined: s2PlayoffComplete && s2Top2.length > 1,
    },
    {
      label: '全年积分第 1 名（扣除直通队伍后）',
      teamId: sortedPoints[0]?.teamId ?? null,
      determined: s2PlayoffComplete,
    },
    {
      label: '全年积分第 2 名（扣除直通队伍后）',
      teamId: sortedPoints[1]?.teamId ?? null,
      determined: s2PlayoffComplete,
    },
  ]
}

// ── 生命周期 ──

async function loadAndCompute() {
  loading.value = true
  if (!store.loaded) {
    await initData()
  }
  if (store.teams.length) {
    buildEvents()
  }
  loading.value = false
}

onMounted(loadAndCompute)

watch(
  () => [store.loaded, store.teams.length, store.matches.length, store.points.length],
  () => {
    if (store.loaded && store.teams.length) {
      buildEvents()
    }
  },
)
</script>

<template>
  <div>
    <h1 class="page-title">全球赛事 · CN 赛区晋级追踪</h1>
    <p class="page-subtitle">
      实时追踪 VCT CN 赛区各队伍在全球赛事中的名额获得情况 —— 圣地亚哥大师赛、伦敦大师赛与上海全球冠军赛。
    </p>

    <!-- 加载中 -->
    <div v-if="loading" class="card card-body text-sm text-gray-500">数据加载中…</div>

    <!-- 错误 -->
    <div v-else-if="store.error" class="card card-body text-sm text-red-600">{{ store.error }}</div>

    <!-- 主内容 -->
    <template v-else-if="store.teams.length">
      <!-- 赛事卡片 -->
      <div class="mb-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="event in eventCards"
          :key="event.id"
          class="card overflow-hidden transition-shadow duration-200 hover:shadow-md"
        >
          <!-- 头部 -->
          <div class="border-b border-gray-100 bg-gradient-to-br from-gray-50 to-white px-5 py-4">
            <div class="mb-1 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="text-xl">{{ event.icon }}</span>
                <h3 class="text-base font-bold text-gray-900">{{ event.name }}</h3>
              </div>
              <span class="text-xs font-semibold text-gray-400">{{ event.time }}</span>
            </div>
            <p class="text-xs text-gray-500">{{ event.location }}</p>
          </div>

          <!-- 体部 -->
          <div class="px-5 py-4">
            <!-- 名额信息 -->
            <div class="mb-3 flex items-center justify-between">
              <div>
                <span class="text-sm font-semibold text-gray-700">CN 赛区名额</span>
                <span
                  class="ml-2 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-bold text-gray-600"
                >
                  {{ event.determined ? `${event.qualifiers.length}/${event.totalSlots}` : `?/${event.totalSlots}` }}
                </span>
              </div>
              <span class="text-xs text-gray-400">{{ event.determined ? '' : '待定' }}</span>
            </div>

            <!-- 晋级来源 -->
            <div class="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
              <span class="font-medium">晋级来源：</span>{{ event.source }}
            </div>

            <!-- 进度条 -->
            <div class="mb-3">
              <div class="mb-1 flex items-center justify-between text-xs">
                <span class="text-gray-500">名额进度</span>
                <span class="font-medium text-gray-700">
                  {{ event.determined ? event.qualifiers.length : '?' }} / {{ event.totalSlots }}
                </span>
              </div>
              <div class="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  class="h-full rounded-full transition-all duration-500"
                  :class="event.determined && event.qualifiers.length === event.totalSlots
                    ? 'bg-green-500'
                    : 'bg-amber-400'"
                  :style="{ width: event.determined ? `${(event.qualifiers.length / event.totalSlots) * 100}%` : '0%' }"
                />
              </div>
            </div>

            <!-- 已晋级队伍 -->
            <div>
              <div class="mb-1.5 text-xs font-medium text-gray-500">已晋级队伍</div>
              <div v-if="event.determined && event.qualifiers.length" class="space-y-1.5">
                <div
                  v-for="(tid, idx) in event.qualifiers"
                  :key="tid"
                  class="flex items-center justify-between rounded-lg bg-green-50 px-3 py-1.5"
                >
                  <div class="flex items-center gap-2">
                    <span
                      class="flex h-6 w-6 items-center justify-center rounded-full bg-green-200 text-xs font-bold text-green-700"
                    >
                      {{ idx + 1 }}
                    </span>
                    <span class="text-sm font-medium text-gray-800">{{ getTeamName(tid) }}</span>
                  </div>
                  <StatusBadge status="qualified" />
                </div>
              </div>
              <div v-else class="rounded-lg bg-gray-50 px-3 py-3 text-center text-xs text-gray-400">
                {{ event.determined ? '暂无已晋级队伍' : '赛事尚未结束，名额待定' }}
              </div>
            </div>

            <!-- 剩余名额 -->
            <div class="mt-3 border-t border-dashed border-gray-200 pt-3 text-center">
              <span class="text-xs text-gray-400">
                剩余名额：
                <span v-if="event.determined" class="font-semibold text-gray-600">
                  {{ event.totalSlots - event.qualifiers.length }}
                </span>
                <span v-else class="font-semibold text-amber-500">待定</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 冠军赛名额详细说明 -->
      <div class="card overflow-hidden">
        <div class="border-b border-gray-100 bg-gradient-to-br from-amber-50 to-white px-5 py-4">
          <div class="flex items-center gap-2">
            <span class="text-lg">🏆</span>
            <h3 class="text-base font-bold text-gray-900">上海全球冠军赛 · 名额详细说明</h3>
          </div>
          <p class="mt-1 text-xs text-gray-500">
            CN 赛区共 4 个名额，分配方式如下：
          </p>
        </div>
        <div class="divide-y divide-gray-100 px-5 py-2">
          <div
            v-for="(slot, idx) in championSlots"
            :key="idx"
            class="flex items-center justify-between py-3"
          >
            <div class="flex items-center gap-3">
              <span
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                :class="slot.determined ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-400'"
              >
                {{ idx + 1 }}
              </span>
              <div>
                <span class="text-sm font-medium text-gray-700">{{ slot.label }}</span>
                <div v-if="slot.determined && slot.teamId" class="mt-0.5 text-xs text-gray-400">
                  {{ getTeamName(slot.teamId) }}
                </div>
              </div>
            </div>
            <div v-if="slot.determined && slot.teamId">
              <StatusBadge status="qualified" />
            </div>
            <div v-else>
              <span class="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500">
                待定
              </span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 空数据 -->
    <div v-else class="card card-body text-sm text-gray-500">暂无数据。</div>
  </div>
</template>