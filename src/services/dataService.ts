import type { Team } from '@/types/team'
import type { Match } from '@/types/match'
import type { TeamPoints } from '@/types/points'
import { exampleTeams, exampleMatches, examplePoints } from '@/data/exampleData'

/**
 * 数据加载服务：
 * - 通过 fetch 加载 public/data/ 下的标准 JSON（生产环境由 GitHub Actions 脚本更新）
 * - 带内存缓存，避免重复请求
 * - 加载失败时回退到内置示例数据对象，保证离线可用
 */

const cache = new Map<string, unknown>()

async function fetchJson<T>(path: string, fallback: T): Promise<T> {
  if (cache.has(path)) return cache.get(path) as T
  try {
    const res = await fetch(path)
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    const data = (await res.json()) as T
    cache.set(path, data)
    return data
  } catch (err) {
    console.warn(`[dataService] 加载 ${path} 失败，回退到内置示例数据：`, err)
    return fallback
  }
}

const base = import.meta.env.BASE_URL

export function loadTeams(): Promise<Team[]> {
  return fetchJson<Team[]>(`${base}data/teams.json`, exampleTeams)
}

export function loadMatches(): Promise<Match[]> {
  return fetchJson<Match[]>(`${base}data/matches.json`, exampleMatches)
}

export function loadPoints(): Promise<TeamPoints[]> {
  return fetchJson<TeamPoints[]>(`${base}data/points.json`, examplePoints)
}

export interface AllData {
  teams: Team[]
  matches: Match[]
  points: TeamPoints[]
}

/** 并行加载全部数据 */
export async function loadAllData(): Promise<AllData> {
  const [teams, matches, points] = await Promise.all([loadTeams(), loadMatches(), loadPoints()])
  return { teams, matches, points }
}
