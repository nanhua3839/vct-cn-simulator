<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Match } from '@/types/match'
import type { Team } from '@/types/team'

const props = defineProps<{
  match: Match | null
  teamA: Team | null
  teamB: Team | null
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', scoreA: number, scoreB: number): void
}>()

/** 是否为 BO5（总决赛采用 BO5，其余为 BO3） */
const isBO5 = computed(() => {
  return props.match?.round === 'GF' || props.match?.round === 'GrandFinal'
})

const maxScore = computed(() => (isBO5.value ? 3 : 2))

const scoreA = ref(0)
const scoreB = ref(0)
const errorMsg = ref('')

watch(
  () => props.visible,
  (val) => {
    if (val && props.match) {
      scoreA.value = props.match.scoreA
      scoreB.value = props.match.scoreB
      errorMsg.value = ''
    }
  },
)

function validate(): boolean {
  const validScores = Array.from({ length: maxScore.value + 1 }, (_, i) => i)
  if (!validScores.includes(scoreA.value)) {
    errorMsg.value = `比分 A 无效，允许范围：0-${maxScore.value}`
    return false
  }
  if (!validScores.includes(scoreB.value)) {
    errorMsg.value = `比分 B 无效，允许范围：0-${maxScore.value}`
    return false
  }
  if (scoreA.value === scoreB.value) {
    errorMsg.value = '比分不能平局，必须分出胜负'
    return false
  }
  errorMsg.value = ''
  return true
}

function handleSave() {
  if (!validate()) return
  emit('save', scoreA.value, scoreB.value)
}

function handleClose() {
  errorMsg.value = ''
  emit('close')
}

function handleBackdropClick(e: MouseEvent) {
  if ((e.target as HTMLElement).classList.contains('editor-backdrop')) {
    handleClose()
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible && match"
      class="editor-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      @click="handleBackdropClick"
    >
      <div
        class="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl"
        @click.stop
      >
        <!-- 标题 -->
        <h3 class="mb-1 text-lg font-bold text-gray-900">编辑赛果</h3>
        <p class="mb-4 text-sm text-gray-500">
          {{ isBO5 ? '总决赛 BO5' : 'BO3' }} · {{ match.round }}
        </p>

        <!-- 两队对阵 -->
        <div class="mb-4 flex items-center justify-between gap-4">
          <!-- Team A -->
          <div class="flex flex-1 flex-col items-center gap-1">
            <div class="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-700">
              {{ teamA?.teamNameCn?.charAt(0) ?? '?' }}
            </div>
            <span class="text-sm font-semibold text-gray-800 text-center leading-tight">
              {{ teamA?.teamNameCn ?? '待定' }}
            </span>
            <input
              v-model.number="scoreA"
              type="number"
              min="0"
              :max="maxScore"
              class="mt-1 w-20 rounded-lg border border-gray-300 px-3 py-2 text-center font-mono text-lg font-bold text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              @keydown.enter="handleSave"
            />
          </div>

          <!-- VS -->
          <div class="flex shrink-0 items-center">
            <span class="text-lg font-bold text-gray-400">VS</span>
          </div>

          <!-- Team B -->
          <div class="flex flex-1 flex-col items-center gap-1">
            <div class="h-10 w-10 rounded-full bg-orange-100 flex items-center justify-center text-sm font-bold text-orange-700">
              {{ teamB?.teamNameCn?.charAt(0) ?? '?' }}
            </div>
            <span class="text-sm font-semibold text-gray-800 text-center leading-tight">
              {{ teamB?.teamNameCn ?? '待定' }}
            </span>
            <input
              v-model.number="scoreB"
              type="number"
              min="0"
              :max="maxScore"
              class="mt-1 w-20 rounded-lg border border-gray-300 px-3 py-2 text-center font-mono text-lg font-bold text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              @keydown.enter="handleSave"
            />
          </div>
        </div>

        <!-- 错误提示 -->
        <p v-if="errorMsg" class="mb-3 text-center text-sm text-red-600">
          {{ errorMsg }}
        </p>

        <!-- 按钮 -->
        <div class="flex gap-3">
          <button
            class="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            @click="handleClose"
          >
            取消
          </button>
          <button
            class="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            @click="handleSave"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>