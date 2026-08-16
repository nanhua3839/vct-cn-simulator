/**
 * 晋级计算引擎入口
 *
 * 重新导出所有模块的公共函数，并提供 updateEngine 统一入口。
 */

// ── standings ──
export {
  calculateGroupStandings,
} from './standings'
export type {
  GroupStanding,
  GroupStandingsResult,
} from './standings'

// ── bracket ──
export {
  buildDoubleEliminationBracket,
  calculateBracketStatus,
  buildTripleEliminationBracket,
  calculateRemainingLives,
} from './bracket'
export type {
  BracketMatchNode,
  BracketData,
  TripleEliminationBracketData,
  TeamBracketStatus,
} from './bracket'

// ── points ──
export {
  calculatePoints,
  sortByPoints,
  determineChampionshipQualifiers,
} from './points'

// ── status ──
export {
  calculateGlobalStatus,
} from './status'
export type {
  GlobalTeamStatus,
} from './status'

// ── 统一入口 ──

import type { Team } from '@/types/team'
import type { Match } from '@/types/match'
import type { TeamPoints } from '@/types/points'
import { calculatePoints, sortByPoints, determineChampionshipQualifiers } from './points'
import { calculateGlobalStatus } from './status'
import type { GlobalTeamStatus } from './status'

/** 引擎计算结果汇总 */
export interface EngineResult {
  /** 重新计算的各队积分 */
  points: TeamPoints[]
  /** 按积分排序后的队伍列表 */
  sortedPoints: TeamPoints[]
  /** 全球冠军赛名额分配 */
  championshipQualifiers: {
    qualified: string[]
    remaining: string[]
  }
  /** 各队全局晋级状态 */
  globalStatus: GlobalTeamStatus[]
}

/**
 * 统一引擎入口：根据当前 teams / matches / points 数据，运行全部计算并返回结果。
 *
 * @param teams 队伍列表
 * @param matches 全年比赛列表
 * @param points 当前积分数据
 * @returns 所有计算结果
 */
export function updateEngine(
  teams: Team[],
  matches: Match[],
  points: TeamPoints[],
): EngineResult {
  // 1. 重新计算积分
  const recalculatedPoints = calculatePoints(teams, matches, points)

  // 2. 按积分排序
  const sortedPoints = sortByPoints(recalculatedPoints, matches)

  // 3. 判定全球冠军赛名额
  const championshipQualifiers = determineChampionshipQualifiers(
    sortedPoints,
    matches,
  )

  // 4. 更新各队晋级状态
  // 将冠军赛直通信息回写到 points 中
  const updatedPoints = sortedPoints.map((p) => {
    const isQualified = championshipQualifiers.qualified.includes(p.teamId)
    return {
      ...p,
      qualifiedStatus: isQualified
        ? ('qualified' as const)
        : ('pending' as const),
    }
  })

  // 5. 计算全局晋级状态
  const globalStatus = calculateGlobalStatus(teams, matches, updatedPoints)

  return {
    points: recalculatedPoints,
    sortedPoints: updatedPoints,
    championshipQualifiers,
    globalStatus,
  }
}