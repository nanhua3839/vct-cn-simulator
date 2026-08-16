<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { store, initData, updateMatchResult, editableMatches } from '@/store'
import { updateEngine } from '@/engine'
import { calculateGroupStandings } from '@/engine/standings'
import type { GroupStanding } from '@/engine/standings'
import { buildDoubleEliminationBracket } from '@/engine/bracket'
import type { BracketMatchNode } from '@/engine/bracket'
import type { TeamWithStanding, BracketData, BracketRound, BracketMatch } from '@/types/bracket'
import type { MatchStatus, Stage, Match } from '@/types/match'
import type { QualifiedStatus } from '@/types/points'
import type { Team } from '@/types/team'
import StandingsTable from '@/components/StandingsTable.vue'
import BracketView from '@/components/BracketView.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import MatchEditor from '@/components/MatchEditor.vue'

// ── 组别定义 ──────────────────────────────────────────────
const S2_GROUP_A = ['NOVA', 'EDG', 'AG', 'WOL', 'DRG', 'FPX']
const S2_GROUP_B = ['BLG', 'TE', 'TYL', 'RNG', 'TEC', 'JDG']

// ── Tab 状态 ─────────────────────────────────────────────
const activeTab = ref(0)
const tabs = ['常规赛', '排位赛', '入围赛', '季后赛']

// ── 队伍名称查询 ────────────────────────────────────────
const teamNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const t of store.teams) {
    map.set(t.teamId, t.teamNameCn)
  }
  return map
})

// ── 计算结果 ─────────────────────────────────────────────
const groupAStandings = ref<TeamWithStanding[]>([])
const groupBStandings = ref<TeamWithStanding[]>([])
const playinsBracket = ref<BracketData | null>(null)
const playoffBracket = ref<BracketData | null>(null)
const championshipQualifiers = ref<{ qualified: string[]; remaining: string[] }>({ qualified: [], remaining: [] })
const engineResult = ref<ReturnType<typeof updateEngine> | null>(null)
const playinsAdvancers = ref<string[]>([])
const playinsEliminated = ref<string[]>([])

// ── 种子顺位 ─────────────────────────────────────────────
interface SeedEntry {
  seed: number
  teamId: string
  teamName: string
  type: 'direct' | 'playins'
}

const seedOrder = computed<SeedEntry[]>(() => {
  const result: SeedEntry[] = []
  let seed = 1

  // 直通队伍（每组前 2）：按组内排名，1-4 号种子
  const directA = groupAStandings.value.filter((s) => s.rank <= 2)
  const directB = groupBStandings.value.filter((s) => s.rank <= 2)

  // 组间交替排序（A组第1、B组第1、A组第2、B组第2）
  const allDirect: { team: TeamWithStanding; group: string }[] = []
  for (const t of directA) allDirect.push({ team: t, group: 'A' })
  for (const t of directB) allDirect.push({ team: t, group: 'B' })
  allDirect.sort((a, b) => {
    if (a.team.rank !== b.team.rank) return a.team.rank - b.team.rank
    return a.group.localeCompare(b.group)
  })

  for (const entry of allDirect) {
    result.push({
      seed: seed++,
      teamId: entry.team.teamId,
      teamName: entry.team.teamNameCn,
      type: 'direct',
    })
  }

  // 入围赛队伍（每组后 4 名）：5-12 号种子
  const playinsA = groupAStandings.value.filter((s) => s.rank > 2)
  const playinsB = groupBStandings.value.filter((s) => s.rank > 2)

  // 按组内排名交替
  const maxLen = Math.max(playinsA.length, playinsB.length)
  const allPlayins: { team: TeamWithStanding; group: string }[] = []
  for (let i = 0; i < maxLen; i++) {
    if (i < playinsA.length) allPlayins.push({ team: playinsA[i], group: 'A' })
    if (i < playinsB.length) allPlayins.push({ team: playinsB[i], group: 'B' })
  }

  for (const entry of allPlayins) {
    result.push({
      seed: seed++,
      teamId: entry.team.teamId,
      teamName: entry.team.teamNameCn,
      type: 'playins',
    })
  }

  return result
})

// ── 入围赛晋级/淘汰队伍 ──────────────────────────────────
function computePlayinsStatus() {
  if (!playinsBracket.value) return

  const advancers: string[] = []
  const eliminated: string[] = []
  const seen = new Set<string>()

  // 遍历所有对阵，收集参赛队伍
  const allRounds = [
    ...playinsBracket.value.winnerBracket,
    ...playinsBracket.value.loserBracket,
  ]
  if (playinsBracket.value.grandFinal) {
    allRounds.push(playinsBracket.value.grandFinal)
  }

  // 收集所有参赛队伍（排除 null）
  for (const round of allRounds) {
    for (const m of round.matches) {
      if (m.teamA && !seen.has(m.teamA) && m.teamA !== 'KBG' && m.teamA !== 'AT') {
        seen.add(m.teamA)
      }
      if (m.teamB && !seen.has(m.teamB) && m.teamB !== 'KBG' && m.teamB !== 'AT') {
        seen.add(m.teamB)
      }
    }
  }

  // 找出晋级队伍（胜者组决赛胜者、败者组决赛胜者、胜者组决赛败者、败者组决赛败者中进入季后赛的）
  // 入围赛前 4 名晋级：胜者组冠军(UB_F胜者)、胜者组亚军(UB_F败者)、败者组冠军(LB_F胜者)、败者组亚军(LB_F败者)
  const ubFinal = playinsBracket.value.winnerBracket[playinsBracket.value.winnerBracket.length - 1]
  const lbRounds = playinsBracket.value.loserBracket
  const lbFinal = lbRounds[lbRounds.length - 1]

  if (ubFinal && ubFinal.matches.length > 0) {
    const m = ubFinal.matches[0]
    if (m.winner) advancers.push(m.winner)
    // 败者也晋级（胜者组亚军）
    const loser = m.teamA === m.winner ? m.teamB : m.teamA
    if (loser && !advancers.includes(loser)) advancers.push(loser)
  }

  if (lbFinal && lbFinal.matches.length > 0) {
    const m = lbFinal.matches[0]
    if (m.winner && !advancers.includes(m.winner)) advancers.push(m.winner)
    // 败者组亚军也晋级
    const loser = m.teamA === m.winner ? m.teamB : m.teamA
    if (loser && !advancers.includes(loser)) advancers.push(loser)
  }

  // 剩余队伍为已淘汰
  for (const tid of seen) {
    if (!advancers.includes(tid)) {
      eliminated.push(tid)
    }
  }

  playinsAdvancers.value = advancers
  playinsEliminated.value = eliminated
}

// ── 对阵数据转换 ─────────────────────────────────────────
function convertEngineBracket(
  engineBracket: ReturnType<typeof buildDoubleEliminationBracket>,
  stage: Stage,
): BracketData {
  const convertRound = (nodes: BracketMatchNode[]): BracketRound => {
    const roundName = nodes.length > 0 ? nodes[0].round : ''
    return {
      roundName,
      matches: nodes.map((n): BracketMatch => ({
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
  }

  const result: BracketData = {
    stage,
    winnerBracket: engineBracket.winnerBracket.map(convertRound),
    loserBracket: engineBracket.loserBracket.map(convertRound),
  }

  if (engineBracket.grandFinal) {
    const gf = engineBracket.grandFinal
    result.grandFinal = {
      roundName: gf.round || 'GF',
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
}

// ── 状态文字映射 ─────────────────────────────────────────
function standingStatus(standing: GroupStanding): QualifiedStatus {
  if (standing.rank <= 2) return 'locked'
  // 后 4 名进入入围赛，仍有晋级机会
  return 'pending'
}

function standingCondition(standing: GroupStanding): string {
  if (standing.rank <= 2) return '已锁定直通季后赛'
  return '进入入围赛，争夺季后赛名额'
}

function mapToTeamWithStanding(
  standing: GroupStanding,
  teams: Team[],
): TeamWithStanding {
  const team = teams.find((t) => t.teamId === standing.teamId)
  return {
    teamId: standing.teamId,
    teamNameCn: team?.teamNameCn ?? standing.teamId,
    wins: standing.wins,
    losses: standing.losses,
    rank: standing.rank,
    status: standingStatus(standing),
    condition: standingCondition(standing),
    theoreticalMinRank: standing.theoreticalMinRank,
    theoreticalMaxRank: standing.theoreticalMaxRank,
  }
}

// ── 计算主逻辑 ───────────────────────────────────────────
function computeAll() {
  if (!store.loaded || store.teams.length === 0) return

  // 1. 常规赛排名
  const groupA = calculateGroupStandings(
    store.matches,
    S2_GROUP_A,
    'stage2_regular' as Stage,
    'Alpha',
    2,
  )
  const groupB = calculateGroupStandings(
    store.matches,
    S2_GROUP_B,
    'stage2_regular' as Stage,
    'Omega',
    2,
  )

  groupAStandings.value = groupA.standings.map((s) =>
    mapToTeamWithStanding(s, store.teams),
  )
  groupBStandings.value = groupB.standings.map((s) =>
    mapToTeamWithStanding(s, store.teams),
  )

  // 2. 入围赛对阵
  const playinsMatches = store.matches.filter(
    (m) => m.stage === 'stage2_playins',
  )
  if (playinsMatches.length > 0) {
    const engineBracket = buildDoubleEliminationBracket(playinsMatches)
    playinsBracket.value = convertEngineBracket(engineBracket, 'stage2_playins')
    computePlayinsStatus()
  }

  // 3. 季后赛对阵
  const playoffMatches = store.matches.filter(
    (m) => m.stage === 'stage2_playoff',
  )
  if (playoffMatches.length > 0) {
    const engineBracket = buildDoubleEliminationBracket(playoffMatches)
    playoffBracket.value = convertEngineBracket(engineBracket, 'stage2_playoff')
  }

  // 4. 冠军赛资格
  const result = updateEngine(store.teams, store.matches, store.points)
  engineResult.value = result
  championshipQualifiers.value = result.championshipQualifiers
}

// ── 生命周期 ─────────────────────────────────────────────
onMounted(() => {
  if (!store.loaded) {
    initData()
  } else {
    computeAll()
  }
})

// 当 store 加载完成后自动计算
watch(
  () => store.loaded,
  (loaded) => {
    if (loaded) computeAll()
  },
)

// 当数据变化时重新计算
watch(
  () => [store.teams, store.matches, store.points],
  () => {
    if (store.loaded) computeAll()
  },
  { deep: true },
)

// ── 辅助函数 ─────────────────────────────────────────────
function getTeamName(teamId: string | null): string {
  if (!teamId) return '待定'
  return teamNameMap.value.get(teamId) ?? teamId
}

// 从 engineResult 中获取积分排名
const sortedPoints = computed(() => {
  return engineResult.value?.sortedPoints ?? []
})

// 冠军赛直通队伍（冠亚军）
const directChampions = computed(() => {
  return championshipQualifiers.value.qualified.slice(0, 2)
})

// 积分顺延队伍
const pointQualifiers = computed(() => {
  return championshipQualifiers.value.qualified.slice(2)
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
    <h1 class="page-title">第二赛段</h1>
    <p class="page-subtitle">
      常规赛（每组前 2 直通季后赛，后 4 名进入入围赛）+ 入围赛（10 队双败，前 4 晋级）+ 季后赛（8 队双败，冠亚军直通上海全球冠军赛）
    </p>

    <!-- 加载状态 -->
    <div
      v-if="store.loading"
      class="card card-body mb-6 text-center text-sm text-gray-500"
    >
      <div class="flex items-center justify-center gap-2">
        <svg class="h-5 w-5 animate-spin text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span>数据加载中...</span>
      </div>
    </div>

    <!-- 错误提示 -->
    <div
      v-if="store.error"
      class="card card-body mb-6 border-red-200 bg-red-50 text-sm text-red-700"
    >
      {{ store.error }}
    </div>

    <!-- Tab 导航 -->
    <div
      v-if="store.loaded"
      class="mb-6 flex flex-wrap gap-1 rounded-xl border border-gray-200 bg-white p-1 shadow-sm"
    >
      <button
        v-for="(tab, index) in tabs"
        :key="index"
        class="rounded-lg px-4 py-2 text-sm font-medium transition-all duration-150"
        :class="{
          'bg-blue-600 text-white shadow-md': activeTab === index,
          'text-gray-600 hover:bg-gray-100 hover:text-gray-900': activeTab !== index,
        }"
        @click="activeTab = index"
      >
        {{ tab }}
      </button>
    </div>

    <!-- ============================================================ -->
    <!-- Tab 1: 常规赛                                                  -->
    <!-- ============================================================ -->
    <div v-if="activeTab === 0 && store.loaded">
      <!-- 赛制说明 -->
      <div class="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <p class="font-medium">赛制说明</p>
        <p class="mt-1 text-blue-600">
          12 支队伍分为 Alpha、Omega 两组进行单循环赛。每组前 2 名直通季后赛（1-4 号种子），
          后 4 名进入入围赛（5-12 号种子）。
        </p>
      </div>

      <!-- 两组并排积分榜 -->
      <div class="grid gap-6 lg:grid-cols-2">
        <StandingsTable
          :teams="groupAStandings"
          title="Alpha 组"
        />
        <StandingsTable
          :teams="groupBStandings"
          title="Omega 组"
        />
      </div>
    </div>

    <!-- ============================================================ -->
    <!-- Tab 2: 排位赛                                                  -->
    <!-- ============================================================ -->
    <div v-if="activeTab === 1 && store.loaded">
      <!-- 说明 -->
      <div class="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <p class="font-medium">种子顺位说明</p>
        <p class="mt-1 text-blue-600">
          1-4 号种子为直通季后赛队伍（每组前 2 名），5-12 号种子为入围赛队伍（每组后 4 名）。
          种子顺位决定入围赛对阵中的轮空权。
        </p>
      </div>

      <!-- 种子顺位表 -->
      <div class="card">
        <div class="card-body">
          <div class="overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead>
                <tr class="border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  <th class="py-2 pr-2">种子顺位</th>
                  <th class="py-2 pr-2">队伍</th>
                  <th class="py-2 pr-2">类别</th>
                  <th class="py-2">说明</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="entry in seedOrder"
                  :key="entry.seed"
                  class="border-b border-gray-100 transition-colors hover:bg-gray-50"
                  :class="{
                    'bg-green-50/50': entry.type === 'direct',
                    'bg-amber-50/30': entry.type === 'playins',
                  }"
                >
                  <td class="py-2 pr-2">
                    <span
                      class="inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold"
                      :class="{
                        'bg-green-100 text-green-700': entry.type === 'direct',
                        'bg-amber-100 text-amber-700': entry.type === 'playins',
                      }"
                    >
                      {{ entry.seed }}
                    </span>
                  </td>
                  <td class="py-2 pr-2 font-medium text-gray-900">
                    {{ entry.teamName }}
                  </td>
                  <td class="py-2 pr-2">
                    <StatusBadge
                      :status="entry.type === 'direct' ? 'locked' : 'pending'"
                      :text="entry.type === 'direct' ? '直通季后赛' : '入围赛'"
                    />
                  </td>
                  <td class="py-2 text-xs text-gray-500">
                    {{ entry.type === 'direct' ? '已锁定季后赛席位' : '需通过入围赛争夺季后赛名额' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- ============================================================ -->
    <!-- Tab 3: 入围赛                                                  -->
    <!-- ============================================================ -->
    <div v-if="activeTab === 2 && store.loaded">
      <!-- 赛制说明 -->
      <div class="mb-4 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <p class="font-medium">入围赛赛制</p>
        <p class="mt-1 text-amber-600">
          10 支队伍进行双败淘汰赛。5-6 号种子轮空进入胜者组第二轮，7-12 号种子从胜者组第一轮开始。
          前 4 名晋级季后赛，获得 5-8 号种子席位。
        </p>
      </div>

      <!-- 对阵图 -->
      <div class="mb-6">
        <BracketView
          v-if="playinsBracket"
          :bracket-data="playinsBracket"
          bracket-type="double"
          :teams="store.teams"
          @match-click="handleMatchClick"
        />
        <div v-else class="card card-body text-center text-sm text-gray-400">
          暂无入围赛数据
        </div>
      </div>

      <!-- 晋级/淘汰队伍 -->
      <div class="grid gap-4 sm:grid-cols-2">
        <!-- 晋级队伍 -->
        <div class="card border-green-200">
          <div class="card-body">
            <h3 class="mb-3 flex items-center gap-2 text-sm font-bold text-green-700">
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
              已晋级季后赛（前 4 名）
            </h3>
            <div v-if="playinsAdvancers.length > 0" class="space-y-1.5">
              <div
                v-for="tid in playinsAdvancers"
                :key="tid"
                class="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm"
              >
                <span class="h-2 w-2 rounded-full bg-green-500"></span>
                <span class="font-medium text-gray-900">{{ getTeamName(tid) }}</span>
                <span class="ml-auto text-xs text-green-600">晋级</span>
              </div>
            </div>
            <p v-else class="text-xs text-gray-400">暂无数据</p>
          </div>
        </div>

        <!-- 淘汰队伍 -->
        <div class="card border-red-200">
          <div class="card-body">
            <h3 class="mb-3 flex items-center gap-2 text-sm font-bold text-red-700">
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
              已淘汰
            </h3>
            <div v-if="playinsEliminated.length > 0" class="space-y-1.5">
              <div
                v-for="tid in playinsEliminated"
                :key="tid"
                class="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm"
              >
                <span class="h-2 w-2 rounded-full bg-red-400"></span>
                <span class="font-medium text-gray-900">{{ getTeamName(tid) }}</span>
                <span class="ml-auto text-xs text-red-500">淘汰</span>
              </div>
            </div>
            <p v-else class="text-xs text-gray-400">暂无数据</p>
          </div>
        </div>
      </div>
    </div>

    <!-- ============================================================ -->
    <!-- Tab 4: 季后赛（年度总决赛）                                     -->
    <!-- ============================================================ -->
    <div v-if="activeTab === 3 && store.loaded">
      <!-- 赛制说明 -->
      <div class="mb-4 rounded-lg border border-purple-100 bg-purple-50 px-4 py-3 text-sm text-purple-800">
        <p class="font-medium">年度总决赛 — 季后赛</p>
        <p class="mt-1 text-purple-600">
          8 支队伍双败淘汰赛。冠亚军直通上海全球冠军赛。
          剩余 2 个全球冠军赛名额按全年冠军赛积分顺延。
        </p>
      </div>

      <!-- 冠军赛名额信息 -->
      <div class="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <!-- 冠军积分 -->
        <div class="card border-amber-200">
          <div class="card-body text-center">
            <div class="text-2xl font-bold text-amber-600">8</div>
            <div class="mt-1 text-xs text-gray-500">冠军积分</div>
          </div>
        </div>
        <!-- 亚军积分 -->
        <div class="card border-gray-200">
          <div class="card-body text-center">
            <div class="text-2xl font-bold text-gray-600">6</div>
            <div class="mt-1 text-xs text-gray-500">亚军积分</div>
          </div>
        </div>
        <!-- 季军积分 -->
        <div class="card border-orange-200">
          <div class="card-body text-center">
            <div class="text-2xl font-bold text-orange-600">5</div>
            <div class="mt-1 text-xs text-gray-500">季军积分</div>
          </div>
        </div>
        <!-- 殿军积分 -->
        <div class="card border-gray-200">
          <div class="card-body text-center">
            <div class="text-2xl font-bold text-gray-600">4</div>
            <div class="mt-1 text-xs text-gray-500">殿军积分</div>
          </div>
        </div>
      </div>

      <!-- 对阵图 -->
      <div class="mb-6">
        <BracketView
          v-if="playoffBracket"
          :bracket-data="playoffBracket"
          bracket-type="double"
          :teams="store.teams"
          @match-click="handleMatchClick"
        />
        <div v-else class="card card-body text-center text-sm text-gray-400">
          暂无季后赛数据
        </div>
      </div>

      <!-- 全球冠军赛名额分配 -->
      <div class="card">
        <div class="card-body">
          <h3 class="mb-3 text-lg font-bold text-gray-900">全球冠军赛名额分配</h3>

          <div class="space-y-3">
            <!-- 直通名额 -->
            <div class="rounded-lg border border-green-200 bg-green-50/50 p-4">
              <h4 class="mb-2 flex items-center gap-2 text-sm font-bold text-green-700">
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
                直通名额 — 季后赛冠亚军
              </h4>
              <div v-if="directChampions.length > 0" class="flex flex-wrap gap-2">
                <span
                  v-for="tid in directChampions"
                  :key="tid"
                  class="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700"
                >
                  <span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
                  {{ getTeamName(tid) }}
                </span>
              </div>
              <p v-else class="text-xs text-gray-400">待定</p>
            </div>

            <!-- 积分顺延名额 -->
            <div class="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
              <h4 class="mb-2 flex items-center gap-2 text-sm font-bold text-blue-700">
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                积分顺延名额 — 全年积分前 2 名（扣除直通队伍后）
              </h4>
              <div v-if="pointQualifiers.length > 0" class="flex flex-wrap gap-2">
                <span
                  v-for="tid in pointQualifiers"
                  :key="tid"
                  class="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700"
                >
                  <span class="h-1.5 w-1.5 rounded-full bg-blue-500"></span>
                  {{ getTeamName(tid) }}
                </span>
              </div>
              <p v-else class="text-xs text-gray-400">待定</p>
            </div>

            <!-- 全年积分排名 -->
            <div v-if="sortedPoints.length > 0" class="mt-4">
              <h4 class="mb-2 text-sm font-semibold text-gray-700">全年积分排名</h4>
              <div class="overflow-x-auto">
                <table class="w-full text-left text-xs">
                  <thead>
                    <tr class="border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-500">
                      <th class="py-1.5 pr-2">#</th>
                      <th class="py-1.5 pr-2">队伍</th>
                      <th class="py-1.5 pr-2 text-right">启点赛</th>
                      <th class="py-1.5 pr-2 text-right">S1常规</th>
                      <th class="py-1.5 pr-2 text-right">S1季后赛</th>
                      <th class="py-1.5 pr-2 text-right">S2常规</th>
                      <th class="py-1.5 pr-2 text-right">S2季后赛</th>
                      <th class="py-1.5 pr-2 text-right">大师赛</th>
                      <th class="py-1.5 pr-2 text-right font-bold">总分</th>
                      <th class="py-1.5 pr-2">冠军赛</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="(p, i) in sortedPoints"
                      :key="p.teamId"
                      class="border-b border-gray-100"
                      :class="{
                        'bg-green-50/50': championshipQualifiers.qualified.includes(p.teamId),
                      }"
                    >
                      <td class="py-1.5 pr-2 font-bold text-gray-600">{{ i + 1 }}</td>
                      <td class="py-1.5 pr-2 font-medium text-gray-900">{{ getTeamName(p.teamId) }}</td>
                      <td class="py-1.5 pr-2 text-right font-mono text-gray-600">{{ p.kickoffPoints }}</td>
                      <td class="py-1.5 pr-2 text-right font-mono text-gray-600">{{ p.stage1RegularPoints }}</td>
                      <td class="py-1.5 pr-2 text-right font-mono text-gray-600">{{ p.stage1PlayoffPoints }}</td>
                      <td class="py-1.5 pr-2 text-right font-mono text-gray-600">{{ p.stage2RegularPoints }}</td>
                      <td class="py-1.5 pr-2 text-right font-mono text-gray-600">{{ p.stage2PlayoffPoints }}</td>
                      <td class="py-1.5 pr-2 text-right font-mono text-gray-600">{{ p.mastersPoints }}</td>
                      <td class="py-1.5 pr-2 text-right font-mono font-bold text-gray-900">{{ p.totalPoints }}</td>
                      <td class="py-1.5 pr-2">
                        <StatusBadge
                          v-if="championshipQualifiers.qualified.includes(p.teamId)"
                          status="qualified"
                          text="已晋级"
                        />
                        <span v-else class="text-gray-400">—</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
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