/**
 * 队伍全局晋级状态：
 * - qualified 已晋级（如已获全球冠军赛名额）
 * - pending 待定（仍有晋级可能，条件未完全满足）
 * - eliminated 已淘汰（已无晋级可能）
 * - locked 已锁定出线（条件已满足，等赛事开打）
 * - out 已无缘（彻底无缘，通常用于阶段性出局队伍）
 */
export type QualifiedStatus = 'qualified' | 'pending' | 'eliminated' | 'locked' | 'out'

/** 队伍全年冠军赛积分 */
export interface TeamPoints {
  teamId: string
  /** 启点赛名次积分 */
  kickoffPoints: number
  /** 第一赛段常规赛积分（每胜 1 分） */
  stage1RegularPoints: number
  /** 第一赛段季后赛名次积分 */
  stage1PlayoffPoints: number
  /** 第二赛段常规赛积分（每胜 1 分） */
  stage2RegularPoints: number
  /** 第二赛段季后赛名次积分 */
  stage2PlayoffPoints: number
  /** 大师赛成绩积分（圣地亚哥 + 伦敦） */
  mastersPoints: number
  /** 全年冠军赛总积分 */
  totalPoints: number
  /** 当前晋级状态 */
  qualifiedStatus: QualifiedStatus
}
