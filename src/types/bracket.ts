import type { Stage, MatchStatus } from '@/types/match'
import type { QualifiedStatus } from '@/types/points'

/** 对阵图中的单场比赛 */
export interface BracketMatch {
  matchId: string
  round: string
  teamA: string | null
  teamB: string | null
  scoreA: number
  scoreB: number
  winner: string | null
  status: MatchStatus
  seedA?: number
  seedB?: number
}

/** 对阵图中的一轮 */
export interface BracketRound {
  roundName: string
  matches: BracketMatch[]
}

/** 完整的对阵图数据 */
export interface BracketData {
  stage: Stage
  winnerBracket: BracketRound[]
  middleBracket?: BracketRound[]
  loserBracket: BracketRound[]
  grandFinal?: BracketRound
}

/** 小组积分榜中的队伍数据 */
export interface TeamWithStanding {
  teamId: string
  teamNameCn: string
  wins: number
  losses: number
  rank: number
  status: QualifiedStatus
  condition: string
  theoreticalMinRank: number
  theoreticalMaxRank: number
}