<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { store, initData, updateMatchResult, editableMatches } from '@/store'
import { updateEngine, buildTripleEliminationBracket, calculateRemainingLives } from '@/engine'
import type { BracketData, BracketRound } from '@/types/bracket'
import type { MatchStatus } from '@/types/match'
import type { Match } from '@/types/match'
import type { Team } from '@/types/team'
import type { BracketMatchNode } from '@/engine/bracket'
import BracketView from '@/components/BracketView.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import MatchEditor from '@/components/MatchEditor.vue'

// ── 数据初始化 ──

onMounted(() => {
  if (!store.loaded) initData()
})

// 响应 store 变化
watch(
  () => [store.loaded, store.teams, store.matches, store.points],
  () => {
    /* 计算属性已自动响应 */
  },
  { deep: true },
)

// ── 基础数据计算 ──

const kickoffMatches = computed(() =>
  store.matches.filter((m) => m.stage === 'kickoff'),
)

const engineResult = computed(() => {
  if (!store.loaded || store.teams.length === 0) return null
  return updateEngine(store.teams, store.matches, store.points)
})

// 启点赛积分数据
const kickoffPoints = computed(() => {
  if (!engineResult.value) return []
  return engineResult.value.points
    .filter((p) => kickoffMatches.value.some((m) => m.teamA === p.teamId || m.teamB === p.teamId))
    .sort((a, b) => (b.kickoffPoints || 0) - (a.kickoffPoints || 0))
})

// 启点赛是否全部完成
const isKickoffComplete = computed(() => {
  if (kickoffMatches.value.length === 0) return false
  return kickoffMatches.value.every((m) => m.status === 'finished')
})

// ── 对阵图数据转换 ──

/**
 * 将引擎的 TripleEliminationBracketData 转换为 BracketView 所需的 BracketData
 */
const bracketData = computed<BracketData | null>(() => {
  if (!store.loaded || kickoffMatches.value.length === 0) return null

  const raw = buildTripleEliminationBracket(kickoffMatches.value)

  function convertRounds(rounds: BracketMatchNode[][]): BracketRound[] {
    return rounds.map((nodes) => {
      const roundName = nodes.length > 0 ? nodes[0].round : 'R?'
      return {
        roundName,
        matches: nodes.map((n) => ({
          matchId: n.matchId,
          round: n.round,
          teamA: n.teamA,
          teamB: n.teamB,
          scoreA: n.scoreA,
          scoreB: n.scoreB,
          winner: n.winner,
          status: n.status as MatchStatus,
        })),
      }
    })
  }

  const result: BracketData = {
    stage: 'kickoff',
    winnerBracket: convertRounds(raw.winnerBracket),
    loserBracket: convertRounds(raw.loserBracket),
  }

  if (raw.middleBracket && raw.middleBracket.length > 0) {
    result.middleBracket = convertRounds(raw.middleBracket)
  }

  if (raw.grandFinal) {
    const gf = raw.grandFinal
    result.grandFinal = {
      roundName: 'GF',
      matches: [
        {
          matchId: gf.matchId,
          round: gf.round,
          teamA: gf.teamA,
          teamB: gf.teamB,
          scoreA: gf.scoreA,
          scoreB: gf.scoreB,
          winner: gf.winner,
          status: gf.status as MatchStatus,
        },
      ],
    }
  }

  return result
})

// ── 队伍查询 ──

const teamMap = computed(() => {
  const map = new Map<string, Team>()
  for (const t of store.teams) {
    map.set(t.teamId, t)
  }
  return map
})

// ── 启点赛晋级状态计算 ──

interface KickoffTeamInfo {
  teamId: string
  teamNameCn: string
  remainingLives: number
  status: 'qualified' | 'pending' | 'eliminated'
  condition: string
  /** 在启点赛中的最终名次（仅赛事完成后有值） */
  rank: number | null
}

/**
 * 从三败淘汰对阵中推断启点赛最终排名
 */
function inferKickoffRank(matches: typeof store.matches, teamId: string): number | null {
  if (!isKickoffComplete.value) return null

  const km = matches.filter((m) => m.stage === 'kickoff')

  // 1st: UB_F 胜者
  const ubFinal = km.find((m) => m.round === 'UB_F' && m.status === 'finished' && m.winner)
  if (ubFinal && ubFinal.winner === teamId) return 1

  // 2nd: MB_F 胜者 或 GF 获胜方
  const gf = km.find((m) => (m.round === 'GF' || m.round === 'GrandFinal') && m.status === 'finished' && m.winner)
  if (gf && gf.winner === teamId) return 1 // GF 胜者 = 总冠军
  if (gf && gf.teamA && gf.teamB && gf.winner && gf.winner !== teamId) {
    // GF 败者 = 亚军
    if (teamId === (gf.winner === gf.teamA ? gf.teamB : gf.teamA)) return 2
  }

  const mbFinal = km.find((m) => m.round === 'MB_F' && m.status === 'finished' && m.winner)
  if (mbFinal && mbFinal.winner === teamId) return 2

  // 3rd: LB_F 胜者
  const lbFinal = km.find((m) => m.round === 'LB_F' && m.status === 'finished' && m.winner)
  if (lbFinal && lbFinal.winner === teamId) return 3

  // 4th: LB_F 败者
  if (lbFinal && lbFinal.teamA && lbFinal.teamB && lbFinal.winner) {
    const fourth = lbFinal.winner === lbFinal.teamA ? lbFinal.teamB : lbFinal.teamA
    if (teamId === fourth) return 4
  }

  // 其余按淘汰顺序从后往前排
  const processed = new Set<string>()
  if (ubFinal?.winner) processed.add(ubFinal.winner)
  if (mbFinal?.winner) processed.add(mbFinal.winner)
  if (lbFinal?.winner) processed.add(lbFinal.winner)
  if (lbFinal?.winner) {
    const fourth = lbFinal.winner === lbFinal.teamA ? lbFinal.teamB : lbFinal.teamA
    if (fourth) processed.add(fourth)
  }
  if (gf?.winner) {
    processed.add(gf.winner)
    if (gf.teamA && gf.teamB) {
      const gfLoser = gf.winner === gf.teamA ? gf.teamB : gf.teamA
      processed.add(gfLoser)
    }
  }

  const order = ['LB_R4', 'LB_R3', 'LB_R2', 'LB_R1', 'MB_R4', 'MB_R3', 'MB_R2', 'MB_R1', 'UB_R3', 'UB_R2', 'UB_R1']
  let rank = 5
  for (const round of order) {
    const roundMatches = km.filter((m) => m.round === round)
    for (const m of roundMatches) {
      if (m.status !== 'finished' || !m.winner || !m.teamA || !m.teamB) continue
      const loser = m.winner === m.teamA ? m.teamB : m.teamA
      if (!processed.has(loser)) {
        processed.add(loser)
        if (teamId === loser) return rank++
      }
    }
  }

  return null
}

const kickoffTeamStatuses = computed<KickoffTeamInfo[]>(() => {
  if (!store.loaded || store.teams.length === 0) return []

  // 参与启点赛的队伍
  const participatingTeams = store.teams.filter((t) =>
    kickoffMatches.value.some((m) => m.teamA === t.teamId || m.teamB === t.teamId),
  )

  return participatingTeams.map((team) => {
    const tid = team.teamId
    const lives = calculateRemainingLives(tid, kickoffMatches.value)
    const rank = inferKickoffRank(store.matches, tid)

    // 判定状态
    let status: 'qualified' | 'pending' | 'eliminated'
    let condition: string

    if (isKickoffComplete.value) {
      // 赛事完成，前 3 名晋级
      if (rank !== null && rank <= 3) {
        status = 'qualified'
        condition = `第 ${rank} 名，晋级圣地亚哥大师赛`
      } else {
        status = 'eliminated'
        condition = rank ? `最终排名第 ${rank} 名` : '已淘汰'
      }
    } else {
      // 赛事进行中
      if (lives <= 0) {
        status = 'eliminated'
        condition = '已输 3 场，淘汰'
      } else {
        // 检查是否已锁定前 3
        // 通过 bracket 判断：如果已进入总决赛 / 败者组决赛且仍存活
        const bracket = buildTripleEliminationBracket(kickoffMatches.value)
        const allMatches = bracket.allMatches

        // 已进入 GF 或仍在 UB/MB 最后阶段，基本锁定前 3
        // 简化判断：如果该队还有剩余比赛可以打，即为 pending
        const hasUpcoming = kickoffMatches.value.some(
          (m) =>
            (m.teamA === tid || m.teamB === tid) &&
            (m.status === 'upcoming' || m.status === 'live'),
        )

        if (hasUpcoming || lives > 0) {
          // 进一步判断是否已锁定前 3
          // 进入 GF 或 LB_F 的队伍基本锁定前 3
          const gf = allMatches.get('GF') || [...allMatches.values()].find((n) => n.round === 'GF' || n.round === 'GrandFinal')
          const lbFinal = [...allMatches.values()].find((n) => n.round === 'LB_F')

          const inGrandFinal = gf && (gf.teamA === tid || gf.teamB === tid)
          const inLbFinal = lbFinal && (lbFinal.teamA === tid || lbFinal.teamB === tid)

          if (inGrandFinal || inLbFinal) {
            status = 'qualified'
            condition = `已锁定前 3 名，晋级圣地亚哥大师赛（剩余可败 ${lives} 场）`
          } else {
            status = 'pending'
            condition = `剩余可败 ${lives} 场`
          }
        } else {
          // 没有剩余比赛但未淘汰，说明赛事已完成但未进前 3
          status = 'eliminated'
          condition = '未晋级圣地亚哥大师赛'
        }
      }
    }

    return {
      teamId: tid,
      teamNameCn: team.teamNameCn,
      remainingLives: lives,
      status,
      condition,
      rank,
    }
  })
})

// ── 按状态分组 ──

const qualifiedTeams = computed(() =>
  kickoffTeamStatuses.value.filter((t) => t.status === 'qualified'),
)
const pendingTeams = computed(() =>
  kickoffTeamStatuses.value.filter((t) => t.status === 'pending'),
)
const eliminatedTeams = computed(() =>
  kickoffTeamStatuses.value.filter((t) => t.status === 'eliminated'),
)

// ── 启点赛积分对照表 ──

const POINTS_TABLE = [
  { rank: 1, points: 6, label: '冠军' },
  { rank: 2, points: 5, label: '亚军' },
  { rank: 3, points: 4, label: '季军' },
  { rank: 4, points: 3, label: '第 4 名' },
  { rank: 5, points: 2, label: '第 5-6 名' },
  { rank: 6, points: 2, label: '第 5-6 名' },
  { rank: 7, points: 1, label: '第 7-8 名' },
  { rank: 8, points: 1, label: '第 7-8 名' },
  { rank: 9, points: 0, label: '第 9 名及以后' },
] as const

// ── 赛果编辑 ──

const editingMatch = ref<Match | null>(null)
const editorVisible = ref(false)

function handleMatchClick(matchId: string) {
  if (!editableMatches.value.has(matchId)) return
  const match = store.matches.find((m) => m.matchId === matchId) ?? null
  editingMatch.value = match
  editorVisible.value = true
}

function handleEditorClose() {
  editorVisible.value = false
  editingMatch.value = null
}

function handleEditorSave(scoreA: number, scoreB: number) {
  if (editingMatch.value) {
    updateMatchResult(editingMatch.value.matchId, scoreA, scoreB)
  }
  handleEditorClose()
}

const editorTeamA = computed(() => {
  if (!editingMatch.value) return null
  return store.teams.find((t) => t.teamId === editingMatch.value!.teamA) ?? null
})

const editorTeamB = computed(() => {
  if (!editingMatch.value) return null
  return store.teams.find((t) => t.teamId === editingMatch.value!.teamB) ?? null
})

</script>

<template>
  <div>
    <!-- 页面标题 -->
    <h1 class="page-title">启点赛 · 圣地亚哥大师赛晋级模拟</h1>
    <p class="page-subtitle">
      12 支 VCT CN 联赛队伍通过三败淘汰赛争夺 3 个圣地亚哥大师赛晋级名额。
      实时查看对阵图、晋级状态与积分入账情况。
    </p>

    <!-- 加载状态 -->
    <div v-if="store.loading" class="card card-body mb-6 text-sm text-gray-500">
      数据加载中…
    </div>
    <div v-else-if="store.error" class="card card-body mb-6 text-sm text-red-600">
      {{ store.error }}
    </div>

    <template v-else-if="store.loaded && store.teams.length > 0">
      <!-- 顶部信息栏 -->
      <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div class="card card-body flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <div class="text-xs font-medium uppercase tracking-wide text-gray-500">参赛队伍</div>
            <div class="text-xl font-bold text-gray-900">{{ store.teams.length }} 队</div>
          </div>
        </div>

        <div class="card card-body flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-full bg-green-50 text-green-600">
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <div class="text-xs font-medium uppercase tracking-wide text-gray-500">晋级名额</div>
            <div class="text-xl font-bold text-gray-900">3 队 → 圣地亚哥大师赛</div>
          </div>
        </div>

        <div class="card card-body flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-4-4" />
            </svg>
          </div>
          <div>
            <div class="text-xs font-medium uppercase tracking-wide text-gray-500">赛制</div>
            <div class="text-xl font-bold text-gray-900">三败淘汰</div>
          </div>
        </div>
      </div>

      <!-- 三败淘汰对阵图 -->
      <div class="mb-6">
        <h2 class="mb-3 text-lg font-bold text-gray-900">三败淘汰对阵图</h2>
        <BracketView
          v-if="bracketData"
          :bracket-data="bracketData"
          bracket-type="triple"
          :teams="store.teams"
          @match-click="handleMatchClick"
        />
        <div v-else class="card card-body text-sm text-gray-500">
          暂无对阵数据。
        </div>
      </div>

      <!-- 大师赛晋级名单 -->
      <div class="mb-6">
        <h2 class="mb-3 text-lg font-bold text-gray-900">
          圣地亚哥大师赛晋级名单
          <span class="ml-2 text-sm font-normal text-gray-500">（3 队）</span>
        </h2>
        <div v-if="qualifiedTeams.length > 0" class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div
            v-for="(team, idx) in qualifiedTeams"
            :key="team.teamId"
            class="card card-body flex items-center gap-3 border-green-200 bg-green-50/40"
          >
            <div
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
              :class="{
                'bg-amber-500': idx === 0,
                'bg-gray-400': idx === 1,
                'bg-amber-700': idx === 2,
              }"
            >
              {{ idx + 1 }}
            </div>
            <div class="min-w-0 flex-1">
              <div class="font-semibold text-gray-900">{{ team.teamNameCn }}</div>
              <div class="text-xs text-green-700">
                {{ team.rank ? `第 ${team.rank} 名` : '已晋级' }}
              </div>
            </div>
            <StatusBadge status="qualified" text="已晋级" />
          </div>
        </div>
        <div v-else class="card card-body text-sm text-gray-500">
          尚无队伍锁定晋级名额，比赛仍在进行中。
        </div>
      </div>

      <!-- 晋级状态面板 -->
      <div class="mb-6">
        <h2 class="mb-3 text-lg font-bold text-gray-900">启点赛晋级状态</h2>

        <!-- 已晋级 -->
        <div v-if="qualifiedTeams.length > 0" class="mb-4">
          <h3 class="mb-2 flex items-center gap-2 text-sm font-semibold text-green-700">
            <span class="inline-block h-2 w-2 rounded-full bg-green-500"></span>
            已锁定大师赛名额（{{ qualifiedTeams.length }}）
          </h3>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div
              v-for="team in qualifiedTeams"
              :key="team.teamId"
              class="card card-body flex items-center justify-between border-green-200 bg-green-50/30 py-2"
            >
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium text-gray-900">{{ team.teamNameCn }}</span>
                <StatusBadge status="qualified" />
              </div>
              <span class="text-xs text-gray-500">{{ team.condition }}</span>
            </div>
          </div>
        </div>

        <!-- 待定 -->
        <div v-if="pendingTeams.length > 0" class="mb-4">
          <h3 class="mb-2 flex items-center gap-2 text-sm font-semibold text-yellow-700">
            <span class="inline-block h-2 w-2 rounded-full bg-yellow-500"></span>
            待定（{{ pendingTeams.length }}）
          </h3>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div
              v-for="team in pendingTeams"
              :key="team.teamId"
              class="card card-body flex items-center justify-between border-yellow-200 bg-yellow-50/30 py-2"
            >
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium text-gray-900">{{ team.teamNameCn }}</span>
                <StatusBadge status="pending" />
              </div>
              <span class="text-xs text-gray-500">剩余可败 {{ team.remainingLives }} 场</span>
            </div>
          </div>
        </div>

        <!-- 已淘汰 -->
        <div v-if="eliminatedTeams.length > 0">
          <h3 class="mb-2 flex items-center gap-2 text-sm font-semibold text-red-700">
            <span class="inline-block h-2 w-2 rounded-full bg-red-500"></span>
            已淘汰（{{ eliminatedTeams.length }}）
          </h3>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div
              v-for="team in eliminatedTeams"
              :key="team.teamId"
              class="card card-body flex items-center justify-between border-red-200 bg-red-50/30 py-2"
            >
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium text-gray-900">{{ team.teamNameCn }}</span>
                <StatusBadge status="eliminated" />
              </div>
              <span class="text-xs text-gray-500">{{ team.condition }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 积分入账展示 -->
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <!-- 启点赛名次对应积分表 -->
        <div class="card">
          <div class="card-body">
            <h3 class="mb-3 text-lg font-bold text-gray-900">启点赛名次对应积分</h3>
            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead>
                  <tr class="border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <th class="py-2 pr-2">名次</th>
                    <th class="py-2 pr-2">积分</th>
                    <th class="py-2">说明</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in POINTS_TABLE"
                    :key="row.rank"
                    class="border-b border-gray-100 last:border-0"
                    :class="{
                      'bg-green-50/50': row.rank <= 3,
                    }"
                  >
                    <td class="py-2 pr-2 font-semibold text-gray-900">
                      <span
                        v-if="row.rank <= 3"
                        class="inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold text-white"
                        :class="{
                          'bg-amber-500': row.rank === 1,
                          'bg-gray-400': row.rank === 2,
                          'bg-amber-700': row.rank === 3,
                        }"
                      >
                        {{ row.rank }}
                      </span>
                      <span v-else class="text-gray-500">{{ row.rank }}</span>
                    </td>
                    <td class="py-2 pr-2 font-mono font-bold text-gray-700">{{ row.points }}</td>
                    <td class="py-2 text-xs text-gray-500">{{ row.label }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- 各队启点赛积分入账 -->
        <div class="card">
          <div class="card-body">
            <h3 class="mb-3 text-lg font-bold text-gray-900">各队积分入账</h3>
            <div v-if="kickoffPoints.length > 0" class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead>
                  <tr class="border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <th class="py-2 pr-2">队伍</th>
                    <th class="py-2 pr-2 text-right">启点赛积分</th>
                    <th class="py-2 text-right">全年总积分</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="pt in kickoffPoints"
                    :key="pt.teamId"
                    class="border-b border-gray-100 last:border-0 transition-colors hover:bg-gray-50"
                  >
                    <td class="py-2 pr-2 font-medium text-gray-900">
                      {{ teamMap.get(pt.teamId)?.teamNameCn ?? pt.teamId }}
                    </td>
                    <td class="py-2 pr-2 text-right font-mono font-bold text-gray-700">
                      {{ pt.kickoffPoints || 0 }}
                    </td>
                    <td class="py-2 text-right font-mono text-gray-500">
                      {{ pt.totalPoints || 0 }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="text-sm text-gray-500">暂无积分数据。</div>
          </div>
        </div>
      </div>
    </template>

    <!-- 空状态 -->
    <div v-else class="card card-body text-sm text-gray-500">暂无数据。</div>
  </div>

  <!-- 赛果编辑弹窗 -->
  <MatchEditor
    :match="editingMatch"
    :team-a="editorTeamA"
    :team-b="editorTeamB"
    :visible="editorVisible"
    @close="handleEditorClose"
    @save="handleEditorSave"
  />
</template>