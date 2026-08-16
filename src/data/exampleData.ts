import type { Team } from '@/types/team'
import type { Match } from '@/types/match'
import type { TeamPoints } from '@/types/points'
import teamsJson from './teams.json'
import matchesJson from './matches.json'
import pointsJson from './points.json'

/**
 * 内置示例数据（离线兜底）。
 * 与 public/data/ 目录下的 JSON 保持内容一致，供 fetch 加载失败时回退。
 */
export const exampleTeams = teamsJson as Team[]
export const exampleMatches = matchesJson as Match[]
export const examplePoints = pointsJson as TeamPoints[]
