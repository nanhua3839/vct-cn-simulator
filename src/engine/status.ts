/**
 * 全局晋级状态汇总
 *
 * 提供：
 * - calculateGlobalStatus：汇总所有队伍在当前全年赛程中的晋级状态
 */

import type { Team } from '@/types/team'
import type { Match, Stage } from '@/types/match'
import type { TeamPoints, QualifiedStatus } from '@/types/points'
import { calculateGroupStandings } from './standings'
import {
  buildDoubleEliminationBracket,
  buildTripleEliminationBracket,
  calculateBracketStatus,
  calculateRemainingLives,
} from './bracket'
import { determineChampionshipQualifiers, sortByPoints } from './points'

/** 单队全局晋级状态 */
export interface GlobalTeamStatus {
  teamId: string
  /** 当前所处阶段（idle 表示该队当前阶段未开始或已结束） */
  currentStage: Stage | 'idle'
  /** 晋级状态 */
  status: QualifiedStatus
  /** 晋级/淘汰条件文字说明 */
  condition: string
  /** 理论名次/种子顺位范围 */
  theoreticalRange: string
}

// ──────────────────────────────────────────
// 阶段组定义
// ──────────────────────────────────────────

/** 第一赛段 Alpha 组队伍 */
const S1_ALPHA = ['EDG', 'BLG', 'AG', 'RNG', 'TYL', 'WOL']
/** 第一赛段 Omega 组队伍 */
const S1_OMEGA = ['TE', 'FPX', 'TEC', 'NOVA', 'DRG', 'JDG']

/** 第二赛段 Alpha 组队伍 */
const S2_ALPHA = ['NOVA', 'EDG', 'AG', 'WOL', 'DRG', 'FPX']
/** 第二赛段 Omega 组队伍 */
const S2_OMEGA = ['BLG', 'TE', 'TYL', 'RNG', 'TEC', 'JDG']

// ──────────────────────────────────────────
// 辅助函数
// ──────────────────────────────────────────

/**
 * 判断某阶段是否所有比赛已完成
 */
function isStageComplete(matches: Match[], stage: Stage): boolean {
  const stageMatches = matches.filter((m) => m.stage === stage)
  if (stageMatches.length === 0) return false
  return stageMatches.every((m) => m.status === 'finished')
}

/**
 * 判断某队是否参与了某阶段
 */
function teamInStage(matches: Match[], teamId: string, stage: Stage): boolean {
  return matches.some(
    (m) => m.stage === stage && (m.teamA === teamId || m.teamB === teamId),
  )
}

/**
 * 获取某队的启点赛状态
 */
function getKickoffStatus(
  matches: Match[],
  teamId: string,
): { status: QualifiedStatus; condition: string; range: string } {
  const kickoffMatches = matches.filter((m) => m.stage === 'kickoff')
  const complete = isStageComplete(matches, 'kickoff')

  // 检查是否在启点赛参赛队伍中
  if (!teamInStage(kickoffMatches, teamId, 'kickoff')) {
    return { status: 'out', condition: '未参加启点赛', range: '-' }
  }

  // 计算剩余可败场数
  const lives = calculateRemainingLives(teamId, kickoffMatches)

  if (complete) {
    // 启点赛已完成
    // 前三名晋级圣地亚哥大师赛
    const bracket = buildTripleEliminationBracket(kickoffMatches)
    const statuses = calculateBracketStatus({
      stage: 'kickoff' as Stage,
      winnerBracket: bracket.winnerBracket,
      loserBracket: bracket.loserBracket,
      grandFinal: bracket.grandFinal,
      allMatches: bracket.allMatches,
    })

    const teamStatus = statuses.find((s) => s.teamId === teamId)
    if (teamStatus?.status === 'qualified') {
      return {
        status: 'qualified',
        condition: '已晋级圣地亚哥大师赛',
        range: '启点赛前 3 名',
      }
    }

    // 检查是否已淘汰
    if (lives === 0) {
      return {
        status: 'eliminated',
        condition: '启点赛已淘汰',
        range: '启点赛第 4 名及以后',
      }
    }

    return {
      status: 'eliminated',
      condition: '启点赛已结束，未晋级',
      range: '启点赛第 4 名及以后',
    }
  } else {
    // 启点赛进行中
    if (lives <= 0) {
      return {
        status: 'eliminated',
        condition: '已输 3 场，淘汰',
        range: '已淘汰',
      }
    }

    // 检查是否已锁定大师赛资格
    // 简化：如果已进入 LB_F 或更高，说明是前 3
    // 更精确的判定需要追踪 bracket
    return {
      status: 'pending',
      condition: `剩余可败 ${lives} 场`,
      range: '待定',
    }
  }
}

/**
 * 获取某队的第一赛段状态
 */
function getStage1Status(
  matches: Match[],
  teamId: string,
  _allPoints: TeamPoints[],
): { status: QualifiedStatus; condition: string; range: string } {
  const s1RegularComplete = isStageComplete(matches, 'stage1_regular')
  const s1PlayoffComplete = isStageComplete(matches, 'stage1_playoff')

  if (!teamInStage(matches, teamId, 'stage1_regular')) {
    return { status: 'out', condition: '未参加第一赛段', range: '-' }
  }

  // 检查第一赛段季后赛结果
  if (s1PlayoffComplete) {
    const bracket = buildDoubleEliminationBracket(
      matches.filter((m) => m.stage === 'stage1_playoff'),
    )
    const statuses = calculateBracketStatus(bracket)
    const teamStatus = statuses.find((s) => s.teamId === teamId)

    if (teamStatus?.status === 'qualified') {
      return {
        status: 'qualified',
        condition: '已晋级伦敦大师赛',
        range: '第一赛段前 3 名',
      }
    }

    // 检查是否在季后赛中
    const inPlayoff = matches.some(
      (m) =>
        m.stage === 'stage1_playoff' &&
        (m.teamA === teamId || m.teamB === teamId),
    )

    if (!inPlayoff) {
      return {
        status: 'eliminated',
        condition: '未进入季后赛',
        range: s1RegularComplete ? '常规赛第 5-6 名' : '常规赛待定',
      }
    }

    if (teamStatus?.status === 'eliminated') {
      return {
        status: 'eliminated',
        condition: '季后赛已淘汰',
        range: '第一赛段第 4 名及以后',
      }
    }

    return {
      status: 'pending',
      condition: '季后赛进行中',
      range: '待定',
    }
  }

  // 常规赛未完成
  if (!s1RegularComplete) {
    // 判断在 Alpha 还是 Omega 组
    const isAlpha = S1_ALPHA.includes(teamId)
    const groupTeams = isAlpha ? S1_ALPHA : S1_OMEGA
    const groupName = isAlpha ? 'Alpha' : 'Omega'

    const result = calculateGroupStandings(
      matches,
      groupTeams,
      'stage1_regular' as Stage,
      groupName,
      4,
    )
    const standing = result.standings.find((s) => s.teamId === teamId)

    if (standing) {
      return {
        status: standing.status === 'locked' ? 'locked' : 'pending',
        condition: standing.qualificationCondition,
        range: `${groupName}组 ${standing.theoreticalMinRank}-${standing.theoreticalMaxRank} 名`,
      }
    }
  }

  // 常规赛完成但季后赛未开始
  if (s1RegularComplete && !s1PlayoffComplete) {
    const isAlpha = S1_ALPHA.includes(teamId)
    const groupTeams = isAlpha ? S1_ALPHA : S1_OMEGA
    const groupName = isAlpha ? 'Alpha' : 'Omega'

    const result = calculateGroupStandings(
      matches,
      groupTeams,
      'stage1_regular' as Stage,
      groupName,
      4,
    )
    const standing = result.standings.find((s) => s.teamId === teamId)

    if (standing) {
      if (standing.rank <= 4) {
        return {
          status: 'locked',
          condition: '已晋级季后赛，等待开赛',
          range: `${groupName}组第 ${standing.rank} 名`,
        }
      } else {
        return {
          status: 'eliminated',
          condition: '常规赛未进前 4',
          range: `${groupName}组第 ${standing.rank} 名`,
        }
      }
    }
  }

  return { status: 'pending', condition: '待定', range: '-' }
}

/**
 * 获取某队的第二赛段状态
 */
function getStage2Status(
  matches: Match[],
  teamId: string,
  _allPoints: TeamPoints[],
): { status: QualifiedStatus; condition: string; range: string } {
  if (!teamInStage(matches, teamId, 'stage2_regular')) {
    return { status: 'out', condition: '未参加第二赛段', range: '-' }
  }

  const s2PlayoffComplete = isStageComplete(matches, 'stage2_playoff')

  // 第二赛段季后赛已完成
  if (s2PlayoffComplete) {
    const bracket = buildDoubleEliminationBracket(
      matches.filter((m) => m.stage === 'stage2_playoff'),
    )
    const statuses = calculateBracketStatus(bracket)
    const teamStatus = statuses.find((s) => s.teamId === teamId)

    if (teamStatus?.status === 'qualified') {
      return {
        status: 'qualified',
        condition: '已晋级上海全球冠军赛',
        range: '第二赛段前 2 名',
      }
    }

    // 检查是否在季后赛中
    const inPlayoff = matches.some(
      (m) =>
        m.stage === 'stage2_playoff' &&
        (m.teamA === teamId || m.teamB === teamId),
    )
    if (!inPlayoff) {
      // 检查是否在入围赛中
      const inPlayins = matches.some(
        (m) =>
          m.stage === 'stage2_playins' &&
          (m.teamA === teamId || m.teamB === teamId),
      )
      if (!inPlayins) {
        return {
          status: 'eliminated',
          condition: '未进入入围赛',
          range: '常规赛第 3-6 名',
        }
      }
      // 在入围赛中但未进季后赛
      return {
        status: 'eliminated',
        condition: '入围赛未晋级',
        range: '第二赛段第 9-12 名',
      }
    }

    if (teamStatus?.status === 'eliminated') {
      return {
        status: 'eliminated',
        condition: '季后赛已淘汰',
        range: '第二赛段第 5-8 名',
      }
    }

    return {
      status: 'pending',
      condition: '季后赛进行中',
      range: '待定',
    }
  }

  // 常规赛未完成
  const s2RegularComplete = isStageComplete(matches, 'stage2_regular')
  if (!s2RegularComplete) {
    const isAlpha = S2_ALPHA.includes(teamId)
    const groupTeams = isAlpha ? S2_ALPHA : S2_OMEGA
    const groupName = isAlpha ? 'Alpha' : 'Omega'

    const result = calculateGroupStandings(
      matches,
      groupTeams,
      'stage2_regular' as Stage,
      groupName,
      2,
    )
    const standing = result.standings.find((s) => s.teamId === teamId)

    if (standing) {
      return {
        status: standing.status === 'locked' ? 'locked' : 'pending',
        condition: standing.qualificationCondition,
        range: `${groupName}组 ${standing.theoreticalMinRank}-${standing.theoreticalMaxRank} 名`,
      }
    }
  }

  // 常规赛完成但季后赛未开始
  if (s2RegularComplete && !s2PlayoffComplete) {
    const isAlpha = S2_ALPHA.includes(teamId)
    const groupTeams = isAlpha ? S2_ALPHA : S2_OMEGA
    const groupName = isAlpha ? 'Alpha' : 'Omega'

    const result = calculateGroupStandings(
      matches,
      groupTeams,
      'stage2_regular' as Stage,
      groupName,
      2,
    )
    const standing = result.standings.find((s) => s.teamId === teamId)

    if (standing) {
      if (standing.rank <= 2) {
        return {
          status: 'locked',
          condition: '已直通季后赛',
          range: `${groupName}组第 ${standing.rank} 名`,
        }
      } else {
        return {
          status: 'pending',
          condition: '进入入围赛，争夺季后赛名额',
          range: `${groupName}组第 ${standing.rank} 名`,
        }
      }
    }
  }

  return { status: 'pending', condition: '待定', range: '-' }
}

/**
 * 获取某队的全球冠军赛资格状态
 */
function getChampionsStatus(
  teamId: string,
  allPoints: TeamPoints[],
  matches: Match[],
): { status: QualifiedStatus; condition: string; range: string } {
  const { qualified } = determineChampionshipQualifiers(allPoints, matches)

  if (qualified.includes(teamId)) {
    return {
      status: 'qualified',
      condition: '已获得上海全球冠军赛资格',
      range: '全球冠军赛',
    }
  }

  // 检查是否仍有理论可能
  // 如果第二赛段季后赛已完成，则已确定名额
  if (isStageComplete(matches, 'stage2_playoff')) {
    return {
      status: 'eliminated',
      condition: '未获得全球冠军赛资格',
      range: '全球冠军赛',
    }
  }

  return {
    status: 'pending',
    condition: '待定，需看后续赛果',
    range: '全球冠军赛',
  }
}

// ──────────────────────────────────────────
// 主函数
// ──────────────────────────────────────────

/**
 * 汇总所有队伍在当前全年赛程中的晋级状态
 *
 * @param teams 队伍列表
 * @param matches 全年比赛
 * @param existingPoints 当前积分数据
 */
export function calculateGlobalStatus(
  teams: Team[],
  matches: Match[],
  existingPoints: TeamPoints[],
): GlobalTeamStatus[] {
  // 先计算积分
  const sortedPoints = sortByPoints(existingPoints, matches)

  // 判断各阶段完成情况
  const kickoffDone = isStageComplete(matches, 'kickoff')
  const s1Done = isStageComplete(matches, 'stage1_playoff')
  const s2Done = isStageComplete(matches, 'stage2_playoff')
  const allDone = kickoffDone && s1Done && s2Done

  // 判断当前主导阶段
  const getCurrentStage = (teamId: string): Stage | 'idle' => {
    if (!teamInStage(matches, teamId, 'kickoff') &&
        !teamInStage(matches, teamId, 'stage1_regular') &&
        !teamInStage(matches, teamId, 'stage2_regular')) {
      return 'idle'
    }

    // 从后往前，看哪个阶段还在进行中
    if (!isStageComplete(matches, 'stage2_playoff') &&
        teamInStage(matches, teamId, 'stage2_playoff')) {
      return 'stage2_playoff'
    }
    if (!isStageComplete(matches, 'stage2_playins') &&
        teamInStage(matches, teamId, 'stage2_playins')) {
      return 'stage2_playins'
    }
    if (!isStageComplete(matches, 'stage2_regular') &&
        teamInStage(matches, teamId, 'stage2_regular')) {
      return 'stage2_regular'
    }
    if (!isStageComplete(matches, 'stage1_playoff') &&
        teamInStage(matches, teamId, 'stage1_playoff')) {
      return 'stage1_playoff'
    }
    if (!isStageComplete(matches, 'stage1_regular') &&
        teamInStage(matches, teamId, 'stage1_regular')) {
      return 'stage1_regular'
    }
    if (!isStageComplete(matches, 'kickoff') &&
        teamInStage(matches, teamId, 'kickoff')) {
      return 'kickoff'
    }

    // 如果所有阶段都完成了，返回最后一个参与的阶段
    if (teamInStage(matches, teamId, 'stage2_playoff')) return 'stage2_playoff'
    if (teamInStage(matches, teamId, 'stage2_regular')) return 'stage2_regular'
    if (teamInStage(matches, teamId, 'stage1_playoff')) return 'stage1_playoff'
    if (teamInStage(matches, teamId, 'stage1_regular')) return 'stage1_regular'
    if (teamInStage(matches, teamId, 'kickoff')) return 'kickoff'

    return 'idle'
  }

  const results: GlobalTeamStatus[] = teams.map((team) => {
    const tid = team.teamId
    const currentStage = getCurrentStage(tid)

    // 如果全年赛程已结束，直接判定冠军赛资格
    if (allDone) {
      const champsStatus = getChampionsStatus(tid, sortedPoints, matches)
      return {
        teamId: tid,
        currentStage,
        status: champsStatus.status,
        condition: champsStatus.condition,
        theoreticalRange: champsStatus.range,
      }
    }

    // 按阶段优先级判定
    // 首先检查是否已获全球冠军赛资格
    if (s2Done) {
      const champsStatus = getChampionsStatus(tid, sortedPoints, matches)
      if (champsStatus.status === 'qualified') {
        return {
          teamId: tid,
          currentStage,
          status: 'qualified',
          condition: champsStatus.condition,
          theoreticalRange: champsStatus.range,
        }
      }
    }

    // 检查第二赛段状态
    if (teamInStage(matches, tid, 'stage2_regular')) {
      const s2Status = getStage2Status(matches, tid, sortedPoints)
      if (s2Status.status === 'qualified') {
        return {
          teamId: tid,
          currentStage,
          status: 'qualified',
          condition: s2Status.condition,
          theoreticalRange: s2Status.range,
        }
      }
      if (s2Status.status === 'eliminated') {
        return {
          teamId: tid,
          currentStage,
          status: 'eliminated',
          condition: s2Status.condition,
          theoreticalRange: s2Status.range,
        }
      }
      if (s2Status.status === 'locked') {
        return {
          teamId: tid,
          currentStage,
          status: 'locked',
          condition: s2Status.condition,
          theoreticalRange: s2Status.range,
        }
      }
      return {
        teamId: tid,
        currentStage,
        status: 'pending',
        condition: s2Status.condition,
        theoreticalRange: s2Status.range,
      }
    }

    // 检查第一赛段状态
    if (teamInStage(matches, tid, 'stage1_regular')) {
      const s1Status = getStage1Status(matches, tid, sortedPoints)
      if (s1Status.status === 'qualified') {
        return {
          teamId: tid,
          currentStage,
          status: 'qualified',
          condition: s1Status.condition,
          theoreticalRange: s1Status.range,
        }
      }
      if (s1Status.status === 'eliminated') {
        return {
          teamId: tid,
          currentStage,
          status: 'eliminated',
          condition: s1Status.condition,
          theoreticalRange: s1Status.range,
        }
      }
      return {
        teamId: tid,
        currentStage,
        status: s1Status.status,
        condition: s1Status.condition,
        theoreticalRange: s1Status.range,
      }
    }

    // 检查启点赛状态
    if (teamInStage(matches, tid, 'kickoff')) {
      const koStatus = getKickoffStatus(matches, tid)
      if (koStatus.status === 'qualified') {
        return {
          teamId: tid,
          currentStage,
          status: 'qualified',
          condition: koStatus.condition,
          theoreticalRange: koStatus.range,
        }
      }
      return {
        teamId: tid,
        currentStage,
        status: koStatus.status,
        condition: koStatus.condition,
        theoreticalRange: koStatus.range,
      }
    }

    // 兜底
    return {
      teamId: tid,
      currentStage: 'idle',
      status: 'pending',
      condition: '待定',
      theoreticalRange: '-',
    }
  })

  return results
}