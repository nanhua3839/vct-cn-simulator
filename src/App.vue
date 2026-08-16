<script setup lang="ts">
import NavBar from '@/components/NavBar.vue'
</script>

<template>
  <div class="flex min-h-screen flex-col bg-gray-50">
    <NavBar />
    <main class="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
      <router-view />
    </main>
    <footer class="border-t border-gray-200 py-4 text-center text-xs text-gray-400">
      VCT CN 赛制晋级模拟器 · 示例数据仅供演示
    </footer>
  </div>
</template>
