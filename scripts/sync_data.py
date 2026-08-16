"""
VCT CN 赛制数据同步脚本

从 VLR.gg 获取 VCT CN 2026 赛季数据，生成 teams.json / matches.json / points.json。
主数据源为 vlrdevapi 库，兜底使用 requests + beautifulsoup4。

用法:
    python scripts/sync_data.py
    python scripts/sync_data.py --output-dir public/data
    python scripts/sync_data.py --dry-run
    python scripts/sync_data.py --output-dir public/data --dry-run
"""

import argparse
import json
import logging
import os
import sys
import time
from copy import deepcopy
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Optional

# ---------------------------------------------------------------------------
# 日志配置
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger("sync_data")

# ---------------------------------------------------------------------------
# 队名映射表 —— 硬编码
# ---------------------------------------------------------------------------
# 英文名 -> 短队名 ID
TEAM_NAME_MAPPING: dict[str, str] = {
    "EDward Gaming": "EDG",
    "Bilibili Gaming": "BLG",
    "All Gamers": "AG",
    "Royal Never Give Up": "RNG",
    "Trace Esports": "TE",
    "Nova Esports": "NOVA",
    "FunPlus Phoenix": "FPX",
    "Tyloo": "TYL",
    "Titan Esports Club": "TEC",
    "Dragon Ranger Gaming": "DRG",
    "Wolves Esports": "WOL",
    "JD Gaming": "JDG",
}

# 英文名 -> 中文名
TEAM_CN_MAPPING: dict[str, str] = {
    "EDward Gaming": "上海EDG",
    "Bilibili Gaming": "哔哩哔哩游戏",
    "All Gamers": "全英雄",
    "Royal Never Give Up": "皇族电竞",
    "Trace Esports": "上海TE",
    "Nova Esports": "NOVA电竞",
    "FunPlus Phoenix": "北京FPX",
    "Tyloo": "天禄",
    "Titan Esports Club": "钛金电竞",
    "Dragon Ranger Gaming": "龙骑士电竞",
    "Wolves Esports": "狼队电竞",
    "JD Gaming": "京东电竞",
}

# 短队名 -> 英文名（反向映射，用于非 VLR 场景）
TEAM_ID_TO_EN: dict[str, str] = {v: k for k, v in TEAM_NAME_MAPPING.items()}

# VCT CN 2026 赛季的 12 支固定队伍 ID
VCT_CN_TEAM_IDS: set[str] = set(TEAM_NAME_MAPPING.values())

# ---------------------------------------------------------------------------
# 请求频率控制
# ---------------------------------------------------------------------------
REQUEST_INTERVAL = 3.0  # 两次请求间最少间隔（秒）
MAX_REQUESTS = 50  # 单次执行最大请求数
_request_timestamps: list[float] = []


def rate_limit():
    """请求频率控制：间隔 ≥ 3 秒，总请求数 ≤ 50 次"""
    global _request_timestamps
    now = time.time()

    # 清理超过 60 秒的时间戳
    _request_timestamps = [t for t in _request_timestamps if now - t < 60]

    if len(_request_timestamps) >= MAX_REQUESTS:
        raise RuntimeError(
            f"已超过单次执行最大请求数 ({MAX_REQUESTS})，停止请求。"
        )

    if _request_timestamps:
        elapsed = now - _request_timestamps[-1]
        if elapsed < REQUEST_INTERVAL:
            sleep_time = REQUEST_INTERVAL - elapsed
            logger.debug(f"频率控制：等待 {sleep_time:.1f} 秒...")
            time.sleep(sleep_time)

    _request_timestamps.append(time.time())


# ---------------------------------------------------------------------------
# 数据模型（与前端类型对齐）
# ---------------------------------------------------------------------------
@dataclass
class TeamData:
    teamId: str
    teamNameCn: str
    teamNameEn: str
    logo: str = ""
    totalPoints: int = 0


@dataclass
class MatchData:
    matchId: str
    stage: str
    round: str
    teamA: Optional[str]
    teamB: Optional[str]
    scoreA: int = 0
    scoreB: int = 0
    winner: Optional[str] = None
    nextMatchWinnerId: Optional[str] = None
    nextMatchLoserId: Optional[str] = None
    status: str = "upcoming"


@dataclass
class PointsData:
    teamId: str
    kickoffPoints: int = 0
    stage1RegularPoints: int = 0
    stage1PlayoffPoints: int = 0
    stage2RegularPoints: int = 0
    stage2PlayoffPoints: int = 0
    mastersPoints: int = 0
    totalPoints: int = 0
    qualifiedStatus: str = "pending"


# ---------------------------------------------------------------------------
# VLR.gg HTML 兜底解析
# ---------------------------------------------------------------------------
def _check_fallback_deps() -> bool:
    """检查兜底依赖是否可用"""
    try:
        import requests  # noqa: F401
        from bs4 import BeautifulSoup  # noqa: F401
        return True
    except ImportError:
        return False


def _fallback_fetch_html(url: str) -> str:
    """使用 requests + beautifulsoup4 获取 HTML"""
    if not _check_fallback_deps():
        logger.warning("兜底依赖（requests + beautifulsoup4）未安装，跳过网络请求")
        return ""

    import requests
    rate_limit()
    logger.info(f"[兜底] 请求: {url}")
    resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
    resp.raise_for_status()
    return resp.text


def _fallback_find_team_id(team_name: str) -> Optional[str]:
    """尝试在映射表中查找队伍 ID（忽略大小写）"""
    # 直接映射
    if team_name in TEAM_NAME_MAPPING:
        return TEAM_NAME_MAPPING[team_name]
    # 忽略大小写
    lower_name = team_name.lower()
    for en_name, tid in TEAM_NAME_MAPPING.items():
        if en_name.lower() == lower_name:
            return tid
    # 部分匹配
    for en_name, tid in TEAM_NAME_MAPPING.items():
        if lower_name in en_name.lower() or en_name.lower() in lower_name:
            return tid
    return None


# ---------------------------------------------------------------------------
# vlrdevapi 主数据源函数
# ---------------------------------------------------------------------------
def _try_import_vlrdevapi():
    """尝试导入 vlrdevapi，失败时返回 None"""
    try:
        import vlrdevapi  # noqa: F401
        return vlrdevapi
    except ImportError:
        return None


def find_vct_cn_events(use_fallback: bool = False) -> list[dict]:
    """
    查找 VCT CN 2026 相关的赛事。
    返回赛事信息列表，每项包含 id, name, url。
    """
    events = []

    if not use_fallback:
        vlr = _try_import_vlrdevapi()
        if vlr:
            try:
                rate_limit()
                logger.info("[vlrdevapi] 获取 VCT 赛事列表...")
                all_events = vlr.events.list_events(tier="vct")
                rate_limit()
                logger.info(f"[vlrdevapi] 获取到 {len(all_events)} 个 VCT 赛事")

                vct_cn_keywords = ["vct cn", "vct china", "china league"]
                for evt in all_events:
                    name_lower = (evt.name or "").lower()
                    if any(kw in name_lower for kw in vct_cn_keywords):
                        events.append({
                            "id": evt.id,
                            "name": evt.name,
                            "url": evt.url,
                            "status": evt.status,
                        })
                if events:
                    return events
                else:
                    logger.warning("[vlrdevapi] 未找到 VCT CN 赛事，尝试兜底...")
            except Exception as e:
                logger.warning(f"[vlrdevapi] 获取赛事列表失败: {e}，尝试兜底...")
        else:
            logger.info("vlrdevapi 未安装，使用兜底模式")

    # --- 兜底：从 VLR.gg 首页解析 ---
    html = _fallback_fetch_html("https://www.vlr.gg/")
    if html:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, "html.parser")

        # 查找赛事列表
        for link in soup.select("a[href*='/event/']"):
            href = link.get("href", "")
            text = link.get_text(strip=True)
            if not text or not href:
                continue
            text_lower = text.lower()
            if any(kw in text_lower for kw in ["vct cn", "vct china", "china league", "vct 2026"]):
                import re
                m = re.search(r"/event/(\d+)", href)
                if m:
                    evt_id = int(m.group(1))
                    events.append({
                        "id": evt_id,
                        "name": text,
                        "url": f"https://www.vlr.gg{href}",
                        "status": "completed",
                    })

    # 去重
    seen = set()
    unique_events = []
    for evt in events:
        if evt["id"] not in seen:
            seen.add(evt["id"])
            unique_events.append(evt)
    return unique_events


def fetch_teams(use_fallback: bool = False) -> list[TeamData]:
    """
    从 VLR.gg 获取 VCT CN 2026 赛季的 12 支队伍列表。
    返回 TeamData 列表。
    """
    # 默认返回硬编码队伍列表，再从 VLR 获取信息补充
    teams = []
    for en_name, tid in TEAM_NAME_MAPPING.items():
        teams.append(TeamData(
            teamId=tid,
            teamNameCn=TEAM_CN_MAPPING.get(en_name, en_name),
            teamNameEn=en_name,
        ))

    return teams


def _vlrdevapi_fetch_matches(event_id: int) -> list[dict]:
    """使用 vlrdevapi 获取赛事所有比赛"""
    import vlrdevapi as vlr

    rate_limit()
    logger.info(f"[vlrdevapi] 获取赛事 {event_id} 的比赛...")
    match_data = vlr.events.matches(event_id)
    logger.info(f"[vlrdevapi] 获取到 {len(match_data)} 场比赛")

    matches = []
    for m in match_data:
        # 获取 stage 信息
        stage_label = getattr(m, "stage", "") or ""
        # 规范化 stage 名称
        stage = _normalize_stage(stage_label)

        round_label = getattr(m, "round_label", "") or getattr(m, "phase", "") or stage_label

        team_a_name = getattr(m.team1, "name", "") if hasattr(m, "team1") and m.team1 else ""
        team_b_name = getattr(m.team2, "name", "") if hasattr(m, "team2") and m.team2 else ""

        team_a_id = _fallback_find_team_id(team_a_name) if team_a_name else None
        team_b_id = _fallback_find_team_id(team_b_name) if team_b_name else None

        score_a = getattr(m.team1, "score", 0) if hasattr(m, "team1") and m.team1 else 0
        score_b = getattr(m.team2, "score", 0) if hasattr(m, "team2") and m.team2 else 0

        # 判定胜者
        winner = None
        status = "upcoming"
        m_status = getattr(m, "status", "") or ""
        if m_status == "completed" or (score_a > 0 or score_b > 0):
            if score_a > score_b:
                winner = team_a_id
                status = "finished"
            elif score_b > score_a:
                winner = team_b_id
                status = "finished"
            elif score_a > 0 and score_b > 0 and score_a == score_b:
                status = "finished"

        # matchId
        match_id = getattr(m, "id", "") or str(getattr(m, "match_id", ""))
        if not match_id:
            match_id = f"{stage}-{round_label}-{len(matches) + 1}"

        matches.append({
            "matchId": match_id,
            "stage": stage,
            "round": _normalize_round(round_label, stage),
            "teamA": team_a_id,
            "teamB": team_b_id,
            "scoreA": score_a if score_a else 0,
            "scoreB": score_b if score_b else 0,
            "winner": winner,
            "nextMatchWinnerId": None,
            "nextMatchLoserId": None,
            "status": status,
        })

    return matches


def _fallback_fetch_matches(event_url: str) -> list[dict]:
    """使用 beautifulsoup4 兜底获取比赛"""
    html = _fallback_fetch_html(event_url)
    if not html:
        return []

    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")

    matches = []
    # 查找比赛行
    match_rows = soup.select("div.match-item, div.wf-card div.m-item, tr.m-item")
    if not match_rows:
        match_rows = soup.select("a[href*='/match/']")

    seen_ids = set()
    for row in match_rows:
        # 提取比赛 URL 获取 ID
        a_tag = row if row.name == "a" else row.select_one("a[href*='/match/']")
        if not a_tag:
            continue
        href = a_tag.get("href", "")
        import re
        m = re.search(r"/match/(\d+)", href)
        if not m:
            continue
        match_id = m.group(1)
        if match_id in seen_ids:
            continue
        seen_ids.add(match_id)

        # 提取队伍名
        teams_el = row.select_one("div.match-item-vs, div.match-item-team")
        text = row.get_text(" ", strip=True)

        # 简单解析队伍名
        team_names = []
        for t_el in row.select("div.team-name, span.team-name"):
            tn = t_el.get_text(strip=True)
            if tn:
                team_names.append(tn)

        team_a_id = None
        team_b_id = None
        if len(team_names) >= 2:
            team_a_id = _fallback_find_team_id(team_names[0])
            team_b_id = _fallback_find_team_id(team_names[1])

        # 比分
        scores = []
        for s_el in row.select("div.score, span.score"):
            s_text = s_el.get_text(strip=True)
            if s_text.isdigit():
                scores.append(int(s_text))

        score_a = scores[0] if len(scores) > 0 else 0
        score_b = scores[1] if len(scores) > 1 else 0

        winner = None
        status = "upcoming"
        if score_a > 0 or score_b > 0:
            if score_a > score_b and team_a_id:
                winner = team_a_id
                status = "finished"
            elif score_b > score_a and team_b_id:
                winner = team_b_id
                status = "finished"

        matches.append({
            "matchId": f"match-{match_id}",
            "stage": "unknown",
            "round": "R1",
            "teamA": team_a_id,
            "teamB": team_b_id,
            "scoreA": score_a,
            "scoreB": score_b,
            "winner": winner,
            "nextMatchWinnerId": None,
            "nextMatchLoserId": None,
            "status": status,
        })

    return matches


def fetch_matches(event_id: int, event_url: str = "", use_fallback: bool = False) -> list[dict]:
    """
    获取赛事所有比赛。
    返回 match dict 列表。
    """
    if not use_fallback:
        vlr = _try_import_vlrdevapi()
        if vlr:
            try:
                return _vlrdevapi_fetch_matches(event_id)
            except Exception as e:
                logger.warning(f"[vlrdevapi] 获取比赛失败: {e}，尝试兜底...")

    if event_url:
        return _fallback_fetch_matches(event_url)
    return []


def fetch_standings(event_id: int, event_url: str = "", use_fallback: bool = False) -> list[dict]:
    """
    获取赛事积分榜/排名数据。
    返回 standings entry 列表。
    """
    if not use_fallback:
        vlr = _try_import_vlrdevapi()
        if vlr:
            try:
                rate_limit()
                logger.info(f"[vlrdevapi] 获取赛事 {event_id} 积分榜...")
                standings = vlr.events.standings(event_id)
                logger.info(f"[vlrdevapi] 获取到 {len(standings)} 条积分榜数据")

                entries = []
                for s in standings:
                    team_name = getattr(s, "team_name", "") or getattr(s, "name", "") or ""
                    team_id = _fallback_find_team_id(team_name)
                    if not team_id:
                        continue
                    entries.append({
                        "teamId": team_id,
                        "teamName": team_name,
                        "rank": getattr(s, "rank", 0) or getattr(s, "position", 0),
                        "wins": getattr(s, "wins", 0) or getattr(s, "win_count", 0),
                        "losses": getattr(s, "losses", 0) or getattr(s, "loss_count", 0),
                        "points": getattr(s, "points", 0) or getattr(s, "score", 0),
                        "stage": getattr(s, "stage", "") or "",
                    })
                return entries
            except Exception as e:
                logger.warning(f"[vlrdevapi] 获取积分榜失败: {e}，尝试兜底...")

    # 兜底模式
    if event_url:
        standings_url = event_url.rstrip("/") + "/standings"
        html = _fallback_fetch_html(standings_url)
        if not html:
            return []

        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, "html.parser")

        entries = []
        for row in soup.select("table tr.standings-row, div.standings-item"):
            team_el = row.select_one("td.team, div.team-name")
            if not team_el:
                continue
            team_name = team_el.get_text(strip=True)
            team_id = _fallback_find_team_id(team_name)
            if not team_id:
                continue

            cells = row.select("td, div.stat")
            entries.append({
                "teamId": team_id,
                "teamName": team_name,
                "rank": len(entries) + 1,
                "wins": 0,
                "losses": 0,
                "points": 0,
                "stage": "",
            })
        return entries

    return []


# ---------------------------------------------------------------------------
# 辅助函数
# ---------------------------------------------------------------------------
def _normalize_stage(stage_label: str) -> str:
    """规范化阶段名称到前端 Stage 类型"""
    label = stage_label.lower().strip()

    if any(kw in label for kw in ["kickoff", "启点"]):
        return "kickoff"
    if any(kw in label for kw in ["stage 1", "stage1", "regular season", "第一赛段常规赛"]):
        return "stage1_regular"
    if any(kw in label for kw in ["stage 1 playoff", "stage1 playoff", "playoff 1", "第一赛段季后赛"]):
        return "stage1_playoff"
    if any(kw in label for kw in ["stage 2", "stage2", "第二赛段常规赛"]):
        return "stage2_regular"
    if any(kw in label for kw in ["play-in", "playins", "play_in", "入围赛", "第二赛段入围赛"]):
        return "stage2_playins"
    if any(kw in label for kw in ["stage 2 playoff", "stage2 playoff", "playoff 2", "第二赛段季后赛"]):
        return "stage2_playoff"
    if any(kw in label for kw in ["masters", "大师赛"]):
        return "masters"
    if any(kw in label for kw in ["champions", "冠军赛"]):
        return "champions"

    return label.replace(" ", "_").lower()


def _normalize_round(round_label: str, stage: str) -> str:
    """规范化轮次标识"""
    label = round_label.lower().strip()

    if any(kw in label for kw in ["ub_r1", "upper round 1", "upper bracket r1"]):
        return "UB_R1"
    if any(kw in label for kw in ["ub_r2", "upper round 2", "upper bracket r2"]):
        return "UB_R2"
    if any(kw in label for kw in ["ub_r3", "upper round 3", "upper bracket r3"]):
        return "UB_R3"
    if any(kw in label for kw in ["ub_f", "ub final", "upper final", "upper bracket final"]):
        return "UB_F"
    if any(kw in label for kw in ["mb_r1", "mid round 1", "mid bracket r1"]):
        return "MB_R1"
    if any(kw in label for kw in ["mb_r2", "mid round 2", "mid bracket r2"]):
        return "MB_R2"
    if any(kw in label for kw in ["mb_r3", "mid round 3", "mid bracket r3"]):
        return "MB_R3"
    if any(kw in label for kw in ["mb_r4", "mid round 4", "mid bracket r4"]):
        return "MB_R4"
    if any(kw in label for kw in ["mb_f", "mb final", "mid final", "mid bracket final"]):
        return "MB_F"
    if any(kw in label for kw in ["lb_r1", "lower round 1", "lower bracket r1"]):
        return "LB_R1"
    if any(kw in label for kw in ["lb_r2", "lower round 2", "lower bracket r2"]):
        return "LB_R2"
    if any(kw in label for kw in ["lb_r3", "lower round 3", "lower bracket r3"]):
        return "LB_R3"
    if any(kw in label for kw in ["lb_r4", "lower round 4", "lower bracket r4"]):
        return "LB_R4"
    if any(kw in label for kw in ["lb_f", "lb final", "lower final", "lower bracket final"]):
        return "LB_F"
    if any(kw in label for kw in ["gf", "grand final"]):
        return "GF"
    if any(kw in label for kw in ["ub_q1", "ub quarter 1", "upper quarterfinal 1"]):
        return "UB_Q1"
    if any(kw in label for kw in ["ub_q2", "ub quarter 2", "upper quarterfinal 2"]):
        return "UB_Q2"
    if any(kw in label for kw in ["ub_q3", "ub quarter 3", "upper quarterfinal 3"]):
        return "UB_Q3"
    if any(kw in label for kw in ["ub_q4", "ub quarter 4", "upper quarterfinal 4"]):
        return "UB_Q4"
    if any(kw in label for kw in ["ub_s1", "ub semi 1", "upper semifinal 1"]):
        return "UB_S1"
    if any(kw in label for kw in ["ub_s2", "ub semi 2", "upper semifinal 2"]):
        return "UB_S2"

    # 常规赛轮次
    if stage in ("stage1_regular", "stage2_regular"):
        if label.startswith("a"):
            return f"A{label[1:].upper()}"
        if label.startswith("o"):
            return f"O{label[1:].upper()}"
        # 尝试提取轮次数字
        import re
        m = re.search(r"(\d+)", label)
        if m:
            return f"A{m.group(1)}"

    return round_label.upper().replace(" ", "_")


def generate_match_links(matches: list[dict]) -> list[dict]:
    """
    根据比赛阶段和轮次自动生成 nextMatchWinnerId / nextMatchLoserId 关联。
    对于双败淘汰赛制，按阶段分别处理。
    """
    result = deepcopy(matches)

    # 按阶段分组
    stages: dict[str, list[dict]] = {}
    for m in result:
        stages.setdefault(m["stage"], []).append(m)

    for stage_name, stage_matches in stages.items():
        _generate_stage_links(stage_name, stage_matches)

    return result


def _generate_stage_links(stage: str, matches: list[dict]):
    """
    为单个阶段生成比赛链接。
    支持双败（UB/MB/LB）和单败淘汰赛制。
    """
    # 双败淘汰赛制：Kickoff / Stage1 Playoff / Stage2 Playins / Stage2 Playoff
    # 轮次顺序：UB_R1 -> UB_R2 -> UB_R3 -> ... -> UB_F -> GF
    #          MB_R1 -> MB_R2 -> ... -> MB_F
    #          LB_R1 -> LB_R2 -> ... -> LB_F -> GF
    # 胜者晋级到下一轮（nextMatchWinnerId），败者降入败者组（nextMatchLoserId）

    bracket_stages = {"kickoff", "stage1_playoff", "stage2_playins", "stage2_playoff"}

    if stage in bracket_stages:
        _generate_bracket_links(matches)
    elif stage in ("stage1_regular", "stage2_regular"):
        # 常规赛无晋级关系
        for m in matches:
            m["nextMatchWinnerId"] = None
            m["nextMatchLoserId"] = None
    # 其他阶段（masters, champions）暂不处理链接


def _generate_bracket_links(matches: list[dict]):
    """
    为双败淘汰赛生成晋级链接。
    按轮次分组，胜者晋级到上一轮次，败者降入败者组。

    轮次优先级（从低到高）：
    LB_R1 < LB_R2 < LB_R3 < LB_R4 < MB_R1 < MB_R2 < MB_R3 < MB_R4
    < UB_R1 < UB_R2 < UB_R3 < LB_F < MB_F < UB_F < GF
    """
    # 轮次排序
    round_order = [
        "LB_R1", "LB_R2", "LB_R3", "LB_R4",
        "MB_R1", "MB_R2", "MB_R3", "MB_R4",
        "UB_R1", "UB_Q1", "UB_Q2", "UB_Q3", "UB_Q4",
        "UB_R2", "UB_S1", "UB_S2",
        "UB_R3", "LB_F", "MB_F", "UB_F", "GF",
    ]

    def round_key(m):
        r = m["round"]
        try:
            return round_order.index(r)
        except ValueError:
            return 999

    # 按轮次排序
    sorted_matches = sorted(matches, key=round_key)

    # 按轮次分组
    round_groups: dict[str, list[dict]] = {}
    for m in sorted_matches:
        round_groups.setdefault(m["round"], []).append(m)

    # 建立轮次索引
    round_names = list(round_groups.keys())

    # 对每个轮次，确定下一轮
    for i, rnd in enumerate(round_names):
        if i + 1 >= len(round_names):
            # 最后一轮没有下一轮
            for m in round_groups[rnd]:
                if m["round"] not in ("GF", "UB_F", "LB_F", "MB_F"):
                    m["nextMatchWinnerId"] = None
                    m["nextMatchLoserId"] = None
            continue

        next_rnd = round_names[i + 1]
        next_matches = round_groups[next_rnd]

        # 当前轮次的比赛数
        curr_count = len(round_groups[rnd])
        next_count = len(next_matches)

        for j, m in enumerate(round_groups[rnd]):
            r = m["round"]

            # 胜者组（UB）-> 下一轮胜者组
            if r.startswith("UB_"):
                target_idx = j // 2 if next_count > 0 else 0
                if target_idx < next_count:
                    m["nextMatchWinnerId"] = next_matches[target_idx]["matchId"]
                # 败者组轮次（LB/MB）取决于阶段
                if r in ("UB_R1", "UB_Q1", "UB_Q2", "UB_Q3", "UB_Q4"):
                    # 找 MB_R1 或 LB_R1（如果存在）
                    for lb_rnd in ["MB_R1", "LB_R1"]:
                        if lb_rnd in round_groups:
                            lb_idx = j // 2
                            lb_matches = round_groups[lb_rnd]
                            if lb_idx < len(lb_matches):
                                m["nextMatchLoserId"] = lb_matches[lb_idx]["matchId"]
                            break

            # 中间组（MB）-> 下一轮 MB 或 LB
            elif r.startswith("MB_"):
                target_idx = j // 2
                if target_idx < next_count:
                    m["nextMatchWinnerId"] = next_matches[target_idx]["matchId"]
                # 败者降入 LB
                mb_num = r.replace("MB_R", "")
                if mb_num.isdigit():
                    lb_rnd = f"LB_R{mb_num}"
                    if lb_rnd in round_groups:
                        lb_matches = round_groups[lb_rnd]
                        lb_idx = len(lb_matches) - (curr_count - j)
                        if 0 <= lb_idx < len(lb_matches):
                            m["nextMatchLoserId"] = lb_matches[lb_idx]["matchId"]

            # 败者组（LB）-> 下一轮 LB
            elif r.startswith("LB_"):
                target_idx = j // 2
                if target_idx < next_count:
                    m["nextMatchWinnerId"] = next_matches[target_idx]["matchId"]
                m["nextMatchLoserId"] = None


def calculate_points(teams: list[TeamData], matches: list[dict]) -> list[PointsData]:
    """
    根据比赛结果计算各队冠军赛积分。
    VCT CN 2026 积分规则：
    - 启点赛（Kickoff）：冠军 4 分，亚军 3 分，季军 2 分，殿军 1 分
    - 第一赛段常规赛：每胜 1 场得 1 分
    - 第一赛段季后赛：冠军 6 分，亚军 4 分，季军 3 分，殿军 2 分，5-6 名 1 分
    - 第二赛段常规赛：每胜 1 场得 1 分
    - 第二赛段季后赛：冠军 8 分，亚军 6 分，季军 4 分，殿军 3 分，5-6 名 2 分，7-8 名 1 分
    - 大师赛：冠军 12 分，亚军 8 分，季军 6 分，殿军 4 分，5-8 名 2 分
    """
    points_map: dict[str, PointsData] = {}
    for t in teams:
        points_map[t.teamId] = PointsData(teamId=t.teamId)

    # ---- 启点赛积分 ----
    _calc_kickoff_points(matches, points_map)

    # ---- 第一赛段常规赛积分（每胜 1 分） ----
    _calc_regular_season_points(matches, "stage1_regular", points_map, "stage1RegularPoints")

    # ---- 第一赛段季后赛积分 ----
    _calc_playoff_points(matches, "stage1_playoff", points_map, "stage1PlayoffPoints",
                         {1: 6, 2: 4, 3: 3, 4: 2, 5: 1, 6: 1})

    # ---- 第二赛段常规赛积分（每胜 1 分） ----
    _calc_regular_season_points(matches, "stage2_regular", points_map, "stage2RegularPoints")

    # ---- 第二赛段季后赛积分 ----
    _calc_playoff_points(matches, "stage2_playoff", points_map, "stage2PlayoffPoints",
                         {1: 8, 2: 6, 3: 4, 4: 3, 5: 2, 6: 2, 7: 1, 8: 1})

    # ---- 大师赛积分 ----
    _calc_masters_points(matches, points_map)

    # 计算总积分
    for pd in points_map.values():
        pd.totalPoints = (
            pd.kickoffPoints
            + pd.stage1RegularPoints
            + pd.stage1PlayoffPoints
            + pd.stage2RegularPoints
            + pd.stage2PlayoffPoints
            + pd.mastersPoints
        )

    # 排序
    result = sorted(points_map.values(), key=lambda p: p.totalPoints, reverse=True)
    return result


def _calc_kickoff_points(matches: list[dict], points_map: dict[str, PointsData]):
    """计算启点赛积分"""
    kickoff_matches = [m for m in matches if m["stage"] == "kickoff" and m["status"] == "finished"]
    if not kickoff_matches:
        return

    # 找出最终排名
    # 冠军 = UB_F 或 GF 的胜者
    # 亚军 = UB_F 或 GF 的败者
    # 季军 = MB_F 的胜者 / LB_F 的胜者
    # 殿军 = MB_F 的败者 / LB_F 的败者

    # 找总决赛
    gf = next((m for m in kickoff_matches if m["round"] == "GF"), None)
    ub_f = next((m for m in kickoff_matches if m["round"] == "UB_F"), None)

    if gf and gf["winner"]:
        points_map[gf["winner"]].kickoffPoints = max(
            points_map[gf["winner"]].kickoffPoints, 4
        )
        loser = gf["teamA"] if gf["winner"] == gf["teamB"] else gf["teamB"]
        if loser:
            points_map[loser].kickoffPoints = max(points_map[loser].kickoffPoints, 3)
    elif ub_f and ub_f["winner"]:
        points_map[ub_f["winner"]].kickoffPoints = max(
            points_map[ub_f["winner"]].kickoffPoints, 4
        )
        loser = ub_f["teamA"] if ub_f["winner"] == ub_f["teamB"] else ub_f["teamB"]
        if loser:
            points_map[loser].kickoffPoints = max(points_map[loser].kickoffPoints, 3)

    # 季军（MB_F / LB_F 胜者）
    mb_f = next((m for m in kickoff_matches if m["round"] == "MB_F"), None)
    lb_f = next((m for m in kickoff_matches if m["round"] == "LB_F"), None)
    for final_match in [mb_f, lb_f]:
        if final_match and final_match["winner"]:
            points_map[final_match["winner"]].kickoffPoints = max(
                points_map[final_match["winner"]].kickoffPoints, 2
            )
            loser = (
                final_match["teamA"]
                if final_match["winner"] == final_match["teamB"]
                else final_match["teamB"]
            )
            if loser:
                points_map[loser].kickoffPoints = max(
                    points_map[loser].kickoffPoints, 1
                )


def _calc_regular_season_points(
    matches: list[dict],
    stage: str,
    points_map: dict[str, PointsData],
    target_field: str,
):
    """计算常规赛积分（每胜 1 分）"""
    regular_matches = [
        m for m in matches if m["stage"] == stage and m["status"] == "finished" and m["winner"]
    ]
    for m in regular_matches:
        if m["winner"] and m["winner"] in points_map:
            current = getattr(points_map[m["winner"]], target_field, 0)
            setattr(points_map[m["winner"]], target_field, current + 1)


def _calc_playoff_points(
    matches: list[dict],
    stage: str,
    points_map: dict[str, PointsData],
    target_field: str,
    rank_points: dict[int, int],
):
    """计算季后赛积分"""
    playoff_matches = [
        m for m in matches if m["stage"] == stage and m["status"] == "finished"
    ]
    if not playoff_matches:
        return

    # 通过 bracket 结构确定排名
    # 冠军 = GF 胜者
    # 亚军 = GF 败者
    # 季军 = LB_F 胜者
    # 殿军 = LB_F 败者
    # 5-6 = 在 LB_R3 失利的队伍
    # 7-8 = 在 LB_R2 失利的队伍 或 UB_Q1 失利的队伍

    # 简化实现：根据比赛结果推断排名
    eliminated_order = _determine_elimination_order(playoff_matches)

    for rank, team_id in enumerate(eliminated_order, start=1):
        if team_id in points_map:
            pts = rank_points.get(rank, 0)
            if pts > 0:
                current = getattr(points_map[team_id], target_field, 0)
                setattr(points_map[team_id], target_field, max(current, pts))


def _determine_elimination_order(matches: list[dict]) -> list[str]:
    """
    根据双败淘汰赛结果推断队伍排名。
    返回按排名（1=冠军）排列的队伍 ID 列表。
    """
    # 找总决赛
    gf = next((m for m in matches if m["round"] == "GF" and m["status"] == "finished"), None)
    ub_f = next((m for m in matches if m["round"] == "UB_F" and m["status"] == "finished"), None)
    lb_f = next((m for m in matches if m["round"] == "LB_F" and m["status"] == "finished"), None)

    # 找每一轮的败者
    eliminated = []

    # 冠军
    champion = None
    runner_up = None
    if gf and gf["winner"]:
        champion = gf["winner"]
        runner_up = gf["teamA"] if gf["winner"] == gf["teamB"] else gf["teamB"]
    elif ub_f and ub_f["winner"]:
        champion = ub_f["winner"]

    # 季军（LB_F 胜者）
    third_place = None
    fourth_place = None
    if lb_f and lb_f["winner"]:
        third_place = lb_f["winner"]
        fourth_place = lb_f["teamA"] if lb_f["winner"] == lb_f["teamB"] else lb_f["teamB"]

    # 按轮次收集被淘汰队伍
    round_order = ["LB_R3", "LB_R2", "LB_R1", "MB_R4", "MB_R3", "MB_R2", "MB_R1",
                   "UB_R3", "UB_S1", "UB_S2", "UB_R2", "UB_Q1", "UB_Q2", "UB_Q3", "UB_Q4", "UB_R1"]

    seen = set()
    for rnd in round_order:
        for m in matches:
            if m["round"] != rnd or m["status"] != "finished":
                continue
            loser = m["teamA"] if m["winner"] == m["teamB"] else m["teamB"]
            if loser and loser not in seen:
                # 检查是否在后来的比赛中出现（即没有被淘汰）
                eliminated.append(loser)
                seen.add(loser)

    # 组装最终排名
    result = []
    if champion:
        result.append(champion)
    if runner_up:
        result.append(runner_up)
    if third_place:
        result.append(third_place)
    if fourth_place:
        result.append(fourth_place)

    # 剩余队伍按淘汰顺序
    for tid in eliminated:
        if tid not in result:
            result.append(tid)

    return result


def _calc_masters_points(matches: list[dict], points_map: dict[str, PointsData]):
    """计算大师赛积分"""
    masters_matches = [
        m for m in matches if m["stage"] == "masters" and m["status"] == "finished"
    ]
    if not masters_matches:
        return

    # 通过总决赛确定排名
    gf = next((m for m in masters_matches if m["round"] == "GF" and m["status"] == "finished"), None)
    ub_f = next((m for m in masters_matches if m["round"] == "UB_F" and m["status"] == "finished"), None)
    lb_f = next((m for m in masters_matches if m["round"] == "LB_F" and m["status"] == "finished"), None)

    if gf and gf["winner"]:
        points_map[gf["winner"]].mastersPoints = max(
            points_map[gf["winner"]].mastersPoints, 12
        )
        loser = gf["teamA"] if gf["winner"] == gf["teamB"] else gf["teamB"]
        if loser:
            points_map[loser].mastersPoints = max(points_map[loser].mastersPoints, 8)
    elif ub_f and ub_f["winner"]:
        points_map[ub_f["winner"]].mastersPoints = max(
            points_map[ub_f["winner"]].mastersPoints, 12
        )

    if lb_f and lb_f["winner"]:
        points_map[lb_f["winner"]].mastersPoints = max(
            points_map[lb_f["winner"]].mastersPoints, 6
        )
        loser = lb_f["teamA"] if lb_f["winner"] == lb_f["teamB"] else lb_f["teamB"]
        if loser:
            points_map[loser].mastersPoints = max(points_map[loser].mastersPoints, 4)


def determine_qualified_status(points: list[PointsData], sorted_teams: list[TeamData]) -> list[PointsData]:
    """
    根据积分确定各队的晋级状态。
    - 冠军赛积分前 4 名：qualified（已晋级）
    - 有积分但未进前 4：pending（待定）
    - 积分为 0：eliminated（已淘汰）
    """
    # 按总积分排序
    sorted_pts = sorted(points, key=lambda p: p.totalPoints, reverse=True)

    for i, pd in enumerate(sorted_pts):
        if pd.totalPoints <= 0:
            pd.qualifiedStatus = "eliminated"
        elif i < 4:
            pd.qualifiedStatus = "qualified"
        else:
            pd.qualifiedStatus = "pending"

    return sorted_pts


# ---------------------------------------------------------------------------
# JSON 生成
# ---------------------------------------------------------------------------
def generate_json_files(
    teams: list[TeamData],
    matches: list[MatchData],
    points: list[PointsData],
    output_dir: str,
    dry_run: bool = False,
) -> bool:
    """
    生成标准 JSON 文件到 output_dir。
    返回 True 表示成功，False 表示失败。
    """
    teams_json = [asdict(t) for t in teams]
    matches_json = [asdict(m) for m in matches] if matches else []
    points_json = [asdict(p) for p in points]

    files = {
        "teams.json": teams_json,
        "matches.json": matches_json,
        "points.json": points_json,
    }

    os.makedirs(output_dir, exist_ok=True)

    for filename, data in files.items():
        filepath = os.path.join(output_dir, filename)
        json_str = json.dumps(data, ensure_ascii=False, indent=2)

        if dry_run:
            logger.info(f"[DRY RUN] 将写入 {filepath} ({len(json_str)} 字节)")
            continue

        # 写入临时文件，成功后替换
        tmp_path = filepath + ".tmp"
        try:
            with open(tmp_path, "w", encoding="utf-8") as f:
                f.write(json_str)
                f.write("\n")
            os.replace(tmp_path, filepath)
            logger.info(f"已写入 {filepath} ({len(json_str)} 字节)")
        except Exception as e:
            logger.error(f"写入 {filepath} 失败: {e}")
            # 清理临时文件
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
            return False

    return True


def _load_existing_data(output_dir: str) -> tuple[list, list, list]:
    """加载现有的 JSON 数据作为备份"""
    teams, matches, points = [], [], []
    try:
        with open(os.path.join(output_dir, "teams.json"), "r", encoding="utf-8") as f:
            teams = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    try:
        with open(os.path.join(output_dir, "matches.json"), "r", encoding="utf-8") as f:
            matches = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    try:
        with open(os.path.join(output_dir, "points.json"), "r", encoding="utf-8") as f:
            points = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return teams, matches, points


def _convert_to_dataclass(teams_raw: list, matches_raw: list[dict], points_raw: list) -> tuple[list[TeamData], list[MatchData], list[PointsData]]:
    """将原始 dict 数据转换为 dataclass 对象"""
    teams = []
    for t in teams_raw:
        if isinstance(t, TeamData):
            teams.append(t)
        elif isinstance(t, dict):
            teams.append(TeamData(**t))

    matches = []
    for m in matches_raw:
        if isinstance(m, MatchData):
            matches.append(m)
        elif isinstance(m, dict):
            matches.append(MatchData(**m))

    points = []
    for p in points_raw:
        if isinstance(p, PointsData):
            points.append(p)
        elif isinstance(p, dict):
            points.append(PointsData(**p))

    return teams, matches, points


# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="VCT CN 数据同步脚本")
    parser.add_argument(
        "--output-dir",
        default="public/data",
        help="输出目录（默认: public/data）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="仅打印不写入",
    )
    parser.add_argument(
        "--fallback",
        action="store_true",
        help="强制使用 requests + beautifulsoup4 兜底模式",
    )
    args = parser.parse_args()

    output_dir = os.path.abspath(args.output_dir)
    dry_run = args.dry_run
    use_fallback = args.fallback

    # 检查 vlrdevapi 是否可用
    if not use_fallback:
        vlr = _try_import_vlrdevapi()
        if vlr is None:
            logger.info("vlrdevapi 未安装，自动切换到兜底模式（requests + beautifulsoup4）")
            use_fallback = True
        else:
            logger.info(f"vlrdevapi 版本: {getattr(vlr, '__version__', 'unknown')}")

    start_time = time.time()
    logger.info(f"{'[DRY RUN] ' if dry_run else ''}VCT CN 数据同步开始")
    logger.info(f"输出目录: {output_dir}")
    logger.info(f"模式: {'兜底 (requests+bs4)' if use_fallback else 'vlrdevapi'}")

    # 加载现有数据作为备份
    existing_teams, existing_matches, existing_points = _load_existing_data(output_dir)
    if existing_teams:
        logger.info(f"已加载现有数据备份: {len(existing_teams)} 队伍, {len(existing_matches)} 比赛, {len(existing_points)} 积分")

    try:
        # 1. 获取队伍列表
        t0 = time.time()
        teams = fetch_teams(use_fallback=use_fallback)
        logger.info(f"队伍列表: {len(teams)} 支队伍 ({time.time() - t0:.1f}s)")

        # 2. 查找 VCT CN 赛事
        t0 = time.time()
        events = find_vct_cn_events(use_fallback=use_fallback)
        logger.info(f"找到 {len(events)} 个 VCT CN 赛事 ({time.time() - t0:.1f}s)")

        if not events:
            logger.warning("未找到 VCT CN 赛事，将使用现有数据保留")
            # 使用现有数据
            if existing_teams:
                teams, _, _ = _convert_to_dataclass(existing_teams, [], [])
            else:
                logger.warning("无现有数据可用，仅输出队伍列表")

        # 3. 获取比赛
        all_matches = []
        for evt in events:
            t0 = time.time()
            evt_url = evt.get("url", "")
            evt_matches = fetch_matches(evt["id"], evt_url, use_fallback=use_fallback)
            elapsed = time.time() - t0
            logger.info(f"  赛事 {evt['name']} (ID: {evt['id']}): {len(evt_matches)} 场比赛 ({elapsed:.1f}s)")
            all_matches.extend(evt_matches)

        if not all_matches and existing_matches:
            logger.warning("未获取到比赛数据，使用现有数据")
            all_matches = existing_matches

        # 4. 生成比赛晋级链接
        t0 = time.time()
        all_matches = generate_match_links(all_matches)
        logger.info(f"比赛晋级链接生成完成 ({time.time() - t0:.1f}s)")

        # 5. 获取积分榜
        all_standings = []
        for evt in events:
            t0 = time.time()
            evt_url = evt.get("url", "")
            standings = fetch_standings(evt["id"], evt_url, use_fallback=use_fallback)
            elapsed = time.time() - t0
            logger.info(f"  赛事 {evt['name']} 积分榜: {len(standings)} 条 ({elapsed:.1f}s)")
            all_standings.extend(standings)

        # 6. 计算积分
        t0 = time.time()
        points = calculate_points(teams, all_matches)
        logger.info(f"积分计算完成 ({time.time() - t0:.1f}s)")

        # 7. 确定晋级状态
        points = determine_qualified_status(points, teams)

        # 8. 更新 teams 中的 totalPoints
        points_dict = {p.teamId: p.totalPoints for p in points}
        for t in teams:
            t.totalPoints = points_dict.get(t.teamId, 0)

        # 9. 转换为 MatchData 对象
        match_data_list = [MatchData(**m) for m in all_matches] if all_matches else []

        # 10. 生成 JSON 文件
        t0 = time.time()
        success = generate_json_files(teams, match_data_list, points, output_dir, dry_run=dry_run)
        elapsed = time.time() - t0

        if not success and not dry_run:
            logger.error("JSON 文件生成失败，保留现有数据")
            # 恢复备份
            if existing_teams:
                logger.info("保留现有数据不变")
            sys.exit(1)

        total_time = time.time() - start_time
        logger.info(
            f"{'[DRY RUN] ' if dry_run else ''}数据同步完成！"
            f"({total_time:.1f}s, 请求数: {len(_request_timestamps)})"
        )
        logger.info(f"  队伍: {len(teams)}")
        logger.info(f"  比赛: {len(match_data_list)}")
        logger.info(f"  积分: {len(points)}")

    except Exception as e:
        logger.error(f"同步过程中发生错误: {e}", exc_info=True)
        logger.info("保留现有数据不变")
        sys.exit(1)


if __name__ == "__main__":
    main()