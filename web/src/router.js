import { createRouter, createWebHashHistory } from 'vue-router';
import Overview from './pages/Overview.vue';
import Courses from './pages/Courses.vue';
import Settings from './pages/Settings.vue';
import LogsPage from './pages/LogsPage.vue';

/** 4 页应用：hash 路由不依赖服务端重写，地址里的 ?t=<token> 会一直保留 */
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'overview', component: Overview, meta: { title: '总览' } },
    { path: '/courses', name: 'courses', component: Courses, meta: { title: '选课' } },
    { path: '/settings', name: 'settings', component: Settings, meta: { title: '设置' } },
    { path: '/logs', name: 'logs', component: LogsPage, meta: { title: '日志' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
