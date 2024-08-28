import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/views/Home.vue'),
  },
  {
    path: '/about',
    name: 'About',
    component: () => import('@/views/About.vue'),
  },
  {
    // :pathMatch 是参数的名称，表示匹配到的路径片段将被赋值给这个参数。
    // .* 表示匹配任意字符（包括 /），即从当前位置开始匹配剩余的整个路径。.* 表示零个或多个任意字符
    // *  在一些路由实现中，这个星号用来匹配所有路径，通常与 .* 正则结合使用。它可以帮助捕获所有剩余路径片段。
    path: '/test-demo/:pathMatch(.*)*',
    name: 'test-demo',
    meta: {},
    component: () => import('@/views/SubContainer.vue'),
  },
  {
    path: '/micro-demo/:pathMatch(.*)*',
    name: 'micro-demo',
    meta: {},
    component: () => import('@/views/SubContainer.vue'),
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
