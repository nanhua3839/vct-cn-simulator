/** VCT CN 联赛参赛队伍 */
export interface Team {
  /** 队伍唯一标识，如 'EDG' */
  teamId: string
  /** 中文名，如 '上海EDG' */
  teamNameCn: string
  /** 英文名，如 'EDward Gaming' */
  teamNameEn: string
  /** Logo 路径（可为空字符串，前端显示首字母兜底） */
  logo: string
  /** 全年冠军赛总积分（与 points.json 中 totalPoints 保持一致） */
  totalPoints: number
}
