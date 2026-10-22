<script setup>
/**
 * 选课页：我的课程列表（刷新 / 点一门切过去）+ 当前课程卡 + 课程目录全量展示。
 * 页面本身可以滚动（总览仍然是一屏，这一页内容多）。
 */
import { computed, onMounted } from 'vue';
import CourseHero from '../components/CourseHero.vue';
import LessonTree from '../components/LessonTree.vue';
import {
  S,
  busy,
  say,
  hasCourse,
  isIdle,
  isStopped,
  courses,
  lessons,
  lessonsDone,
  courseTitle,
  coursePct,
  history,
  loadCourses,
  pickCourse,
  pickLesson,
} from '../store.js';

const blocked = computed(() => isIdle.value || isStopped.value);
const busyCourses = computed(() => busy.value === 'courses');
const coursePctText = computed(() => (coursePct.value == null ? '—' : coursePct.value + '%'));
const tasksDone = computed(() => history.value.length);

function pctText(v) {
  return v == null ? '—' : v + '%';
}
function barWidth(v) {
  return (v == null ? 0 : Math.max(0, Math.min(100, v))) + '%';
}

/* 进页面时列表还是空的、又不在空闲/停止态，就自动读一次，省得用户先点刷新 */
onMounted(() => {
  if (!courses.value.length && !blocked.value) loadCourses();
});

async function refresh() {
  if (busy.value) return;
  await loadCourses();
}

async function choose(i) {
  if (busy.value) return;
  const ok = await pickCourse(i);
  if (ok) say('正在切换到：' + (courses.value[i] ? courses.value[i].name : '第 ' + (i + 1) + ' 门'));
}
</script>

<template>
  <div v-if="!S" class="empty">正在读取状态…</div>
  <div v-else class="page">
    <section class="card">
      <div class="chead">
        <span class="ctitle">当前课程</span>
        <span class="cmeta">
          {{ blocked ? '先「开始听课」才能切课' : '点下面任意一门课切过去，不打断当前进度' }}
        </span>
      </div>
      <CourseHero :state="S" :has-course="hasCourse" :is-idle="isIdle" />
    </section>

    <section class="card">
      <div class="chead">
        <span class="ctitle">我的课程</span>
        <span class="cmeta">
          {{ courses.length }} 门 ·
          {{ blocked ? '先「开始听课」才能刷新 / 切课' : '点一门课切过去，不打断当前进度' }}
        </span>
        <button class="btn mini" :disabled="!!busy" @click="refresh">
          {{ busyCourses ? '读取中…' : '刷新课程' }}
        </button>
      </div>

      <div v-if="!courses.length" class="empty-line">
        <template v-if="busyCourses">正在读取你账号下的课程…</template>
        <template v-else-if="blocked">还没有课程列表：先点右上「开始听课」，登录后再刷新</template>
        <template v-else>还没有课程列表，点右上「刷新课程」读一次</template>
      </div>

      <div v-else class="clist">
        <button
          v-for="(c, i) in courses"
          :key="i"
          class="ccard"
          :class="{ cur: c.name === courseTitle }"
          :disabled="blocked || !!busy"
          :title="c.name === courseTitle ? '当前课程' : '切到《' + c.name + '》'"
          @click="choose(i)"
        >
          <div class="cctop">
            <span class="ccname2">{{ c.name }}</span>
            <span v-if="c.name === courseTitle" class="mtag">当前</span>
            <span v-else class="ccgo">切换</span>
          </div>
          <div class="ccmeta">
            <span>{{ c.school || c.teacher || '—' }}</span>
            <span class="sep">·</span>
            <span>进度 {{ pctText(c.pct) }}</span>
            <template v-if="c.now"
              ><span class="sep">·</span><span class="mnow">在学 {{ c.now }}</span></template
            >
          </div>
          <div class="bar ccbar"><div class="fill" :style="{ width: barWidth(c.pct) }"></div></div>
        </button>
      </div>
    </section>

    <section class="card">
      <div class="chead">
        <span class="ctitle">课程目录</span>
        <span class="cmeta">
          已完成 {{ lessonsDone }}/{{ lessons.length }} 节 · 本课程进度 {{ coursePctText }} · 今日答题 {{ tasksDone }}
        </span>
      </div>
      <LessonTree
        :lessons="lessons"
        :busy="busy"
        :is-idle="isIdle"
        :is-stopped="isStopped"
        auto-height
        @pick="pickLesson"
      />
    </section>
  </div>
</template>
