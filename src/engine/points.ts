/**
 * 冠军赛积分计算器
 *
 * 提供：
 * - calculatePoints：根据各阶段比赛结果重新计算所有队伍积分
 * - sortByPoints：按总积分降序排序（含同分规则）
 * - determineChampionshipQualifiers：判定全球冠军赛 CN 赛区 4 个名额
 */

import type { Team } from '@/types/team'
import type { Match, Stage } from '@/types/match'
import type { TeamPoints, QualifiedStatus } from '@/types/points'

// ──────────────────────────────────────────
// 积分对照表
// ──────────────────────────────────────────

/** 启点赛名次→积分 */
const KICKOFF_POINTS: Record<number, number> = {
  1: 6,
  2: 5,
  3: 4,
  4: 3,
  5: 2,
  6: 2,
  7: 1,
  8: 1,
}

/** 第一赛段季后赛名次→积分 */
const S1_PLAYOFF_POINTS: Record<number, number> = {
  1: 6,
  2: 4,
  3: 3,
  4: 2,
}

/** 第二赛段季后赛名次→积分 */
const S2_PLAYOFF_POINTS: Record<number, number> = {
  1: 8,
  2: 6,
  3: 5,
  4: 4,
}

// ──────────────────────────────────────────
// 辅助函数
// ──────────────────────────────────────────

/**
 * 筛选指定阶段的比赛
 */
function filterStage(matches: Match[], stage: Stage): Match[] {
  return matches.filter((m) => m.stage === stage)
}

/**
 * 统计某队在常规赛中的胜场数
 */
function countRegularWins(matches: Match[], teamId: string): number {
  let wins = 0
  for (const m of matches) {
    if (!m.teamA || !m.teamB) continue
    if (m.status !== 'finished' || !m.winner) continue
    if (
      (m.teamA === teamId || m.teamB === teamId) &&
      m.winner === teamId
    ) {
      wins++
    }
  }
  return wins
}

/**
 * 从双败淘汰赛的比赛中推算每队排名
 * 返回 Map<teamId, rank>
 */
function determinePlayoffRanking(
  matches: Match[],
  stage: Stage,
  _pointsMap: Record<number, number>,
): Map<string, number> {
  const stageMatches = filterStage(matches, stage)
  const teamRank = new Map<string, number>()

  // 收集所有参与队伍
  const teams = new Set<string>()
  for (const m of stageMatches) {
    if (m.teamA) teams.add(m.teamA)
    if (m.teamB) teams.add(m.teamB)
  }

  // 查找总决赛
  const gf = stageMatches.find((m) => m.round === 'GF')
  // 查找败者组决赛
  const lbFinal = stageMatches.find((m) => m.round === 'LB_F')

  if (gf && gf.status === 'finished' && gf.winner && gf.teamA && gf.teamB) {
    // 冠军 = GF 胜者
    teamRank.set(gf.winner, 1)
    // 亚军 = GF 败者
    const runnerUp = gf.winner === gf.teamA ? gf.teamB : gf.teamA
    teamRank.set(runnerUp, 2)
  }

  if (lbFinal && lbFinal.status === 'finished' && lbFinal.teamA && lbFinal.teamB) {
    // 季军 = LB_F 败者
    if (lbFinal.winner) {
      const third = lbFinal.winner === lbFinal.teamA ? lbFinal.teamB : lbFinal.teamA
      if (!teamRank.has(third)) {
        teamRank.set(third, 3)
      }
    }
  }

  // 对于未能在前 3 排名中被标记的队伍，按淘汰轮次确定排名
  // 收集所有已完成的比赛，按轮次追踪淘汰顺序
  const eliminatedOrder: string[] = []
  const processed = new Set<string>()

  // 按轮次从后往前遍历，找出每轮被淘汰的队伍
  // 败者组轮次
  const lbRounds = stageMatches
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

  // 第一轮淘汰的队伍（UB_Q 败者进入 LB_R1 再输的）
  const ubRounds = stageMatches.filter((m) => m.round.startsWith('UB_'))
  for (const m of ubRounds) {
    if (m.status !== 'finished' || !m.winner || !m.teamA || !m.teamB) continue
    const loser = m.winner === m.teamA ? m.teamB : m.teamA
    if (!processed.has(loser) && !teamRank.has(loser)) {
      eliminatedOrder.push(loser)
      processed.add(loser)
    }
  }

  // 分配排名（从 4 开始往后）
  let nextRank = 4
  for (const tid of eliminatedOrder) {
    if (!teamRank.has(tid)) {
      teamRank.set(tid, nextRank)
      nextRank++
    }
  }

  // 剩余未标记的队伍（理论上不应存在，但兜底）
  for (const tid of teams) {
    if (!teamRank.has(tid)) {
      teamRank.set(tid, nextRank++)
    }
  }

  return teamRank
}

/**
 * 从三败淘汰赛的比赛中推算启点赛最终排名
 * 返回 Map<teamId, rank>
 */
function determineKickoffRanking(matches: Match[]): Map<string, number> {
  const kickoffMatches = filterStage(matches, 'kickoff')
  const teamRank = new Map<string, number>()

  // 收集所有参赛队伍
  const teams = new Set<string>()
  for (const m of kickoffMatches) {
    if (m.teamA) teams.add(m.teamA)
    if (m.teamB) teams.add(m.teamB)
  }

  // 最终排名逻辑（三败淘汰）：
  // 1st = UB_F 胜者
  // 2nd = MB_F 胜者（或 GF 胜者，取决于结构）
  // 3rd = LB_F 胜者
  // 4th = LB_F 败者
  // 其余按淘汰顺序

  const ubFinal = kickoffMatches.find((m) => m.round === 'UB_F')
  const mbFinal = kickoffMatches.find((m) => m.round === 'MB_F')
  const lbFinal = kickoffMatches.find((m) => m.round === 'LB_F')

  // 第一名
  if (ubFinal && ubFinal.status === 'finished' && ubFinal.winner) {
    teamRank.set(ubFinal.winner, 1)
  }

  // 第二名
  if (mbFinal && mbFinal.status === 'finished' && mbFinal.winner) {
    teamRank.set(mbFinal.winner, 2)
  }

  if (lbFinal && lbFinal.status === 'finished' && lbFinal.winner && lbFinal.teamA && lbFinal.teamB) {
    // 第三名 = LB_F 胜者
    teamRank.set(lbFinal.winner, 3)
    // 第四名 = LB_F 败者
    const fourth = lbFinal.winner === lbFinal.teamA ? lbFinal.teamB : lbFinal.teamA
    teamRank.set(fourth, 4)
  }

  // 剩余队伍按淘汰顺序确定排名
  const processed = new Set<string>()
  const eliminatedOrder: string[] = []

  // 按轮次从后往前遍历
  const allRounds = ['LB_R4', 'LB_R3', 'LB_R2', 'LB_R1', 'MB_R4', 'MB_R3', 'MB_R2', 'MB_R1', 'UB_R3', 'UB_R2', 'UB_R1']
  for (const round of allRounds) {
    const roundMatches = kickoffMatches.filter((m) => m.round === round)
    for (const m of roundMatches) {
      if (m.status !== 'finished' || !m.winner || !m.teamA || !m.teamB) continue
      const loser = m.winner === m.teamA ? m.teamB : m.teamA
      if (!processed.has(loser) && !teamRank.has(loser)) {
        eliminatedOrder.push(loser)
        processed.add(loser)
      }
    }
  }

  let nextRank = 5
  for (const tid of eliminatedOrder) {
    if (!teamRank.has(tid)) {
      teamRank.set(tid, nextRank)
      nextRank++
    }
  }

  // 兜底
  for (const tid of teams) {
    if (!teamRank.has(tid)) {
      teamRank.set(tid, nextRank++)
    }
  }

  return teamRank
}

/**
 * 获取某队的大师赛积分
 * 通过 matches 中 stage='masters' 的比赛推算
 * 简化实现：根据 points.json 中已有的 mastersPoints 数据
 */
function getMastersPoints(
  teamId: string,
  existingPoints: TeamPoints[],
): number {
  // 优先从已有的 points 数据中获取（可被后续计算覆盖）
  const existing = existingPoints.find((p) => p.teamId === teamId)
  if (existing) {
    return existing.mastersPoints
  }
  return 0
}

// ──────────────────────────────────────────
// 公开函数
// ──────────────────────────────────────────

/**
 * 根据各阶段比赛结果重新计算所有队伍积分
 * @param teams 队伍列表
 * @param matches 全年比赛
 * @param existingPoints 现有积分数据（用于保留大师赛等外部积分）
 */
export function calculatePoints(
  teams: Team[],
  matches: Match[],
  existingPoints: TeamPoints[],
): TeamPoints[] {
  // 1. 计算启点赛排名与积分
  const kickoffRanking = determineKickoffRanking(matches)

  // 2. 计算第一赛段常规赛胜场
  const s1Regular = filterStage(matches, 'stage1_regular')

  // 3. 计算第一赛段季后赛排名与积分
  const s1PlayoffRanking = determinePlayoffRanking(
    matches,
    'stage1_playoff',
    S1_PLAYOFF_POINTS,
  )

  // 4. 计算第二赛段常规赛胜场
  const s2Regular = filterStage(matches, 'stage2_regular')

  // 5. 计算第二赛段季后赛排名与积分
  const s2PlayoffRanking = determinePlayoffRanking(
    matches,
    'stage2_playoff',
    S2_PLAYOFF_POINTS,
  )

  // 构建每队积分
  const results: TeamPoints[] = teams.map((team) => {
    const tid = team.teamId

    // 启点赛积分
    const koRank = kickoffRanking.get(tid) ?? 99
    const kickoffPts = KICKOFF_POINTS[koRank] ?? 0

    // 第一赛段常规赛积分
    const s1RegPts = countRegularWins(s1Regular, tid)

    // 第一赛段季后赛积分
    const s1PORank = s1PlayoffRanking.get(tid) ?? 99
    const s1POPts = S1_PLAYOFF_POINTS[s1PORank] ?? 0

    // 第二赛段常规赛积分
    const s2RegPts = countRegularWins(s2Regular, tid)

    // 第二赛段季后赛积分
    const s2PORank = s2PlayoffRanking.get(tid) ?? 99
    const s2POPts = S2_PLAYOFF_POINTS[s2PORank] ?? 0

    // 大师赛积分（从现有数据中获取）
    const mastersPts = getMastersPoints(tid, existingPoints)

    const total =
      kickoffPts + s1RegPts + s1POPts + s2RegPts + s2POPts + mastersPts

    return {
      teamId: tid,
      kickoffPoints: kickoffPts,
      stage1RegularPoints: s1RegPts,
      stage1PlayoffPoints: s1POPts,
      stage2RegularPoints: s2RegPts,
      stage2PlayoffPoints: s2POPts,
      mastersPoints: mastersPts,
      totalPoints: total,
      qualifiedStatus: 'pending' as QualifiedStatus,
    }
  })

  return results
}

/**
 * 按总积分降序排序（含同分规则）
 * 同分时：优先对比大师赛成绩，再对比第二赛段季后赛名次
 *
 * @param teams 积分列表
 * @param allMatches 全年比赛（用于同分时查询第二赛段季后赛名次）
 */
export function sortByPoints(
  teams: TeamPoints[],
  allMatches: Match[],
): TeamPoints[] {
  // 预计算第二赛段季后赛排名用于同分排序
  const s2PlayoffRanking = determinePlayoffRanking(
    allMatches,
    'stage2_playoff',
    S2_PLAYOFF_POINTS,
  )

  return [...teams].sort((a, b) => {
    // 1. 按总积分降序
    if (b.totalPoints !== a.totalPoints) {
      return b.totalPoints - a.totalPoints
    }

    // 2. 同分：对比大师赛成绩（降序）
    if (b.mastersPoints !== a.mastersPoints) {
      return b.mastersPoints - a.mastersPoints
    }

    // 3. 同分：对比第二赛段季后赛名次（名次越小越好，升序）
    const aRank = s2PlayoffRanking.get(a.teamId) ?? 99
    const bRank = s2PlayoffRanking.get(b.teamId) ?? 99
    if (aRank !== bRank) {
      return aRank - bRank
    }

    // 4. 最后按 teamId 字母序
    return a.teamId.localeCompare(b.teamId)
  })
}

/**
 * 判定全球冠军赛 CN 赛区 4 个名额
 *
 * 规则：
 * - 名额 1-2：第二赛段季后赛冠亚军（直通）
 * - 名额 3-4：扣除直通队伍后，全年积分前 2
 *
 * @param teams 积分列表（需已通过 sortByPoints 排序）
 * @param allMatches 全年比赛
 */
export function determineChampionshipQualifiers(
  teams: TeamPoints[],
  allMatches: Match[],
): { qualified: string[]; remaining: string[] } {
  // 1. 找出第二赛段季后赛冠亚军（直通）
  const s2PlayoffRanking = determinePlayoffRanking(
    allMatches,
    'stage2_playoff',
    S2_PLAYOFF_POINTS,
  )

  const directQualifiers: string[] = []
  for (const [tid, rank] of s2PlayoffRanking) {
    if (rank === 1 || rank === 2) {
      directQualifiers.push(tid)
    }
  }

  // 2. 按积分排序（含同分规则）
  const sorted = sortByPoints(teams, allMatches)

  // 3. 扣除直通队伍后，取积分前 2
  const remaining = sorted.filter(
    (t) => !directQualifiers.includes(t.teamId),
  )

  // maintenance: 确保直通名额是 2 个
  // 实际上，如果冠亚军有重复队伍（同一队既夺冠又获亚军，不可能），需要去重
  const uniqueDirect = [...new Set(directQualifiers)]

  const pointQualifiers: string[] = []
  for (const t of remaining) {
    if (pointQualifiers.length >= 2) break
    pointQualifiers.push(t.teamId)
  }

  const qualified = [...uniqueDirect, ...pointQualifiers]
  const remainingTeamIds = remaining
    .filter((t) => !pointQualifiers.includes(t.teamId))
    .map((t) => t.teamId)

  return {
    qualified,
    remaining: remainingTeamIds,
  }
}