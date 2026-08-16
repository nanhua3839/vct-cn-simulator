/**
 * 双败 / 三败淘汰树生成器
 *
 * 提供：
 * - buildDoubleEliminationBracket：构建双败淘汰对阵树
 * - calculateBracketStatus：根据对阵树计算各队晋级状态
 * - buildTripleEliminationBracket：构建三败淘汰对阵树
 * - calculateRemainingLives：计算某队剩余可败场数
 */

import type { Match, Stage } from '@/types/match'

/** 单场比赛在对阵树中的节点信息 */
export interface BracketMatchNode {
  matchId: string
  round: string
  teamA: string | null
  teamB: string | null
  scoreA: number
  scoreB: number
  winner: string | null
  status: string
  /** 该场比赛胜者进入的下一场比赛 matchId */
  nextMatchWinnerId: string | null
  /** 该场比赛败者进入的下一场比赛 matchId */
  nextMatchLoserId: string | null
  /** 该场比赛的种子顺位信息（如 'QF1'/'SF1'/'F' 等） */
  seedLabel: string
}

/** 对阵树数据 */
export interface BracketData {
  stage: Stage
  /** 胜者组各轮次比赛 */
  winnerBracket: BracketMatchNode[][]
  /** 败者组各轮次比赛 */
  loserBracket: BracketMatchNode[][]
  /** 总决赛 */
  grandFinal: BracketMatchNode | null
  /** 全部比赛节点（平铺） */
  allMatches: Map<string, BracketMatchNode>
}

/** 三败淘汰对阵树数据（在双败基础上增加突围组） */
export interface TripleEliminationBracketData {
  stage: Stage
  /** 胜者组各轮次 */
  winnerBracket: BracketMatchNode[][]
  /** 突围组各轮次 */
  middleBracket: BracketMatchNode[][]
  /** 败者组各轮次 */
  loserBracket: BracketMatchNode[][]
  /** 总决赛 */
  grandFinal: BracketMatchNode | null
  /** 全部比赛节点 */
  allMatches: Map<string, BracketMatchNode>
}

/** 队伍晋级状态 */
export interface TeamBracketStatus {
  teamId: string
  status: 'qualified' | 'eliminated' | 'pending'
  /** 当前在该阶段中的排名（如冠军=1） */
  rank: number
  /** 文字说明 */
  description: string
}

/**
 * 按轮次对比赛进行分组排序
 * 轮次前缀：UB_R1, UB_R2, ..., UB_F, LB_R1, LB_R2, ..., LB_F, GF
 */
function groupByRound(matches: Match[]): {
  ubRounds: BracketMatchNode[][]
  lbRounds: BracketMatchNode[][]
  gf: BracketMatchNode | null
  all: Map<string, BracketMatchNode>
} {
  // 按轮次分组
  const ubMap = new Map<string, BracketMatchNode[]>()
  const lbMap = new Map<string, BracketMatchNode[]>()
  let gfNode: BracketMatchNode | null = null
  const allMap = new Map<string, BracketMatchNode>()

  for (const m of matches) {
    const node: BracketMatchNode = {
      matchId: m.matchId,
      round: m.round,
      teamA: m.teamA,
      teamB: m.teamB,
      scoreA: m.scoreA,
      scoreB: m.scoreB,
      winner: m.winner,
      status: m.status,
      nextMatchWinnerId: m.nextMatchWinnerId,
      nextMatchLoserId: m.nextMatchLoserId,
      seedLabel: m.round,
    }
    allMap.set(m.matchId, node)

    if (m.round === 'GF' || m.round === 'GrandFinal') {
      gfNode = node
    } else if (m.round.startsWith('UB_') || m.round.startsWith('U')) {
      // 胜者组轮次
      const roundKey = m.round
      if (!ubMap.has(roundKey)) ubMap.set(roundKey, [])
      ubMap.get(roundKey)!.push(node)
    } else if (m.round.startsWith('LB_') || m.round.startsWith('L')) {
      // 败者组轮次
      const roundKey = m.round
      if (!lbMap.has(roundKey)) lbMap.set(roundKey, [])
      lbMap.get(roundKey)!.push(node)
    } else {
      // 其他轮次（如 GF）
      if (m.round === 'GF') {
        gfNode = node
      }
    }
  }

  // 胜者组排序
  const ubRoundKeys = [...ubMap.keys()].sort((a, b) => {
    const aNum = parseInt(a.replace(/[^0-9]/g, '')) || 0
    const bNum = parseInt(b.replace(/[^0-9]/g, '')) || 0
    if (aNum !== bNum) return aNum - bNum
    // 同数字时，UB_F 排最后
    if (a.includes('F')) return 1
    if (b.includes('F')) return -1
    return 0
  })
  const ubRounds = ubRoundKeys.map((k) => ubMap.get(k)!)

  // 败者组排序
  const lbRoundKeys = [...lbMap.keys()].sort((a, b) => {
    const aNum = parseInt(a.replace(/[^0-9]/g, '')) || 0
    const bNum = parseInt(b.replace(/[^0-9]/g, '')) || 0
    if (aNum !== bNum) return aNum - bNum
    if (a.includes('F')) return 1
    if (b.includes('F')) return -1
    return 0
  })
  const lbRounds = lbRoundKeys.map((k) => lbMap.get(k)!)

  return { ubRounds, lbRounds, gf: gfNode, all: allMap }
}

/**
 * 构建双败淘汰对阵树
 * @param bracketMatches 该阶段比赛列表
 */
export function buildDoubleEliminationBracket(
  bracketMatches: Match[],
): BracketData {
  // 用 bracketMatches 构建
  const { ubRounds, lbRounds, gf, all } = groupByRound(bracketMatches)

  // 提取 stage
  const stage = bracketMatches.length > 0 ? bracketMatches[0].stage : ('stage1_playoff' as Stage)

  return {
    stage,
    winnerBracket: ubRounds,
    loserBracket: lbRounds,
    grandFinal: gf,
    allMatches: all,
  }
}

/**
 * 根据对阵树计算各队晋级状态
 * @param bracket 对阵树数据
 * @returns 各队晋级状态列表
 */
export function calculateBracketStatus(
  bracket: BracketData,
): TeamBracketStatus[] {
  const teamStatus = new Map<
    string,
    { status: 'qualified' | 'eliminated' | 'pending'; losses: number }
  >()

  // 遍历所有比赛，统计每队状态
  for (const [, node] of bracket.allMatches) {
    if (!node.teamA || !node.teamB) continue

    // 确保队伍在 map 中
    for (const tid of [node.teamA, node.teamB]) {
      if (!teamStatus.has(tid)) {
        teamStatus.set(tid, { status: 'pending', losses: 0 })
      }
    }

    if (node.status === 'finished' && node.winner) {
      const loser = node.winner === node.teamA ? node.teamB : node.teamA
      const loserInfo = teamStatus.get(loser)!
      loserInfo.losses++

      // 在双败赛中，败者组决赛输 = 淘汰，总决赛输一场 = 淘汰
      // 简单判定：如果该队没有 nextMatchLoserId（即无败者组可去），则已淘汰
      if (node.nextMatchLoserId === null) {
        // 败者没有下一场，已淘汰
        loserInfo.status = 'eliminated'
      }

      // 胜者晋级
      const winnerInfo = teamStatus.get(node.winner)!
      if (node.nextMatchWinnerId === null) {
        // 胜者没有下一场，说明已夺冠
        winnerInfo.status = 'qualified'
      }
    }
  }

  // 对于仍有未完成比赛的队伍，标记为 pending（除非已淘汰）
  // 对于已完成所有比赛且未淘汰的，可能是亚军
  for (const [, node] of bracket.allMatches) {
    if (!node.teamA || !node.teamB) continue
    if (node.status === 'upcoming' || node.status === 'live') {
      for (const tid of [node.teamA, node.teamB]) {
        const info = teamStatus.get(tid)
        if (info && info.status !== 'eliminated') {
          info.status = 'pending'
        }
      }
    }
  }

  // 处理总决赛
  if (bracket.grandFinal) {
    const gf = bracket.grandFinal
    if (gf.status === 'finished' && gf.winner && gf.teamA && gf.teamB) {
      const winner = gf.winner
      const loser = winner === gf.teamA ? gf.teamB : gf.teamA
      teamStatus.set(winner, { status: 'qualified', losses: 0 })
      // 总决赛败者如果在双败中，是亚军
      const loserInfo = teamStatus.get(loser)
      if (loserInfo && loserInfo.status !== 'eliminated') {
        // 亚军也晋级（如大师赛晋级）
        // 但这里我们只标记为 pending，由调用方决定
      }
    } else if (gf.status === 'upcoming' || gf.status === 'live') {
      if (gf.teamA) {
        const info = teamStatus.get(gf.teamA)
        if (info) info.status = 'pending'
      }
      if (gf.teamB) {
        const info = teamStatus.get(gf.teamB)
        if (info) info.status = 'pending'
      }
    }
  }

  // 胜者组冠军必定晋级
  if (bracket.winnerBracket.length > 0) {
    const lastUbRound = bracket.winnerBracket[bracket.winnerBracket.length - 1]
    for (const node of lastUbRound) {
      if (node.status === 'finished' && node.winner) {
        const info = teamStatus.get(node.winner)
        if (info) {
          // 胜者组冠军进总决赛，只要总决赛还没打就是 pending
          if (bracket.grandFinal && bracket.grandFinal.status !== 'finished') {
            info.status = 'pending'
          }
        }
      }
    }
  }

  // 构建最终结果
  const result: TeamBracketStatus[] = []
  // 按状态排序：qualified -> pending -> eliminated
  const statusOrder: Record<string, number> = {
    qualified: 0,
    pending: 1,
    eliminated: 2,
  }

  const sortedTeams = [...teamStatus.entries()].sort((a, b) => {
    const orderDiff =
      (statusOrder[a[1].status] || 0) - (statusOrder[b[1].status] || 0)
    if (orderDiff !== 0) return orderDiff
    return a[0].localeCompare(b[0])
  })

  for (const [teamId, info] of sortedTeams) {
    let description = ''
    switch (info.status) {
      case 'qualified':
        description = '已晋级下一阶段'
        break
      case 'eliminated':
        description = '已被淘汰'
        break
      case 'pending':
        description = '待定，仍有比赛未完成'
        break
    }
    result.push({
      teamId,
      status: info.status,
      rank: 0,
      description,
    })
  }

  return result
}

/**
 * 构建三败淘汰对阵树（启点赛）
 * @param kickoffMatches 启点赛比赛列表
 */
export function buildTripleEliminationBracket(
  kickoffMatches: Match[],
): TripleEliminationBracketData {
  // 分组：胜者组(UB)、突围组(MB)、败者组(LB)、总决赛(GF)
  const ubMap = new Map<string, BracketMatchNode[]>()
  const mbMap = new Map<string, BracketMatchNode[]>()
  const lbMap = new Map<string, BracketMatchNode[]>()
  let gfNode: BracketMatchNode | null = null
  const allMap = new Map<string, BracketMatchNode>()

  for (const m of kickoffMatches) {
    const node: BracketMatchNode = {
      matchId: m.matchId,
      round: m.round,
      teamA: m.teamA,
      teamB: m.teamB,
      scoreA: m.scoreA,
      scoreB: m.scoreB,
      winner: m.winner,
      status: m.status,
      nextMatchWinnerId: m.nextMatchWinnerId,
      nextMatchLoserId: m.nextMatchLoserId,
      seedLabel: m.round,
    }
    allMap.set(m.matchId, node)

    if (m.round === 'GF' || m.round === 'GrandFinal') {
      gfNode = node
    } else if (m.round.startsWith('UB_')) {
      const roundKey = m.round
      if (!ubMap.has(roundKey)) ubMap.set(roundKey, [])
      ubMap.get(roundKey)!.push(node)
    } else if (m.round.startsWith('MB_')) {
      const roundKey = m.round
      if (!mbMap.has(roundKey)) mbMap.set(roundKey, [])
      mbMap.get(roundKey)!.push(node)
    } else if (m.round.startsWith('LB_')) {
      const roundKey = m.round
      if (!lbMap.has(roundKey)) lbMap.set(roundKey, [])
      lbMap.get(roundKey)!.push(node)
    } else if (m.round === 'GF') {
      gfNode = node
    }
  }

  // 排序
  const sortRounds = (keys: string[]) =>
    keys.sort((a, b) => {
      const aNum = parseInt(a.replace(/[^0-9]/g, '')) || 0
      const bNum = parseInt(b.replace(/[^0-9]/g, '')) || 0
      if (aNum !== bNum) return aNum - bNum
      if (a.includes('F')) return 1
      if (b.includes('F')) return -1
      return 0
    })

  const ubRounds = sortRounds([...ubMap.keys()]).map((k) => ubMap.get(k)!)
  const mbRounds = sortRounds([...mbMap.keys()]).map((k) => mbMap.get(k)!)
  const lbRounds = sortRounds([...lbMap.keys()]).map((k) => lbMap.get(k)!)

  const stage = kickoffMatches.length > 0 ? kickoffMatches[0].stage : ('kickoff' as Stage)

  return {
    stage,
    winnerBracket: ubRounds,
    middleBracket: mbRounds,
    loserBracket: lbRounds,
    grandFinal: gfNode,
    allMatches: allMap,
  }
}

/**
 * 计算某队剩余可败场数（三败淘汰制）
 * @param teamId 队伍 ID
 * @param matches 该阶段所有比赛
 * @returns 剩余可败场数（0 表示再输一场就淘汰）
 */
export function calculateRemainingLives(
  teamId: string,
  matches: Match[],
): number {
  // 统计该队在本阶段已输场数
  let losses = 0
  for (const m of matches) {
    if (!m.teamA || !m.teamB) continue
    if (m.status !== 'finished' || !m.winner) continue

    if (m.teamA === teamId && m.winner !== teamId) {
      losses++
    } else if (m.teamB === teamId && m.winner !== teamId) {
      losses++
    }
  }

  // 三败淘汰，最多输 3 场
  return Math.max(0, 3 - losses)
}