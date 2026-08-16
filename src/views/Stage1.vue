<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { store, initData, updateMatchResult, editableMatches } from '@/store'
import { calculateGroupStandings, buildDoubleEliminationBracket } from '@/engine'
import type { TeamWithStanding, BracketData, BracketRound } from '@/types/bracket'
import type { MatchStatus, Match } from '@/types/match'
import type { Team } from '@/types/team'
import type { GroupStanding } from '@/engine'
import type { BracketData as EngineBracketData, BracketMatchNode } from '@/engine'
import StandingsTable from '@/components/StandingsTable.vue'
import BracketView from '@/components/BracketView.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import MatchEditor from '@/components/MatchEditor.vue'

// ── 分组定义 ──────────────────────────────────────────────
const S1_ALPHA = ['EDG', 'BLG', 'AG', 'RNG', 'TYL', 'WOL']
const S1_OMEGA = ['TE', 'FPX', 'TEC', 'NOVA', 'DRG', 'JDG']

// ── Tab 状态 ──────────────────────────────────────────────
const activeTab = ref<'regular' | 'seeding' | 'playoff'>('regular')
const tabs = [
  { key: 'regular' as const, label: '常规赛' },
  { key: 'seeding' as const, label: '排位赛' },
  { key: 'playoff' as const, label: '季后赛' },
]

// ── 数据加载 ──────────────────────────────────────────────
const loading = ref(true)

onMounted(() => {
  if (!store.loaded) {
    initData().finally(() => {
      loading.value = false
    })
  } else {
    loading.value = false
  }
})

watch(() => store.loaded, (val) => {
  if (val) loading.value = false
})

// ── 队伍查找映射 ────────────────────────────────────────
const teamMap = computed(() => {
  const map = new Map<string, Team>()
  for (const t of store.teams) {
    map.set(t.teamId, t)
  }
  return map
})

// ── 工具：将 GroupStanding 转换为 TeamWithStanding ──────
function toTeamWithStanding(gs: GroupStanding): TeamWithStanding {
  const team = teamMap.value.get(gs.teamId)
  return {
    teamId: gs.teamId,
    teamNameCn: team?.teamNameCn ?? gs.teamId,
    wins: gs.wins,
    losses: gs.losses,
    rank: gs.rank,
    status: gs.status,
    condition: gs.qualificationCondition,
    theoreticalMinRank: gs.theoreticalMinRank,
    theoreticalMaxRank: gs.theoreticalMaxRank,
  }
}

// ── 常规赛排名 ──────────────────────────────────────────
const alphaStandings = computed<TeamWithStanding[]>(() => {
  if (!store.loaded) return []
  const result = calculateGroupStandings(
    store.matches,
    S1_ALPHA,
    'stage1_regular' as const,
    'Alpha',
    4,
  )
  return result.standings.map(toTeamWithStanding)
})

const omegaStandings = computed<TeamWithStanding[]>(() => {
  if (!store.loaded) return []
  const result = calculateGroupStandings(
    store.matches,
    S1_OMEGA,
    'stage1_regular' as const,
    'Omega',
    4,
  )
  return result.standings.map(toTeamWithStanding)
})

// ── 季后赛对阵树 ────────────────────────────────────────
/** 将 engine 的 BracketData 转换为 types 的 BracketData */
function toBracketViewData(ed: EngineBracketData): BracketData {
  const convertRound = (nodes: BracketMatchNode[]): BracketRound => ({
    roundName: nodes[0]?.round ?? '',
    matches: nodes.map((n) => ({
      matchId: n.matchId,
      round: n.round,
      teamA: n.teamA,
      teamB: n.teamB,
      scoreA: n.scoreA,
      scoreB: n.scoreB,
      winner: n.winner,
      status: n.status as MatchStatus,
      seedA: undefined,
      seedB: undefined,
    })),
  })

  const bracketViewData: BracketData = {
    stage: ed.stage,
    winnerBracket: ed.winnerBracket.map(convertRound),
    loserBracket: ed.loserBracket.map(convertRound),
  }

  if (ed.grandFinal) {
    const gf = ed.grandFinal
    bracketViewData.grandFinal = {
      roundName: gf.round,
      matches: [{
        matchId: gf.matchId,
        round: gf.round,
        teamA: gf.teamA,
        teamB: gf.teamB,
        scoreA: gf.scoreA,
        scoreB: gf.scoreB,
        winner: gf.winner,
        status: gf.status as MatchStatus,
      }],
    }
  }

  return bracketViewData
}

const playoffBracket = computed<BracketData | null>(() => {
  if (!store.loaded) return null
  const playoffMatches = store.matches.filter((m) => m.stage === 'stage1_playoff')
  if (playoffMatches.length === 0) return null
  const engineData = buildDoubleEliminationBracket(playoffMatches)
  return toBracketViewData(engineData)
})

// ── 季后赛排名 & 伦敦大师赛资格 ─────────────────────────
interface PlayoffRank {
  teamId: string
  teamName: string
  rank: number
  points: number
}

const S1_PLAYOFF_POINTS_MAP: Record<number, number> = {
  1: 6,
  2: 4,
  3: 3,
  4: 2,
}

function determinePlayoffRankings(): PlayoffRank[] {
  if (!store.loaded) return []

  const playoffMatches = store.matches.filter((m) => m.stage === 'stage1_playoff')

  // 查找总决赛
  const gf = playoffMatches.find((m) => m.round === 'GF')
  // 查找败者组决赛
  const lbFinal = playoffMatches.find((m) => m.round === 'LB_F')

  const teamRank = new Map<string, number>()

  if (gf && gf.status === 'finished' && gf.winner && gf.teamA && gf.teamB) {
    teamRank.set(gf.winner, 1)
    const runnerUp = gf.winner === gf.teamA ? gf.teamB : gf.teamA
    teamRank.set(runnerUp, 2)
  }

  if (lbFinal && lbFinal.status === 'finished' && lbFinal.teamA && lbFinal.teamB) {
    if (lbFinal.winner) {
      const third = lbFinal.winner === lbFinal.teamA ? lbFinal.teamB : lbFinal.teamA
      if (!teamRank.has(third)) {
        teamRank.set(third, 3)
      }
    }
  }

  // 为剩余队伍分配排名
  const processed = new Set<string>()
  const eliminatedOrder: string[] = []

  const lbRounds = playoffMatches
    .filter((m) => m.round.startsWith('LB_') || m.round.startsWith('L'))
    .sort((a, b) => {
      const aNum = parseInt(a.round.replace(/[^0-9]/g, '')) || 0
      const bNum = parseInt(b.round.replace(/[^0-9]/g, '')) || 0
      return bNum - aNum
    })

  for (const m of lbRounds) {
    if (m.status !== 'finished' || !m.winner || !m.teamA || !m.teamB) continue
    const loser = m.winner === m.teamA ? m.teamB : m.teamA
    if (!processed.has(loser) && !teamRank.has(loser)) {
      eliminatedOrder.push(loser)
      processed.add(loser)
    }
  }

  const ubRounds = playoffMatches.filter((m) => m.round.startsWith('UB_'))
  for (const m of ubRounds) {
    if (m.status !== 'finished' || !m.winner || !m.teamA || !m.teamB) continue
    const loser = m.winner === m.teamA ? m.teamB : m.teamA
    if (!processed.has(loser) && !teamRank.has(loser)) {
      eliminatedOrder.push(loser)
      processed.add(loser)
    }
  }

  let nextRank = 4
  for (const tid of eliminatedOrder) {
    if (!teamRank.has(tid)) {
      teamRank.set(tid, nextRank)
      nextRank++
    }
  }

  // 收集所有参与队伍
  const allTeams = new Set<string>()
  for (const m of playoffMatches) {
    if (m.teamA) allTeams.add(m.teamA)
    if (m.teamB) allTeams.add(m.teamB)
  }
  for (const tid of allTeams) {
    if (!teamRank.has(tid)) {
      teamRank.set(tid, nextRank++)
    }
  }

  // 构建结果
  const result: PlayoffRank[] = []
  for (const [tid, rank] of teamRank) {
    const team = teamMap.value.get(tid)
    const pts = S1_PLAYOFF_POINTS_MAP[rank] ?? 0
    result.push({
      teamId: tid,
      teamName: team?.teamNameCn ?? tid,
      rank,
      points: pts,
    })
  }

  return result.sort((a, b) => a.rank - b.rank)
}

const playoffRankings = computed<PlayoffRank[]>(() => determinePlayoffRankings())

const londonQualifiers = computed<PlayoffRank[]>(() =>
  playoffRankings.value.filter((p) => p.rank <= 3),
)

// ── 排位赛种子信息 ──────────────────────────────────────
interface SeedInfo {
  seed: number
  teamId: string
  teamName: string
  groupName: string
  groupRank: number
}

const seedList = computed<SeedInfo[]>(() => {
  if (!store.loaded) return []

  // 获取常规赛排名前 4 的队伍
  const alphaResult = calculateGroupStandings(
    store.matches,
    S1_ALPHA,
    'stage1_regular' as const,
    'Alpha',
    4,
  )
  const omegaResult = calculateGroupStandings(
    store.matches,
    S1_OMEGA,
    'stage1_regular' as const,
    'Omega',
    4,
  )

  const alphaTop4 = alphaResult.standings.filter((s) => s.rank <= 4)
  const omegaTop4 = omegaResult.standings.filter((s) => s.rank <= 4)

  // 按组内排名交替排序（交叉种子）
  const seeds: SeedInfo[] = []
  const maxLen = Math.max(alphaTop4.length, omegaTop4.length)

  for (let i = 0; i < maxLen; i++) {
    const aIdx = alphaTop4.findIndex((s) => s.rank === i + 1)
    const oIdx = omegaTop4.findIndex((s) => s.rank === i + 1)

    if (aIdx !== -1) {
      const s = alphaTop4[aIdx]
      const team = teamMap.value.get(s.teamId)
      seeds.push({
        seed: seeds.length + 1,
        teamId: s.teamId,
        teamName: team?.teamNameCn ?? s.teamId,
        groupName: 'Alpha',
        groupRank: s.rank,
      })
    }
    if (oIdx !== -1) {
      const s = omegaTop4[oIdx]
      const team = teamMap.value.get(s.teamId)
      seeds.push({
        seed: seeds.length + 1,
        teamId: s.teamId,
        teamName: team?.teamNameCn ?? s.teamId,
        groupName: 'Omega',
        groupRank: s.rank,
      })
    }
  }

  return seeds
})

// ── 排位赛对阵（季后赛 quarterfinal 作为种子顺位对决） ──
interface SeedingMatchup {
  matchId: string
  alphaTeam: string
  alphaName: string
  omegaTeam: string
  omegaName: string
  scoreA: number
  scoreB: number
  winner: string | null
  status: string
  alphaSeed: number
  omegaSeed: number
}

const seedingMatchups = computed<SeedingMatchup[]>(() => {
  if (!store.loaded) return []

  // 从季后赛 bracket 中获取 quarterfinal 比赛
  const playoffMatches = store.matches.filter((m) => m.stage === 'stage1_playoff')
  const qfMatches = playoffMatches.filter(
    (m) => m.round === 'UB_Q1' || m.round === 'UB_Q2' || m.round === 'UB_Q3' || m.round === 'UB_Q4',
  )

  return qfMatches.map((m) => {
    const alphaTeam = m.teamA ?? ''
    const omegaTeam = m.teamB ?? ''
    const alphaIsAlpha = S1_ALPHA.includes(alphaTeam)
    const omegaIsAlpha = S1_OMEGA.includes(omegaTeam)

    return {
      matchId: m.matchId,
      alphaTeam: alphaIsAlpha ? alphaTeam : omegaTeam,
      alphaName: teamMap.value.get(alphaIsAlpha ? alphaTeam : omegaTeam)?.teamNameCn ?? (alphaIsAlpha ? alphaTeam : omegaTeam),
      omegaTeam: omegaIsAlpha ? omegaTeam : alphaTeam,
      omegaName: teamMap.value.get(omegaIsAlpha ? omegaTeam : alphaTeam)?.teamNameCn ?? (omegaIsAlpha ? omegaTeam : alphaTeam),
      scoreA: alphaIsAlpha ? m.scoreA : m.scoreB,
      scoreB: omegaIsAlpha ? m.scoreB : m.scoreA,
      winner: alphaIsAlpha ? m.winner : (m.winner ? (m.winner === m.teamA ? m.teamB : m.teamA) : null),
      status: m.status,
      alphaSeed: 0,
      omegaSeed: 0,
    }
  })
})

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
    <h1 class="page-title">第一赛段</h1>
    <p class="page-subtitle">
      常规赛（Alpha / Omega 两组单循环，每组前 4 进季后赛）+ 排位赛 + 季后赛（8 队双败淘汰），前 3 名晋级伦敦大师赛。
    </p>

    <!-- Loading state -->
    <div v-if="loading" class="card card-body text-center text-gray-500 py-8">
      <p>正在加载数据...</p>
    </div>

    <template v-else>
      <!-- Tab 导航 -->
      <div class="mb-6 flex gap-1 rounded-xl border border-gray-200 bg-gray-100 p-1">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all"
          :class="{
            'bg-white text-gray-900 shadow-sm': activeTab === tab.key,
            'text-gray-500 hover:text-gray-700': activeTab !== tab.key,
          }"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- ════════════════════════════════════════════════════ -->
      <!-- Tab 1: 常规赛 -->
      <!-- ════════════════════════════════════════════════════ -->
      <div v-if="activeTab === 'regular'" class="space-y-6">
        <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <StandingsTable :teams="alphaStandings" title="Alpha 组" />
          <StandingsTable :teams="omegaStandings" title="Omega 组" />
        </div>

        <!-- 晋级说明 -->
        <div class="card card-body">
          <h3 class="mb-2 text-sm font-bold text-gray-900">晋级规则</h3>
          <p class="text-xs text-gray-600">
            每组前 4 名晋级季后赛。若同胜场，按胜负关系及小分决定排名。
            每组第 5-6 名直接淘汰，结束第一赛段征程。
          </p>
        </div>
      </div>

      <!-- ════════════════════════════════════════════════════ -->
      <!-- Tab 2: 排位赛 -->
      <!-- ════════════════════════════════════════════════════ -->
      <div v-if="activeTab === 'seeding'" class="space-y-6">
        <!-- 常规赛排名回顾 -->
        <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <StandingsTable :teams="alphaStandings" title="Alpha 组常规赛" />
          <StandingsTable :teams="omegaStandings" title="Omega 组常规赛" />
        </div>

        <!-- 种子顺位列表 -->
        <div class="card">
          <div class="card-body">
            <h3 class="mb-3 text-lg font-bold text-gray-900">季后赛种子顺位</h3>
            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead>
                  <tr class="border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <th class="py-2 pr-2">种子顺位</th>
                    <th class="py-2 pr-2">队伍</th>
                    <th class="py-2 pr-2">所属组别</th>
                    <th class="py-2">组内排名</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="seed in seedList"
                    :key="seed.seed"
                    class="border-b border-gray-100 transition-colors hover:bg-gray-50"
                  >
                    <td class="py-2 pr-2">
                      <span
                        class="inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold"
                        :class="{
                          'bg-amber-100 text-amber-800': seed.seed <= 2,
                          'bg-blue-50 text-blue-700': seed.seed > 2 && seed.seed <= 4,
                          'bg-gray-100 text-gray-600': seed.seed > 4,
                        }"
                      >
                        #{{ seed.seed }}
                      </span>
                    </td>
                    <td class="py-2 pr-2 font-medium text-gray-900">{{ seed.teamName }}</td>
                    <td class="py-2 pr-2 text-gray-600">{{ seed.groupName }}</td>
                    <td class="py-2 text-gray-600">第 {{ seed.groupRank }} 名</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- 同名次 BO3 对决 -->
        <div class="card">
          <div class="card-body">
            <h3 class="mb-3 text-lg font-bold text-gray-900">同名次队伍 BO3 对决</h3>
            <p class="mb-4 text-xs text-gray-500">
              两组同名次队伍在季后赛首轮进行 BO3 对决，胜者进入胜者组第二轮，败者进入败者组。
            </p>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div
                v-for="mu in seedingMatchups"
                :key="mu.matchId"
                class="rounded-lg border border-gray-200 bg-gray-50 p-3"
              >
                <div class="mb-1 text-xs font-medium text-gray-500">
                  {{ mu.matchId }}
                </div>
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="inline-block h-2 w-2 rounded-full bg-blue-500"></span>
                    <span
                      class="text-sm font-medium"
                      :class="{ 'font-bold text-green-700': mu.winner === mu.alphaTeam }"
                    >
                      {{ mu.alphaName }}
                    </span>
                    <span class="text-xs text-gray-400">(Alpha)</span>
                  </div>
                  <span class="font-mono text-sm font-bold">
                    {{ mu.scoreA }} : {{ mu.scoreB }}
                  </span>
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-gray-400">(Omega)</span>
                    <span
                      class="text-sm font-medium"
                      :class="{ 'font-bold text-green-700': mu.winner === mu.omegaTeam }"
                    >
                      {{ mu.omegaName }}
                    </span>
                    <span class="inline-block h-2 w-2 rounded-full bg-orange-500"></span>
                  </div>
                </div>
                <div class="mt-2 text-xs text-gray-500">
                  <StatusBadge
                    :status="mu.status === 'finished' ? 'locked' : 'pending'"
                    :text="mu.status === 'finished' ? '已结束' : '未开始'"
                  />
                  <span v-if="mu.winner" class="ml-2">
                    胜者：{{ mu.winner === mu.alphaTeam ? mu.alphaName : mu.omegaName }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ════════════════════════════════════════════════════ -->
      <!-- Tab 3: 季后赛 -->
      <!-- ════════════════════════════════════════════════════ -->
      <div v-if="activeTab === 'playoff'" class="space-y-6">
        <!-- 双败对阵图 -->
        <div class="card">
          <div class="card-body">
            <h3 class="mb-3 text-lg font-bold text-gray-900">双败淘汰对阵图</h3>
            <BracketView
              v-if="playoffBracket"
              :bracket-data="playoffBracket"
              bracket-type="double"
              :teams="store.teams"
              @match-click="handleMatchClick"
            />
            <p v-else class="text-sm text-gray-500">暂无季后赛数据</p>
          </div>
        </div>

        <!-- 季后赛最终排名 -->
        <div class="card">
          <div class="card-body">
            <h3 class="mb-3 text-lg font-bold text-gray-900">季后赛最终排名</h3>
            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead>
                  <tr class="border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <th class="py-2 pr-2">排名</th>
                    <th class="py-2 pr-2">队伍</th>
                    <th class="py-2 pr-2">积分入账</th>
                    <th class="py-2">伦敦大师赛</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="pr in playoffRankings"
                    :key="pr.teamId"
                    class="border-b border-gray-100 transition-colors hover:bg-gray-50"
                    :class="{
                      'bg-green-50/50': pr.rank <= 3,
                      'bg-amber-50/30': pr.rank === 1,
                    }"
                  >
                    <td class="py-2 pr-2">
                      <span
                        class="inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold"
                        :class="{
                          'bg-amber-100 text-amber-800': pr.rank === 1,
                          'bg-gray-200 text-gray-700': pr.rank === 2,
                          'bg-orange-100 text-orange-800': pr.rank === 3,
                          'bg-gray-100 text-gray-500': pr.rank > 3,
                        }"
                      >
                        {{ pr.rank }}
                      </span>
                    </td>
                    <td class="py-2 pr-2 font-medium text-gray-900">{{ pr.teamName }}</td>
                    <td class="py-2 pr-2">
                      <span
                        class="inline-block rounded-full px-2 py-0.5 text-xs font-semibold"
                        :class="{
                          'bg-green-100 text-green-800': pr.points > 0,
                          'bg-gray-100 text-gray-500': pr.points === 0,
                        }"
                      >
                        {{ pr.points > 0 ? `+${pr.points} 分` : '0 分' }}
                      </span>
                    </td>
                    <td class="py-2">
                      <StatusBadge
                        v-if="pr.rank <= 3"
                        status="qualified"
                        text="晋级"
                      />
                      <span v-else class="text-xs text-gray-400">—</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- 伦敦大师赛资格 -->
        <div class="card">
          <div class="card-body">
            <h3 class="mb-3 text-lg font-bold text-gray-900">🏆 晋级伦敦大师赛</h3>
            <div class="flex flex-wrap gap-4">
              <div
                v-for="(q, i) in londonQualifiers"
                :key="q.teamId"
                class="flex items-center gap-3 rounded-xl border p-4"
                :class="{
                  'border-amber-300 bg-amber-50': i === 0,
                  'border-gray-200 bg-gray-50': i > 0,
                }"
              >
                <span
                  class="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold"
                  :class="{
                    'bg-amber-400 text-white': i === 0,
                    'bg-gray-300 text-white': i === 1,
                    'bg-orange-300 text-white': i === 2,
                  }"
                >
                  {{ i + 1 }}
                </span>
                <div>
                  <div class="font-semibold text-gray-900">{{ q.teamName }}</div>
                  <div class="text-xs text-gray-500">
                    第 {{ q.rank }} 名 · 积分 +{{ q.points }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 积分对照 -->
        <div class="card card-body">
          <h3 class="mb-2 text-sm font-bold text-gray-900">第一赛段季后赛积分入账规则</h3>
          <div class="grid grid-cols-2 gap-2 text-xs text-gray-600 sm:grid-cols-4">
            <div class="rounded-lg bg-amber-50 p-2 text-center">
              <span class="block text-lg font-bold text-amber-800">6</span>
              <span>冠军</span>
            </div>
            <div class="rounded-lg bg-gray-100 p-2 text-center">
              <span class="block text-lg font-bold text-gray-700">4</span>
              <span>亚军</span>
            </div>
            <div class="rounded-lg bg-orange-50 p-2 text-center">
              <span class="block text-lg font-bold text-orange-700">3</span>
              <span>季军</span>
            </div>
            <div class="rounded-lg bg-gray-100 p-2 text-center">
              <span class="block text-lg font-bold text-gray-700">2</span>
              <span>殿军</span>
            </div>
          </div>
        </div>
      </div>
    </template>
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