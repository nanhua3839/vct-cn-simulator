import { createRouter, createWebHistory } from 'vue-router'

export const navRoutes = [
  { path: '/', name: 'overview', label: '全局总览' },
  { path: '/kickoff', name: 'kickoff', label: '启点赛' },
  { path: '/stage1', name: 'stage1', label: '第一赛段' },
  { path: '/stage2', name: 'stage2', label: '第二赛段' },
  { path: '/points', name: 'points', label: '积分排行' },
  { path: '/global', name: 'global', label: '全球赛事' },
] as const

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'overview',
      component: () => import('@/views/GlobalOverview.vue'),
      meta: { title: '全局晋级状态总览' },
    },
    {
      path: '/kickoff',
      name: 'kickoff',
      component: () => import('@/views/Kickoff.vue'),
      meta: { title: '启点赛' },
    },
    {
      path: '/stage1',
      name: 'stage1',
      component: () => import('@/views/Stage1.vue'),
      meta: { title: '第一赛段' },
    },
    {
      path: '/stage2',
      name: 'stage2',
      component: () => import('@/views/Stage2.vue'),
      meta: { title: '第二赛段' },
    },
    {
      path: '/points',
      name: 'points',
      component: () => import('@/views/PointsRanking.vue'),
      meta: { title: '积分排行' },
    },
    {
      path: '/global',
      name: 'global',
      component: () => import('@/views/GlobalEvents.vue'),
      meta: { title: '全球赛事' },
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})

router.afterEach((to) => {
  const title = to.meta.title as string | undefined
  document.title = title ? `${title} · VCT CN 赛制晋级模拟器` : 'VCT CN 赛制晋级模拟器'
})

export default router
