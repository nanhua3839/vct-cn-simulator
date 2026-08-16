/** 全年赛程赛事阶段 */
export type Stage =
  | 'kickoff' // 启点赛（三败淘汰）
  | 'stage1_regular' // 第一赛段常规赛（Alpha / Omega 单循环）
  | 'stage1_playoff' // 第一赛段季后赛（8 队双败）
  | 'stage2_regular' // 第二赛段常规赛
  | 'stage2_playins' // 第二赛段入围赛（10 队双败）
  | 'stage2_playoff' // 第二赛段季后赛（8 队双败）
  | 'masters' // 大师赛（圣地亚哥 / 伦敦）
  | 'champions' // 全球冠军赛（上海）

/** 比赛状态 */
export type MatchStatus = 'finished' | 'upcoming' | 'live'

/**
 * 单场比赛。
 * - teamA / teamB 在轮空或对阵未定时可为 null（由晋级引擎自动填充）。
 * - nextMatchWinnerId / nextMatchLoserId 指向后续场次的 matchId，
 *   用于构建晋级（胜者）与降级（败者）两条路径。
 */
export interface Match {
  matchId: string
  stage: Stage
  /** 轮次标识，如 UB_R1 / UB_R2 / UB_F / MB_R1 / LB_R1 / LB_F / GF / R1 等 */
  round: string
  teamA: string | null
  teamB: string | null
  /** 已完成时为大比分，未进行时为 0 */
  scoreA: number
  scoreB: number
  /** 胜者 teamId，未完成时为 null */
  winner: string | null
  /** 胜者晋级的下一场比赛 matchId（无则为 null） */
  nextMatchWinnerId: string | null
  /** 败者降入的下一场比赛 matchId（无则为 null） */
  nextMatchLoserId: string | null
  status: MatchStatus
}
