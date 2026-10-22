import { ref } from 'vue';

/**
 * 统一「单动作」骨架：同一时刻只允许一个动作，busy 就是动作名（空串表示空闲）。
 * - guard=true：busy 中直接忽略（与旧 pickLesson / pickCourse / loadCourses 的前置判断一致）
 * - 失败文案沿用 e.message || fail，成功提示由调用方在 fn 里 say，保持原有节奏
 * 返回的 busy 是否绑到按钮上由调用方决定，不改变原来的禁用表现。
 */
export function useAction(say) {
  const busy = ref('');

  async function run(name, fn, options = {}) {
    const { guard = false, fail = '操作失败' } = options;
    if (guard && busy.value) return;
    busy.value = name;
    try {
      return await fn();
    } catch (e) {
      say(e.message || fail, 'bad');
    } finally {
      busy.value = '';
    }
  }

  return { busy, run };
}

/**
 * 两个开关（自动答题 / 看完自动跳节）共用的动作：
 * 读当前值取反 → POST /api/settings → 按新值报文案，失败统一「设置失败」。
 */
export function makeToggle(api, say) {
  return async function toggle({ current, key, on, off }) {
    const next = !current;
    try {
      await api('/api/settings', { [key]: next });
      say(next ? on : off);
    } catch (e) {
      say(e.message || '设置失败', 'bad');
    }
  };
}
