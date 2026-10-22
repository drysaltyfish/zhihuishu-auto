<script setup>
/**
 * 总览页：沿用改造前的一屏仪表盘（1440x900 不整页滚动）。
 * 结构 .grid = 左主列（课程大卡 + 课程目录） + 右栏（下一题 / 自动答题 / 章节测试），
 * 底部 BottomDock（运行日志 / 答题记录）。数据全部来自共享 store。
 */
import CourseHero from '../components/CourseHero.vue';
import LessonTree from '../components/LessonTree.vue';
import NextQuestion from '../components/NextQuestion.vue';
import AutoPanel from '../components/AutoPanel.vue';
import ChapterQuiz from '../components/ChapterQuiz.vue';
import BottomDock from '../components/BottomDock.vue';
import {
  S,
  logs,
  history,
  busy,
  say,
  hasCourse,
  isIdle,
  isStopped,
  lessons,
  lessonsDone,
  pickLesson,
} from '../store.js';
</script>

<template>
  <div v-if="!S" class="empty">正在读取状态…</div>
  <div v-else class="page-overview">
    <main class="grid">
      <div class="col-main">
        <CourseHero :state="S" :has-course="hasCourse" :is-idle="isIdle" />
        <section class="card lessons">
          <div class="chead">
            <span class="ctitle">课程目录</span>
            <span class="cmeta">{{ lessonsDone }}/{{ lessons.length }} 节已完成 · 点任意一节可切过去</span>
          </div>
          <LessonTree :lessons="lessons" :busy="busy" :is-idle="isIdle" :is-stopped="isStopped" @pick="pickLesson" />
        </section>
      </div>

      <aside class="rail">
        <NextQuestion :state="S" />
        <AutoPanel :state="S" :is-stopped="isStopped" :say="say" />
        <ChapterQuiz :state="S" :say="say" />
      </aside>
    </main>

    <BottomDock :logs="logs" :history="history" />
  </div>
</template>
