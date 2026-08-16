<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import type { BracketData, BracketRound } from '@/types/bracket'
import type { Team } from '@/types/team'

const props = defineProps<{
  bracketData: BracketData
  bracketType: 'double' | 'triple'
  teams: Team[]
}>()

// ── Layout constants ──────────────────────────────────────────
const CARD_W = 200
const CARD_H = 70
const H_GAP = 100
const V_GAP = 12
const SECTION_GAP = 60
const PADDING = 30

// ── Zoom / Pan state ──────────────────────────────────────────
const scale = ref(1)
const panX = ref(0)
const panY = ref(0)
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const containerRef = ref<HTMLElement | null>(null)

// ── Team lookup ───────────────────────────────────────────────
const teamMap = computed(() => {
  const map = new Map<string, Team>()
  for (const t of props.teams) {
    map.set(t.teamId, t)
  }
  return map
})

// ── Layout calculation ────────────────────────────────────────
interface LayoutMatch {
  matchId: string
  round: string
  x: number
  y: number
  teamA: string | null
  teamB: string | null
  scoreA: number
  scoreB: number
  winner: string | null
  status: string
  seedA?: number
  seedB?: number
}

interface LayoutSection {
  label: string
  rounds: {
    roundName: string
    x: number
    matches: LayoutMatch[]
  }[]
  sectionTop: number
  sectionHeight: number
}

interface ConnectionLine {
  path: string
}

function buildSectionLayout(
  rounds: BracketRound[],
  startX: number,
  startY: number,
): LayoutSection {
  let maxMatches = 0
  for (const r of rounds) {
    if (r.matches.length > maxMatches) maxMatches = r.matches.length
  }

  const sectionHeight = maxMatches * (CARD_H + V_GAP) - V_GAP
  const roundLayouts: LayoutSection['rounds'] = []

  for (let ri = 0; ri < rounds.length; ri++) {
    const round = rounds[ri]
    const rx = startX + ri * (CARD_W + H_GAP)
    const numMatches = round.matches.length
    const totalH = numMatches * (CARD_H + V_GAP) - V_GAP
    const offsetY = (sectionHeight - totalH) / 2

    const matchLayouts: LayoutMatch[] = round.matches.map((m, mi) => ({
      matchId: m.matchId,
      round: m.round,
      x: rx,
      y: startY + offsetY + mi * (CARD_H + V_GAP),
      teamA: m.teamA,
      teamB: m.teamB,
      scoreA: m.scoreA,
      scoreB: m.scoreB,
      winner: m.winner,
      status: m.status,
      seedA: m.seedA,
      seedB: m.seedB,
    }))

    roundLayouts.push({ roundName: round.roundName, x: rx, matches: matchLayouts })
  }

  return { label: '', rounds: roundLayouts, sectionTop: startY, sectionHeight }
}

interface OverallLayout {
  sections: LayoutSection[]
  grandFinal: LayoutMatch | null
  svgWidth: number
  svgHeight: number
  lines: ConnectionLine[]
}

const layout = computed<OverallLayout>(() => {
  const sections: LayoutSection[] = []
  let totalRounds = 0
  let cursorY = PADDING

  // Winner bracket
  if (props.bracketData.winnerBracket.length > 0) {
    const sec = buildSectionLayout(
      props.bracketData.winnerBracket,
      PADDING,
      cursorY,
    )
    sec.label = '胜者组'
    sections.push(sec)
    totalRounds = Math.max(totalRounds, props.bracketData.winnerBracket.length)
    cursorY += sec.sectionHeight + SECTION_GAP
  }

  // Middle bracket (triple elimination)
  if (props.bracketData.middleBracket && props.bracketData.middleBracket.length > 0) {
    const sec = buildSectionLayout(
      props.bracketData.middleBracket,
      PADDING,
      cursorY,
    )
    sec.label = '突围组'
    sections.push(sec)
    totalRounds = Math.max(totalRounds, props.bracketData.middleBracket.length)
    cursorY += sec.sectionHeight + SECTION_GAP
  }

  // Loser bracket
  if (props.bracketData.loserBracket.length > 0) {
    const sec = buildSectionLayout(
      props.bracketData.loserBracket,
      PADDING,
      cursorY,
    )
    sec.label = '败者组'
    sections.push(sec)
    totalRounds = Math.max(totalRounds, props.bracketData.loserBracket.length)
    cursorY += sec.sectionHeight + SECTION_GAP
  }

  // Grand Final
  let grandFinal: LayoutMatch | null = null
  if (props.bracketData.grandFinal) {
    const gf = props.bracketData.grandFinal
    const gfX = PADDING + totalRounds * (CARD_W + H_GAP)
    const totalSectionsHeight = sections.reduce((sum, s) => sum + s.sectionHeight, 0)
    const totalGaps = (sections.length - 1) * SECTION_GAP
    const centerY = PADDING + (totalSectionsHeight + totalGaps) / 2

    if (gf.matches.length > 0) {
      const m = gf.matches[0]
      grandFinal = {
        matchId: m.matchId,
        round: m.round,
        x: gfX,
        y: centerY - CARD_H / 2,
        teamA: m.teamA,
        teamB: m.teamB,
        scoreA: m.scoreA,
        scoreB: m.scoreB,
        winner: m.winner,
        status: m.status,
        seedA: m.seedA,
        seedB: m.seedB,
      }
    }
  }

  // SVG dimensions
  const maxSectionWidth = totalRounds * (CARD_W + H_GAP)
  const gfExtra = grandFinal ? CARD_W + H_GAP : 0
  const svgWidth = PADDING * 2 + maxSectionWidth + gfExtra
  const svgHeight = sections.length > 0
    ? cursorY - SECTION_GAP + PADDING
    : PADDING * 2 + CARD_H

  // Connection lines
  const lines: ConnectionLine[] = []
  for (const section of sections) {
    for (let ri = 0; ri < section.rounds.length - 1; ri++) {
      const curRound = section.rounds[ri]
      const nextRound = section.rounds[ri + 1]
      for (let mi = 0; mi < curRound.matches.length; mi++) {
        const match = curRound.matches[mi]
        const nextMatchIndex = Math.floor(mi / 2)
        if (nextMatchIndex < nextRound.matches.length) {
          const nextMatch = nextRound.matches[nextMatchIndex]
          const x1 = match.x + CARD_W
          const y1 = match.y + CARD_H / 2
          const x2 = nextMatch.x
          const y2 = nextMatch.y + CARD_H / 2
          const midX = (x1 + x2) / 2
          const path = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`
          lines.push({ path })
        }
      }
    }
  }

  // Lines from last rounds to Grand Final
  if (grandFinal) {
    const gfX = grandFinal.x
    const gfY = grandFinal.y + CARD_H / 2
    for (const section of sections) {
      const lastRound = section.rounds[section.rounds.length - 1]
      if (!lastRound) continue
      for (const match of lastRound.matches) {
        const x1 = match.x + CARD_W
        const y1 = match.y + CARD_H / 2
        const midX = (x1 + gfX) / 2
        const path = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${gfY} L ${gfX} ${gfY}`
        lines.push({ path })
      }
    }
  }

  return { sections, grandFinal, svgWidth, svgHeight, lines }
})

// ── Round label helper ────────────────────────────────────────
function roundLabel(round: string): string {
  const map: Record<string, string> = {
    UB_R1: '胜者组 R1',
    UB_R2: '胜者组 R2',
    UB_R3: '胜者组 R3',
    UB_R4: '胜者组 R4',
    UB_F: '胜者组决赛',
    MB_R1: '突围组 R1',
    MB_R2: '突围组 R2',
    MB_R3: '突围组 R3',
    MB_R4: '突围组 R4',
    MB_F: '突围组决赛',
    LB_R1: '败者组 R1',
    LB_R2: '败者组 R2',
    LB_R3: '败者组 R3',
    LB_R4: '败者组 R4',
    LB_R5: '败者组 R5',
    LB_F: '败者组决赛',
    GF: '总决赛',
  }
  return map[round] || round
}

// ── Zoom / Pan handlers ───────────────────────────────────────
function onWheel(e: WheelEvent) {
  e.preventDefault()
  const delta = e.deltaY > 0 ? -0.08 : 0.08
  const newScale = Math.min(3, Math.max(0.3, scale.value + delta))
  scale.value = newScale
}

function onMouseDown(e: MouseEvent) {
  isDragging.value = true
  dragStart.value = { x: e.clientX - panX.value, y: e.clientY - panY.value }
}

function onMouseMove(e: MouseEvent) {
  if (!isDragging.value) return
  panX.value = e.clientX - dragStart.value.x
  panY.value = e.clientY - dragStart.value.y
}

function onMouseUp() {
  isDragging.value = false
}

function onTouchStart(e: TouchEvent) {
  if (e.touches.length === 1) {
    isDragging.value = true
    dragStart.value = { x: e.touches[0].clientX - panX.value, y: e.touches[0].clientY - panY.value }
  }
}

function onTouchMove(e: TouchEvent) {
  if (e.touches.length === 1 && isDragging.value) {
    panX.value = e.touches[0].clientX - dragStart.value.x
    panY.value = e.touches[0].clientY - dragStart.value.y
  } else if (e.touches.length === 2) {
    // Pinch zoom
    const t1 = e.touches[0]
    const t2 = e.touches[1]
    const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)
    if (pinchStartDist.value === 0) {
      pinchStartDist.value = dist
      pinchStartScale.value = scale.value
    } else {
      const newScale = Math.min(3, Math.max(0.3, pinchStartScale.value * (dist / pinchStartDist.value)))
      scale.value = newScale
    }
  }
}

const pinchStartDist = ref(0)
const pinchStartScale = ref(1)

function onTouchEnd() {
  isDragging.value = false
  pinchStartDist.value = 0
}

// ── Mobile responsiveness ─────────────────────────────────────
const mobileScale = ref(1)

function updateMobileScale() {
  if (!containerRef.value) return
  const containerWidth = containerRef.value.clientWidth
  const svgWidth = layout.value.svgWidth
  if (svgWidth > 0 && containerWidth > 0) {
    mobileScale.value = Math.min(1, containerWidth / svgWidth)
  }
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  updateMobileScale()
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => updateMobileScale())
    resizeObserver.observe(containerRef.value)
  }
})

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
})

// ── Seed label ────────────────────────────────────────────────
function seedLabel(seed?: number): string {
  if (!seed) return ''
  return seed === 1 ? '#1 种子' : `#${seed} 种子`
}
</script>

<template>
  <div
    ref="containerRef"
    class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
    @wheel.prevent="onWheel"
    @mousedown="onMouseDown"
    @mousemove="onMouseMove"
    @mouseup="onMouseUp"
    @mouseleave="onMouseUp"
    @touchstart.prevent="onTouchStart"
    @touchmove.prevent="onTouchMove"
    @touchend="onTouchEnd"
    :style="{ cursor: isDragging ? 'grabbing' : 'grab' }"
  >
    <svg
      :width="layout.svgWidth * mobileScale * scale"
      :height="layout.svgHeight * mobileScale * scale"
      :viewBox="`0 0 ${layout.svgWidth} ${layout.svgHeight}`"
      class="block"
      :style="{
        transformOrigin: '0 0',
        transform: `scale(${mobileScale * scale})`,
      }"
    >
      <!-- Connection lines -->
      <g v-for="(line, li) in layout.lines" :key="'line-' + li">
        <path
          :d="line.path"
          fill="none"
          stroke="#d1d5db"
          stroke-width="2"
          stroke-linejoin="round"
        />
      </g>

      <!-- Section labels -->
      <g v-for="(section, si) in layout.sections" :key="'section-label-' + si">
        <text
          :x="PADDING"
          :y="section.sectionTop - 6"
          class="fill-gray-500 text-xs font-semibold uppercase tracking-wider"
        >
          {{ section.label }}
        </text>
      </g>

      <!-- Round labels -->
      <template v-for="(section, si) in layout.sections" :key="'section-' + si">
        <g v-for="(round, ri) in section.rounds" :key="'round-label-' + si + '-' + ri">
          <text
            :x="round.x + CARD_W / 2"
            :y="section.sectionTop - 6"
            text-anchor="middle"
            class="fill-gray-400 text-xs"
          >
            {{ roundLabel(round.roundName) }}
          </text>
        </g>
      </template>

      <!-- Grand Final label -->
      <text
        v-if="layout.grandFinal"
        :x="layout.grandFinal.x + CARD_W / 2"
        :y="layout.grandFinal.y - 6"
        text-anchor="middle"
        class="fill-gray-400 text-xs"
      >
        {{ roundLabel(layout.grandFinal.round) }}
      </text>

      <!-- Match cards -->
      <template v-for="(section, si) in layout.sections" :key="'section-matches-' + si">
        <g
          v-for="(match, _mi) in section.rounds.flatMap((r) => r.matches)"
          :key="'match-' + match.matchId"
          class="match-svg"
          @click="$emit('matchClick', match.matchId)"
        >
          <!-- Card background -->
          <rect
            :x="match.x"
            :y="match.y"
            :width="CARD_W"
            :height="CARD_H"
            rx="6"
            class="fill-white"
            :class="{
              'stroke-green-400 stroke-[2]': match.winner !== null,
              'stroke-yellow-400 stroke-[2]': match.status === 'live',
              'stroke-gray-300': match.winner === null && match.status !== 'live',
            }"
          />

          <!-- Round label bar -->
          <rect
            :x="match.x"
            :y="match.y"
            :width="CARD_W"
            :height="20"
            rx="6"
            class="fill-gray-50"
          />
          <rect
            :x="match.x"
            :y="match.y + 14"
            :width="CARD_W"
            :height="6"
            class="fill-gray-50"
          />
          <text
            :x="match.x + 8"
            :y="match.y + 14"
            class="fill-gray-500 text-[11px]"
          >
            {{ roundLabel(match.round) }}
          </text>

          <!-- Live dot -->
          <circle
            v-if="match.status === 'live'"
            :cx="match.x + CARD_W - 10"
            :cy="match.y + 10"
            r="4"
            fill="#ef4444"
            class="animate-pulse"
          />

          <!-- Team A -->
          <text
            :x="match.x + 8"
            :y="match.y + 36"
            class="text-[13px]"
            :class="match.winner === match.teamA ? 'fill-green-700 font-bold' : 'fill-gray-800'"
          >
            {{ teamMap.get(match.teamA ?? '')?.teamNameCn ?? '待定' }}
          </text>
          <text
            :x="match.x + CARD_W - 8"
            :y="match.y + 36"
            text-anchor="end"
            class="text-[13px] font-mono font-bold"
            :class="match.winner === match.teamA ? 'fill-green-700' : 'fill-gray-700'"
          >
            {{ match.scoreA }}
          </text>

          <!-- Seed A -->
          <text
            v-if="match.seedA"
            :x="match.x + 8"
            :y="match.y + 50"
            class="fill-gray-400 text-[10px]"
          >
            {{ seedLabel(match.seedA) }}
          </text>

          <!-- Team B -->
          <text
            :x="match.x + 8"
            :y="match.y + 60"
            class="text-[13px]"
            :class="match.winner === match.teamB ? 'fill-green-700 font-bold' : 'fill-gray-800'"
          >
            {{ teamMap.get(match.teamB ?? '')?.teamNameCn ?? '待定' }}
          </text>
          <text
            :x="match.x + CARD_W - 8"
            :y="match.y + 60"
            text-anchor="end"
            class="text-[13px] font-mono font-bold"
            :class="match.winner === match.teamB ? 'fill-green-700' : 'fill-gray-700'"
          >
            {{ match.scoreB }}
          </text>

          <!-- Seed B -->
          <text
            v-if="match.seedB"
            :x="match.x + 8"
            :y="match.y + 72"
            class="fill-gray-400 text-[10px]"
          >
            {{ seedLabel(match.seedB) }}
          </text>
        </g>
      </template>

      <!-- Grand Final match card -->
      <g
        v-if="layout.grandFinal"
        class="match-svg"
        @click="$emit('matchClick', layout.grandFinal!.matchId)"
      >
        <rect
          :x="layout.grandFinal.x"
          :y="layout.grandFinal.y"
          :width="CARD_W"
          :height="CARD_H"
          rx="6"
          class="fill-white"
          :class="{
            'stroke-amber-500 stroke-[2.5]': true,
            'stroke-yellow-400': layout.grandFinal.status === 'live',
          }"
        />
        <rect
          :x="layout.grandFinal.x"
          :y="layout.grandFinal.y"
          :width="CARD_W"
          :height="20"
          rx="6"
          class="fill-amber-50"
        />
        <rect
          :x="layout.grandFinal.x"
          :y="layout.grandFinal.y + 14"
          :width="CARD_W"
          :height="6"
          class="fill-amber-50"
        />
        <text
          :x="layout.grandFinal.x + 8"
          :y="layout.grandFinal.y + 14"
          class="fill-amber-600 text-[11px] font-bold"
        >
          {{ roundLabel(layout.grandFinal.round) }}
        </text>

        <circle
          v-if="layout.grandFinal.status === 'live'"
          :cx="layout.grandFinal.x + CARD_W - 10"
          :cy="layout.grandFinal.y + 10"
          r="4"
          fill="#ef4444"
          class="animate-pulse"
        />

        <text
          :x="layout.grandFinal.x + 8"
          :y="layout.grandFinal.y + 36"
          class="text-[13px]"
          :class="layout.grandFinal.winner === layout.grandFinal.teamA ? 'fill-green-700 font-bold' : 'fill-gray-800'"
        >
          {{ teamMap.get(layout.grandFinal.teamA ?? '')?.teamNameCn ?? '待定' }}
        </text>
        <text
          :x="layout.grandFinal.x + CARD_W - 8"
          :y="layout.grandFinal.y + 36"
          text-anchor="end"
          class="text-[13px] font-mono font-bold"
          :class="layout.grandFinal.winner === layout.grandFinal.teamA ? 'fill-green-700' : 'fill-gray-700'"
        >
          {{ layout.grandFinal.scoreA }}
        </text>

        <text
          v-if="layout.grandFinal.seedA"
          :x="layout.grandFinal.x + 8"
          :y="layout.grandFinal.y + 50"
          class="fill-gray-400 text-[10px]"
        >
          {{ seedLabel(layout.grandFinal.seedA) }}
        </text>

        <text
          :x="layout.grandFinal.x + 8"
          :y="layout.grandFinal.y + 60"
          class="text-[13px]"
          :class="layout.grandFinal.winner === layout.grandFinal.teamB ? 'fill-green-700 font-bold' : 'fill-gray-800'"
        >
          {{ teamMap.get(layout.grandFinal.teamB ?? '')?.teamNameCn ?? '待定' }}
        </text>
        <text
          :x="layout.grandFinal.x + CARD_W - 8"
          :y="layout.grandFinal.y + 60"
          text-anchor="end"
          class="text-[13px] font-mono font-bold"
          :class="layout.grandFinal.winner === layout.grandFinal.teamB ? 'fill-green-700' : 'fill-gray-700'"
        >
          {{ layout.grandFinal.scoreB }}
        </text>

        <text
          v-if="layout.grandFinal.seedB"
          :x="layout.grandFinal.x + 8"
          :y="layout.grandFinal.y + 72"
          class="fill-gray-400 text-[10px]"
        >
          {{ seedLabel(layout.grandFinal.seedB) }}
        </text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.match-svg {
  cursor: pointer;
  transition: opacity 0.15s;
}

.match-svg:hover {
  opacity: 0.85;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.animate-pulse {
  animation: pulse 1.5s ease-in-out infinite;
}
</style>