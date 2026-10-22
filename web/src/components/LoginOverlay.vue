<script setup>
/**
 * 全屏扫码登录浮层（Shell 层挂载，任何路由都能看到）。
 * 只读共享 store 的 state：state.loginNeeded 为 true 时显示，
 * 后端登录成功后把 loginNeeded 置 false、qrUrl 清空，浮层自然消失。
 */
import { computed, ref, watch } from 'vue';
import { authUrl } from '../api.js';
import { S, qrUrl, busy, control, say } from '../store.js';

const hint = computed(() => (S.value && S.value.loginHint) || '请用微信扫一扫下面的二维码登录智慧树');
const src = computed(() => authUrl(qrUrl.value));
const qrError = ref(false);

/* 后端换一张二维码（qrUrl 带新的 v=）就重置加载失败标记 */
watch(src, () => {
  qrError.value = false;
});

async function refreshQr() {
  const ok = await control('refreshQr');
  if (ok) say('正在刷新二维码…');
}

async function useBrowser() {
  const ok = await control('showBrowser');
  if (ok) say('已切换到浏览器窗口，登录完成后会自动继续');
}
</script>

<template>
  <div class="loginwrap">
    <div class="logincard" role="dialog" aria-modal="true" aria-label="扫码登录智慧树">
      <div class="lchead">
        <span class="lcqricon">▣</span>
        <h2 class="lctitle">扫码登录智慧树</h2>
      </div>
      <p class="lcsub">{{ hint }}</p>

      <div class="qrbox">
        <img v-if="src && !qrError" class="qrimg" :src="src" alt="智慧树登录二维码" @error="qrError = true" />
        <div v-else-if="qrError" class="qrfallback">二维码加载失败<br />点下面「刷新二维码」再试</div>
        <div v-else class="qrskeleton">
          <span class="qrpulse"></span>
          <span class="qrsktxt">正在获取二维码…</span>
        </div>
      </div>

      <div class="lcstatus">
        <span class="dot on"></span>
        <span>扫码并在手机上确认后，会自动继续听课，不用再点开始</span>
      </div>

      <div class="lcbtns">
        <button class="btn mini" :disabled="!!busy" @click="refreshQr">刷新二维码</button>
        <button class="btn mini" :disabled="!!busy" @click="useBrowser">在浏览器窗口中登录</button>
      </div>

      <div class="lcfoot">二维码约 2 分钟有效，过期会自动刷新；登录成功后本窗口自动关闭</div>
    </div>
  </div>
</template>
