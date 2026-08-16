import { reactive, computed } from 'vue'
import type { Team } from '@/types/team'
import type { Match } from '@/types/match'
import type { TeamPoints } from '@/types/points'
import { loadAllData } from '@/services/dataService'
import { exampleMatches } from '@/data/exampleData'

/**
 * 全局应用状态（简单 reactive store，Task 12 起支持赛果手动模拟后，
 * 可在本地覆盖 matches 并在计算引擎中触发重算）。
 */
interface AppState {
  teams: Team[]
  matches: Match[]
  points: TeamPoints[]
  loading: boolean
  loaded: boolean
  error: string
  /** 是否处于模拟模式 */
  isSimulated: boolean
}

export const store = reactive<AppState>({
  teams: [],
  matches: [],
  points: [],
  loading: false,
  loaded: false,
  error: '',
  isSimulated: false,
})

/** 原始比赛数据的深拷贝，用于 resetMatches 恢复 */
let originalMatches: Match[] = []

/** 从 JSON（或内置示例数据回退）加载全部数据 */
export async function initData(): Promise<void> {
  if (store.loaded || store.loading) return
  store.loading = true
  store.error = ''
  try {
    const data = await loadAllData()
    store.teams = data.teams
    store.matches = data.matches
    store.points = data.points
    store.loaded = true
    // 保存原始数据快照以供重置
    originalMatches = JSON.parse(JSON.stringify(data.matches))
  } catch (err) {
    store.error = err instanceof Error ? err.message : String(err)
  } finally {
    store.loading = false
  }
}

/**
 * 更新某场比赛的比分，自动计算 winner，标记为 finished。
 * 触发引擎重算（通过 reactive 响应式传播）。
 */
export function updateMatchResult(
  matchId: string,
  scoreA: number,
  scoreB: number,
): void {
  const match = store.matches.find((m) => m.matchId === matchId)
  if (!match) {
    console.warn(`[store] 未找到比赛: ${matchId}`)
    return
  }
  match.scoreA = scoreA
  match.scoreB = scoreB
  match.winner =
    scoreA > scoreB
      ? match.teamA
      : scoreB > scoreA
        ? match.teamB
        : match.winner
  match.status = 'finished'
}

/**
 * 恢复所有比赛到初始状态（从示例数据重新加载）。
 */
export function resetMatches(): void {
  if (originalMatches.length === 0) {
    // 如果尚未从 initData 保存，直接从 exampleData 加载
    originalMatches = JSON.parse(JSON.stringify(exampleMatches))
  }
  store.matches = JSON.parse(JSON.stringify(originalMatches))
  store.isSimulated = false
}

/**
 * 可编辑的比赛 ID 集合。
 * 默认包含所有 upcoming 比赛；模拟模式下包含所有比赛。
 */
export const editableMatches = computed<Set<string>>(() => {
  if (store.isSimulated) {
    return new Set(store.matches.map((m) => m.matchId))
  }
  return new Set(
    store.matches
      .filter((m) => m.status === 'upcoming')
      .map((m) => m.matchId),
  )
})