/**
 * 常规赛组内排名与晋级判定
 *
 * 提供：
 * - calculateGroupStandings：按胜场排序的组内排名，含理论最高/最低排名、锁定/淘汰判定、出线条件文字
 */

import type { Match, Stage } from '@/types/match'

/** 单队组内排名信息 */
export interface GroupStanding {
  teamId: string
  wins: number
  losses: number
  rank: number
  /** locked=已锁定晋级；pending=待定；eliminated=已淘汰；out=已无缘 */
  status: 'locked' | 'pending' | 'eliminated' | 'out'
  /** 理论最低排名（最差情况） */
  theoreticalMinRank: number
  /** 理论最高排名（最好情况） */
  theoreticalMaxRank: number
  /** 出线条件文字说明 */
  qualificationCondition: string
}

/** 组内排名结果 */
export interface GroupStandingsResult {
  groupName: string
  standings: GroupStanding[]
  /** 晋级名额数（第一赛段前 4，第二赛段前 2 直通） */
  quota: number
}

/**
 * 计算组内排名
 * @param matches 全年所有比赛
 * @param groupTeams 该组队伍 ID 列表
 * @param stage 阶段标识
 * @param groupName 组名（如 'Alpha'/'Omega'）
 * @param quota 晋级名额数
 */
export function calculateGroupStandings(
  matches: Match[],
  groupTeams: string[],
  stage: Stage,
  groupName: string = '',
  quota: number = 4,
): GroupStandingsResult {
  // 筛选该阶段常规赛且两队都在本组的比赛
  const groupMatches = matches.filter(
    (m) =>
      m.stage === stage &&
      m.teamA &&
      m.teamB &&
      groupTeams.includes(m.teamA) &&
      groupTeams.includes(m.teamB),
  )

  // 计算每队胜/负场
  const teamStats = new Map<
    string,
    { wins: number; losses: number; played: number }
  >()
  for (const tid of groupTeams) {
    teamStats.set(tid, { wins: 0, losses: 0, played: 0 })
  }

  for (const m of groupMatches) {
    if (!m.teamA || !m.teamB) continue
    const a = teamStats.get(m.teamA)!
    const b = teamStats.get(m.teamB)!
    if (m.status === 'finished' && m.winner) {
      if (m.winner === m.teamA) {
        a.wins++
        b.losses++
      } else {
        b.wins++
        a.losses++
      }
      a.played++
      b.played++
    } else if (m.status === 'upcoming' || m.status === 'live') {
      // 未完成的比赛，两队都标记为未打
      // played 不计入
    }
  }

  // 按胜场降序排序
  const sorted = [...groupTeams].sort((a, b) => {
    const sa = teamStats.get(a)!
    const sb = teamStats.get(b)!
    return sb.wins - sa.wins
  })

  // 计算每队剩余比赛场数
  const remainingCount = new Map<string, number>()
  for (const tid of groupTeams) {
    remainingCount.set(tid, 0)
  }
  for (const m of groupMatches) {
    if (!m.teamA || !m.teamB) continue
    if (m.status === 'upcoming' || m.status === 'live') {
      remainingCount.set(m.teamA, remainingCount.get(m.teamA)! + 1)
      remainingCount.set(m.teamB, remainingCount.get(m.teamB)! + 1)
    }
  }

  // 判断所有比赛是否已完成
  const allFinished = groupMatches.every((m) => m.status === 'finished')

  // 计算理论最高/最低排名
  const theoreticalRanks = new Map<
    string,
    { minRank: number; maxRank: number }
  >()

  if (allFinished) {
    // 所有比赛完成，理论排名 = 实际排名
    for (let i = 0; i < sorted.length; i++) {
      const tid = sorted[i]
      theoreticalRanks.set(tid, { minRank: i + 1, maxRank: i + 1 })
    }
  } else {
    for (const tid of groupTeams) {
      const stats = teamStats.get(tid)!
      const remaining = remainingCount.get(tid)!

      // 最好情况：本队赢下所有剩余比赛，其他队伍输掉所有剩余比赛
      const bestWins = stats.wins + remaining
      // 最差情况：本队输掉所有剩余比赛，其他队伍赢下所有剩余比赛
      const worstWins = stats.wins

      // 计算其他队伍在最好/最差情况下的胜场
      let bestRank = 1
      let worstRank = groupTeams.length

      for (const otherId of groupTeams) {
        if (otherId === tid) continue
        const otherStats = teamStats.get(otherId)!
        const otherRemaining = remainingCount.get(otherId)!

        // 其他队伍最好情况（对我们最不利）：其他队伍赢下所有剩余
        const otherBest = otherStats.wins + otherRemaining
        // 其他队伍最差情况（对我们最有利）：其他队伍输掉所有剩余
        const otherWorst = otherStats.wins

        // 计算理论最高排名（我们在最好情况下的排名）
        // 如果其他队伍在最差情况下仍比我们最好情况高，则我们排名会靠后
        if (otherWorst > bestWins) {
          bestRank++
        } else if (otherWorst === bestWins) {
          // 同分时，我们排在后面（保守估计）
          bestRank++
        }

        // 计算理论最低排名（我们在最差情况下的排名）
        if (otherBest >= worstWins) {
          worstRank++
        }
        // 如果 otherBest < worstWins，我们排在他们前面
      }

      // 修正边界
      bestRank = Math.max(1, bestRank)
      worstRank = Math.min(groupTeams.length, worstRank)

      theoreticalRanks.set(tid, {
        minRank: worstRank,
        maxRank: bestRank,
      })
    }
  }

  // 构建最终排名列表
  let currentRank = 0
  let prevWins: number | null = null
  const standings: GroupStanding[] = sorted.map((tid, index) => {
    const stats = teamStats.get(tid)!
    const theo = theoreticalRanks.get(tid)!

    // 同名次处理
    if (prevWins !== null && stats.wins === prevWins) {
      // 同胜场，保持相同排名
    } else {
      currentRank = index + 1
    }
    prevWins = stats.wins

    // 判定状态
    let status: GroupStanding['status'] = 'pending'
    let condition = ''

    if (allFinished) {
      // 所有比赛已结束
      if (currentRank <= quota) {
        status = 'locked'
        condition = `已锁定第 ${currentRank} 名，晋级季后赛`
      } else {
        status = 'eliminated'
        condition = `最终排名第 ${currentRank} 名，无缘季后赛`
      }
    } else {
      const remaining = remainingCount.get(tid)!

      // 已锁定晋级：即使剩余比赛全输也在前 quota 名
      // 即 worstCase 也 ≤ quota
      // 构建 worstCase 排名
      const worstCaseWins = stats.wins
      let worstRank = 1
      for (const otherId of groupTeams) {
        if (otherId === tid) continue
        const otherStats = teamStats.get(otherId)!
        const otherRemaining = remainingCount.get(otherId)!
        const otherBest = otherStats.wins + otherRemaining
        if (otherBest > worstCaseWins) {
          worstRank++
        }
      }
      worstRank = Math.min(groupTeams.length, worstRank)

      // 已无缘晋级：即使剩余比赛全赢也在 quota 名之外
      const bestCaseWins = stats.wins + remaining
      let bestRank = groupTeams.length
      for (const otherId of groupTeams) {
        if (otherId === tid) continue
        const otherStats = teamStats.get(otherId)!
        const otherWorst = otherStats.wins
        if (otherWorst < bestCaseWins) {
          bestRank--
        }
      }
      bestRank = Math.max(1, bestRank)

      if (worstRank <= quota) {
        status = 'locked'
        condition = `已锁定晋级（理论最低排名第 ${worstRank}）`
      } else if (bestRank > quota) {
        status = 'eliminated'
        condition = `已无缘晋级（理论最高排名第 ${bestRank}）`
      } else {
        status = 'pending'
        if (remaining > 0) {
          const needWins = Math.max(
            0,
            quota - bestRank + 1,
          )
          condition = `剩余 ${remaining} 场，需至少赢 ${needWins} 场`
        } else {
          condition = `待定，排名第 ${currentRank}，需看其他队伍赛果`
        }
      }
    }

    return {
      teamId: tid,
      wins: stats.wins,
      losses: stats.losses,
      rank: currentRank,
      status,
      theoreticalMinRank: theo.minRank,
      theoreticalMaxRank: theo.maxRank,
      qualificationCondition: condition,
    }
  })

  return {
    groupName,
    standings,
    quota,
  }
}