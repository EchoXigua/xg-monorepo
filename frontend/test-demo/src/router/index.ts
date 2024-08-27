import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import { qiankunWindow } from 'vite-plugin-qiankun/dist/helper';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/views/Home.vue'),
  },
  {
    path: '/about1',
    name: 'About',
    component: () => import('@/views/About.vue'),
  },
];

const router = createRouter({
  history: createWebHistory(
    qiankunWindow.__POWERED_BY_QIANKUN__ ? import.meta.env.VITE_PKG_NAME : '',
  ),
  routes,
});

export default router;
