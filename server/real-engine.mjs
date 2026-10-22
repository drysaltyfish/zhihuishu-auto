/**
 * 真实引擎：fork 一个独立 worker 进程（独占 Chrome），负责全部智慧树交互。
 * 服务进程只做三件事：转发指令、合并状态补丁、转发日志。
 * worker 崩了不影响服务；服务这边按限速自动复原。
 */
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPatch } from './state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(HERE, 'worker', 'main.mjs');

export function createRealEngine({ state, emit, pushLog, dataDir }) {
  let child = null;
  let ready = false;
  let childSeq = 0;
  let expectExit = false;
  let wantRunning = false;
  let quitting = false;
  let pending = null;           // 等 worker ready 后补发的指令
  let crashTimes = [];          // 用来限速自愈
  let reviveTimer = null;

  function send(cmd, data) {
    if (child && ready) {
      try { child.send({ type: 'cmd', cmd, data }); return true; } catch {}
    }
    pending = { cmd, data };
    return false;
  }

  function onMessage(m) {
    try {
      if (!m || typeof m !== 'object') return;
      if (m.type === 'ready') {
        ready = true;
        if (pending) { const p = pending; pending = null; send(p.cmd, p.data); }
        return;
      }
      if (m.type === 'state' && m.patch) { applyPatch(state, m.patch); emit(); return; }
      if (m.type === 'log') { pushLog(m.kind || 'info', m.msg || ''); return; }
    } catch (e) {
      pushLog('err', '引擎消息处理失败：' + String(e && e.message || e).slice(0, 120));
    }
  }

  function onExit(code) {
    const wasReady = ready;
    child = null; ready = false; pending = null;
    if (expectExit) return; // 上一次 quit 的收尾退出，正在等它让位（状态已清好）
    if (quitting) { pushLog('info', '后台已退出，断点已保存'); return; }
    if (!wantRunning) return;
    if (!wasReady) { pushLog('err', '后台进程没能起来（可能是浏览器启动失败）'); }

    const now = Date.now();
    crashTimes = crashTimes.filter((t) => now - t < 60 * 60 * 1000);
    crashTimes.push(now);
    if (crashTimes.length > 3) {
      wantRunning = false;
      applyPatch(state, { phase: 'STOPPED', notice: '连续异常退出了 4 次，已停止自动恢复。请点「重启」再试，或检查浏览器是否被其他程序占用。' });
      pushLog('err', '连续异常太多次，已停止自动恢复');
      emit();
      return;
    }
    applyPatch(state, { phase: 'LAUNCHING', notice: '后台异常退出，正在自动恢复（第 ' + crashTimes.length + ' 次）…' });
    emit();
    pushLog('warn', '后台异常退出（code=' + code + '），4 秒后自动恢复');
    clearTimeout(reviveTimer);
    reviveTimer = setTimeout(() => { if (wantRunning && !quitting) { spawnWorker(); send('start'); } }, 4000);
  }

  function spawnWorker() {
    if (child) return;
    try {
      child = fork(WORKER, [], {
        env: { ...process.env, ZHS_DATA: dataDir },
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      });
      ready = false;
      const me = ++childSeq;
      child.on('message', onMessage);
      child.on('exit', (code) => { if (me !== childSeq) return; onExit(code); });
      child.on('error', (e) => pushLog('err', '后台进程错误：' + String(e && e.message || e).slice(0, 160)));
      if (child.stderr) {
        child.stderr.on('data', (d) => {
          const s = String(d).trim();
          if (!s) return;
          const line = s.split('\n').filter(Boolean).slice(-2).join(' | ');
          pushLog('debug', line.slice(0, 240));
        });
      }
    } catch (e) {
      pushLog('err', '无法启动后台进程：' + String(e && e.message || e).slice(0, 160));
      applyPatch(state, { phase: 'STOPPED', notice: '无法启动后台进程' });
      emit();
    }
  }

  return {
    start() {
      wantRunning = true; quitting = false; crashTimes = [];
      applyPatch(state, { mode: 'real', phase: 'LAUNCHING', notice: '' });
      emit();
      const go = () => {
        if (!wantRunning) return;
        pushLog('info', '正在启动后台浏览器…');
        spawnWorker();
        send('start');
      };
      // 上一次退出还没收完尾就点了开始：等旧进程真正退出再起，免得两个 worker 抢同一个 Chrome 用户目录
      if (child) {
        expectExit = true;
        pushLog('info', '等上一个后台退出后重新启动…');
        child.once('exit', () => { expectExit = false; go(); });
        return;
      }
      go();
    },
    control(action, data) {
      if (action === 'pause') { pushLog('info', '已请求暂停'); return send('pause'); }
      if (action === 'resume') { pushLog('info', '已请求继续'); return send('resume'); }
      if (action === 'restart') {
        pushLog('info', '正在重启后台…');
        wantRunning = true; quitting = false; crashTimes = [];
        if (!child) { spawnWorker(); send('start'); return true; }
        return send('restart');
      }
      if (action === 'quit') {
        quitting = true; wantRunning = false;
        clearTimeout(reviveTimer);
        pushLog('info', '正在退出后台…');
        const c = child;
        send('quit');
        setTimeout(() => { try { if (c) c.kill(); } catch {} }, 6000);
        return true;
      }
      if (action === 'settings') return send('settings', data);
      if (action === 'lesson') return send('lesson', data);
      if (action === 'probe') return send('probe', data);
      if (action === 'verifyprobe') return send('verifyprobe', data);
      if (action === 'courses') return send('courses', data);
      if (action === 'course') return send('course', data);
      return false;
    },
    stop() {
      quitting = true; wantRunning = false;
      clearTimeout(reviveTimer);
      try { if (child) child.kill(); } catch {}
      child = null; ready = false;
    },
  };
}
