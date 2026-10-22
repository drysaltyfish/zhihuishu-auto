<script setup>
/**
 * 应用外壳：品牌 + 导航 + 课程胶囊 + 连接状态 + 操作按钮 + 提示条 / toast。
 * 状态全部来自共享 store（只有这里 init 一次 SSE，页面切换不会重建连接）。
 */
import { onBeforeUnmount, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import CoursePicker from './components/CoursePicker.vue';
import LoginOverlay from './components/LoginOverlay.vue';
import {
  connected,
  toast,
  hintShow,
  busy,
  phaseText,
  pickerOpen,
  loginNeeded,
  courseTitle,
  isIdle,
  isPaused,
  isStopped,
  canStart,
  courses,
  init,
  destroy,
  start,
  control,
  loadCourses,
  pickCourse,
  dismissHint,
} from './store.js';
import './app.css';

const route = useRoute();
const router = useRouter();
const navs = [
  { name: 'overview', to: '/', label: '总览' },
  { name: 'courses', to: '/courses', label: '选课' },
  { name: 'settings', to: '/settings', label: '设置' },
  { name: 'logs', to: '/logs', label: '日志' },
];

function openCoursesPage() {
  pickerOpen.value = false;
  router.push('/courses');
}

function onQuit() {
  control('quit');
}

onMounted(init);
onBeforeUnmount(destroy);
</script>

<template>
  <div class="wrap">
    <header class="hdr">
      <div class="brand">
        <div class="logo">智</div>
        <div class="btext">
          <div class="bname">智慧树自动听课</div>
          <div class="bsub">
            <span class="dot" :class="connected ? 'on' : 'off'"></span>
            本地工具 · 数据只留在这台电脑
          </div>
        </div>
      </div>

      <nav class="nav">
        <router-link v-for="n in navs" :key="n.name" :to="n.to" class="navtab" :class="{ on: route.name === n.name }">{{
          n.label
        }}</router-link>
      </nav>

      <div class="hdr-mid">
        <button class="coursechip" title="点开选课 / 看更多课程" @click="pickerOpen = true">
          <span class="cclabel">我的课程</span>
          <span class="ccname">{{ courseTitle }}</span>
          <span class="caret">▼</span>
        </button>
      </div>

      <div class="statuspill" :class="connected ? 'on' : 'bad'">
        <span class="sd"></span>
        <span>{{ connected ? '已连接本地服务' : '连接断开' }}</span>
        <span class="sep">·</span>
        <span>{{ phaseText }}</span>
      </div>

      <div class="acts">
        <template v-if="canStart">
          <button class="btn primary" :disabled="!!busy" @click="start">
            {{ isStopped ? '重新开始' : '开始听课' }}
          </button>
        </template>
        <template v-else>
          <button v-if="!isPaused" class="btn warn" :disabled="!!busy" @click="control('pause')">暂停</button>
          <button v-else class="btn ok" :disabled="!!busy" @click="control('resume')">继续</button>
          <button class="btn" :disabled="!!busy" @click="control('restart')">重启</button>
          <button class="btn bad" :disabled="!!busy" @click="onQuit">退出</button>
        </template>
      </div>
    </header>

    <div class="stage">
      <router-view />
    </div>

    <!-- 登录浮层挂在壳里：任何页面需要扫码登录时都会盖在最上面 -->
    <LoginOverlay v-if="loginNeeded" />

    <CoursePicker
      v-if="pickerOpen"
      :courses="courses"
      :current="courseTitle"
      :busy="!!busy"
      :is-idle="isIdle"
      :is-stopped="isStopped"
      @close="pickerOpen = false"
      @refresh="loadCourses"
      @pick="pickCourse"
      @open-courses="openCoursesPage"
    />

    <transition name="fade">
      <div v-if="hintShow" class="hintwrap">
        <div class="hintbar" :class="hintShow.kind">
          <span class="hi">{{ hintShow.icon }}</span>
          <span class="htext">{{ hintShow.text }}</span>
          <button class="hint-x" title="关闭提示" @click="dismissHint">×</button>
        </div>
      </div>
    </transition>

    <transition name="fade">
      <div v-if="toast" class="toast" :class="toast.kind">{{ toast.text }}</div>
    </transition>
  </div>
</template>
