/** 路由表 + 鉴权 + 错误包装：一个 /api 请求进来只有这一条路 */
import { json, fail, readJson } from './http.mjs';

/**
 * @param {object} opts
 * @param {Array<{path:string, methods:string[], handler:Function}>} opts.routes
 * @param {string} opts.token 每次启动随机生成的访问令牌
 * @param {(kind:string,msg:string)=>void} opts.log
 * @param {() => object} opts.context 每个请求要注入的上下文（state/engine/…）
 */
export function createRouter({ routes, token, log, context }) {
  return async function handle(req, res, url) {
    const route = routes.find((r) => r.path === url.pathname);
    if (!route) return fail(res, 404, '接口不存在');

    if ((url.searchParams.get('t') || '') !== token) {
      return fail(res, 403, '访问令牌无效', '请用启动时自动打开的页面地址进入（地址里带 ?t=…）');
    }
    if (!route.methods.includes(req.method)) {
      return fail(res, 405, '请求方式不对', '请刷新页面后重试');
    }
    try {
      const body = req.method === 'POST' || req.method === 'PUT' ? await readJson(req) : {};
      await route.handler({ req, res, url, body, ...context() });
    } catch (e) {
      if (e && e.expose) return fail(res, e.status || 400, e.message, e.hint);
      log('err', '接口 ' + url.pathname + ' 处理失败：' + String((e && e.message) || e).slice(0, 160));
      if (!res.headersSent) fail(res, 500, '服务出了一点问题，已记录，请重试');
    }
  };
}
