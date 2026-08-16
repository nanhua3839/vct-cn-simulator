<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { navRoutes } from '@/router'
import { store, resetMatches } from '@/store'
import type { Stage } from '@/types/match'

const route = useRoute()
const mobileOpen = ref(false)

/** 每个路由对应的阶段信息和晋级名额说明 */
const routeStageInfo: Record<string, { slot: string; stageKeys: Stage[] }> = {
  overview: { slot: '全年晋级总览', stageKeys: [] },
  kickoff: { slot: '前 3 → 圣地亚哥大师赛', stageKeys: ['kickoff'] },
  stage1: { slot: '前 3 → 伦敦大师赛', stageKeys: ['stage1_regular', 'stage1_playoff'] },
  stage2: { slot: '冠亚军 → 全球冠军赛', stageKeys: ['stage2_regular', 'stage2_playins', 'stage2_playoff'] },
  points: { slot: '积分前 2 → 全球冠军赛', stageKeys: [] },
  global: { slot: '全球赛事名额追踪', stageKeys: [] },
}

/** 判断某阶段的所有比赛是否已完成 */
function isStageComplete(stage: Stage): boolean {
  const stageMatches = store.matches.filter((m) => m.stage === stage)
  if (stageMatches.length === 0) return false
  return stageMatches.every((m) => m.status === 'finished')
}

/** 判断某阶段是否有比赛（是否已开始） */
function isStageStarted(stage: Stage): boolean {
  return store.matches.some((m) => m.stage === stage)
}

/** 当前进行中的阶段组名 */
const currentStageGroup = computed(() => {
  const groups = [
    { name: 'stage2', stages: ['stage2_regular', 'stage2_playins', 'stage2_playoff'] as Stage[] },
    { name: 'stage1', stages: ['stage1_regular', 'stage1_playoff'] as Stage[] },
    { name: 'kickoff', stages: ['kickoff'] as Stage[] },
  ]
  for (const group of groups) {
    for (const stage of group.stages) {
      const stageMatches = store.matches.filter((m) => m.stage === stage)
      if (stageMatches.length > 0 && !stageMatches.every((m) => m.status === 'finished')) {
        return group.name
      }
    }
  }
  return null
})

/** 获取路由的状态指示 */
function getRouteStatus(name: string): 'current' | 'completed' | 'upcoming' | null {
  if (name === 'overview' || name === 'points' || name === 'global') return null
  const info = routeStageInfo[name]
  if (!info || info.stageKeys.length === 0) return null
  if (currentStageGroup.value === name) return 'current'
  if (info.stageKeys.every((s) => isStageComplete(s))) return 'completed'
  if (info.stageKeys.some((s) => isStageStarted(s))) return null
  return 'upcoming'
}

function closeMobile() {
  mobileOpen.value = false
}
</script>

<template>
  <header class="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
    <div class="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
      <!-- Logo -->
      <router-link to="/" class="flex shrink-0 items-center gap-2">
        <span class="flex h-7 w-7 items-center justify-center rounded-lg bg-red-600 text-xs font-black text-white">
          VCT
        </span>
        <span class="text-sm font-bold tracking-tight text-gray-900">CN 赛制晋级模拟器</span>
      </router-link>

      <!-- Desktop nav -->
      <nav class="hidden items-center gap-1 md:flex">
        <router-link
          v-for="r in navRoutes"
          :key="r.path"
          :to="r.path"
          class="group relative flex flex-col items-center px-3 py-1"
        >
          <!-- 彩色圆点指示器 -->
          <span
            v-if="getRouteStatus(r.name)"
            class="mb-0.5 h-1.5 w-1.5 rounded-full"
            :class="{
              'bg-emerald-500 shadow-sm shadow-emerald-300': getRouteStatus(r.name) === 'current',
              'bg-gray-300': getRouteStatus(r.name) === 'completed',
              'bg-gray-200': getRouteStatus(r.name) === 'upcoming',
            }"
          />
          <span
            v-else
            class="mb-0.5 h-1.5 w-1.5"
          />

          <!-- 标签 -->
          <span
            class="nav-link whitespace-nowrap px-2 py-1 text-xs leading-tight"
            :class="{
              '!bg-blue-50 !text-blue-700': route.path === r.path,
            }"
          >
            {{ r.label }}
          </span>

          <!-- 晋级名额说明 -->
          <span class="mt-0.5 whitespace-nowrap text-[10px] leading-tight text-gray-400 transition-colors group-hover:text-gray-600">
            {{ routeStageInfo[r.name]?.slot ?? '' }}
          </span>
        </router-link>
      </nav>

      <!-- 模拟模式按钮 -->
      <div class="hidden items-center md:flex">
        <button
          class="ml-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
          :class="{
            'bg-blue-100 text-blue-700': store.isSimulated,
            'border border-gray-300 text-gray-600 hover:border-blue-300 hover:text-blue-600': !store.isSimulated,
          }"
          @click="store.isSimulated = !store.isSimulated"
        >
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          {{ store.isSimulated ? '模拟中' : '模拟' }}
        </button>
        <button
          v-if="store.isSimulated"
          class="ml-1.5 inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
          @click="resetMatches()"
        >
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          重置
        </button>
      </div>

      <!-- Mobile hamburger -->
      <button
        class="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 md:hidden"
        @click="mobileOpen = !mobileOpen"
        aria-label="菜单"
      >
        <svg
          v-if="!mobileOpen"
          class="h-5 w-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        <svg
          v-else
          class="h-5 w-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <!-- Mobile menu -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 -translate-y-2"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0 -translate-y-2"
    >
      <nav
        v-if="mobileOpen"
        class="border-t border-gray-200 bg-white px-4 pb-4 pt-2 md:hidden"
      >
        <router-link
          v-for="r in navRoutes"
          :key="r.path"
          :to="r.path"
          class="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-gray-50"
          :class="{ 'bg-blue-50': route.path === r.path }"
          @click="closeMobile"
        >
          <!-- 彩色圆点 -->
          <span
            v-if="getRouteStatus(r.name)"
            class="h-2 w-2 shrink-0 rounded-full"
            :class="{
              'bg-emerald-500': getRouteStatus(r.name) === 'current',
              'bg-gray-300': getRouteStatus(r.name) === 'completed',
              'bg-gray-200': getRouteStatus(r.name) === 'upcoming',
            }"
          />
          <span
            v-else
            class="h-2 w-2 shrink-0"
          />

          <div class="flex flex-col">
            <span
              class="text-sm font-medium"
              :class="{ 'text-blue-700': route.path === r.path, 'text-gray-900': route.path !== r.path }"
            >
              {{ r.label }}
            </span>
            <span class="text-[11px] text-gray-400">
              {{ routeStageInfo[r.name]?.slot ?? '' }}
            </span>
          </div>
        </router-link>
        <!-- 移动端模拟模式 -->
        <div class="mt-2 flex items-center gap-2 border-t border-gray-100 pt-2">
          <button
            class="flex-1 rounded-lg px-3 py-2 text-center text-sm font-medium transition-colors"
            :class="{
              'bg-blue-100 text-blue-700': store.isSimulated,
              'border border-gray-300 text-gray-600': !store.isSimulated,
            }"
            @click="store.isSimulated = !store.isSimulated"
          >
            {{ store.isSimulated ? '退出模拟模式' : '进入模拟模式' }}
          </button>
          <button
            v-if="store.isSimulated"
            class="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
            @click="resetMatches()"
          >
            重置
          </button>
        </div>
      </nav>
    </Transition>
  </header>
</template>