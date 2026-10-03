// core/renderService.js — 把「项目内相对路径」解析成一份实时渲染的视图 HTML，或 null（= 照普通
// 静态文件处理）。这是「源文件是唯一真相 + 本地预览服务动态读取 + 显式静态导出」里"动态读取"
// 的那一环：页面不是某个工具写死在项目目录里的快照，而是每次 HTTP GET 时依据源文件和冻结版本的
// **当前**内容、按**当前**模板重新投影。改了源文件、git checkout、改了模板，刷新浏览器即最新。
//
// 不认识任何产品：哪些路径是哪个产品的页面，由产品注册表里每个产品的
// render / resolveFile 回答：路径第一段是谁的数据目录就只问谁（core/plugin.js 的 routeOwners），再给产品主页面注入项目侧边栏（core/projectNav.js）。
// 唯一框架自己的页面是项目入口 index.html（见 projectEntryHtml）。
//   render(ws, pid, relPath, { query, localState }) → { html, current? } 或 null。localState === false 时
//     不读项目 .protoflow/ 下的本地派生状态（页面自己写回的缓存，比如画布的画板实测高度）——实时刷新
//     算 ETag 时这样渲染（core/liveReload.js），页面自己写回的东西不算内容变化。带 current（{ type, id }）的是
//     产品主页面，注入项目侧边栏并高亮当前项；不带的（比如嵌在画布里的画板 iframe）原样返回。
//   resolveFile(ws, pid, relPath) → 磁盘上的绝对路径或 null：版本里的文件（…/versions/<n>/<路径>）
//     按清单解析到对象库（core/versionStore.js），页面里的地址不用改。
//
// core/localServer.js 保持通用，不 import 本模块；bin/protoflow-server.mjs 在入口处用产品注册表
// 建好 renderer，把两个函数分别作为 renderView / resolveFile 传进 createStaticHandler。
import path from "node:path";
import { withProductTab, BRAND_CSS_VARS, FAVICON_LINK } from "./brand.js";
import { buildProjectNav, injectProjectNav, PROJECT_ENTRY, firstNavHref } from "./projectNav.js";
import { routeOwners } from "./plugin.js";
import { createEmbedder } from "./embed.js";

// projectRoot 是绝对项目根目录（localServer 的注册表里存的就是它）；产品的函数签名是
// (ws, projectId) = (父目录, 文件夹名)，这里拆一下。relPath 已被 localServer 解码且过了
// containment 检查（不含 ..）。opts.ui 是用户级界面偏好（~/.protoflow/ui.json），项目侧边栏的
// 初始展开状态从这里来；opts.query 是请求地址 ? 后面的部分（比如画布页的 ?v=<n>）。
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

// 项目入口（切换项目、打开项目根地址时到这里）：跳到侧边栏里第一个能打开的产物——顺序就是侧边栏的
// 顺序（产品在注册表里的先后 + 各产品 nav() 给的顺序），入口不另排。一个都没有就显示一张空项目页，
// 侧边栏展开着，可以切到别的项目。以后做项目首页，替换的就是这里。
// 空项目提示里列出当前启用的产品，不写死产品名。
function emptyHint(nav) {
  const labels = nav.groups.filter((g) => !g.uninstalled).map((g) => g.label).filter(Boolean);
  return labels.length ? `建了${labels.join("、")}（需要定版的定过版）之后，会出现在左侧列表里。` : "还没有启用任何产品。";
}

function projectEntryHtml(nav) {
  const href = firstNavHref(nav);
  if (href) {
    return { redirect: true, html: `<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta http-equiv="refresh" content="0; url=${esc(href)}"/></head>`
      + `<body><script>location.replace(${JSON.stringify(href)});</script><a href="${esc(href)}">${esc(href)}</a></body></html>` };
  }
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/><title>${esc(nav.project.name)} · Protoflow</title>${FAVICON_LINK}`
    + `<style>${BRAND_CSS_VARS}body{margin:0;font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:var(--pf-brand);background:#fff}`
    + `.pf-empty{max-width:420px;margin:18vh auto 0;padding:0 24px;text-align:center}.pf-empty h1{font-size:18px;margin:0 0 8px}.pf-empty p{color:#64748b;margin:0}`
    + `.pf-empty-slot{position:fixed;left:12px;top:12px}</style></head>`
    + `<body><div class="pf-empty-slot" data-pf-nav-slot></div><div class="pf-empty"><h1>${esc(nav.project.name)}</h1>`
    + `<p>这个项目还没有可看的内容。${esc(emptyHint(nav))}</p></div></body></html>`;
  return { redirect: false, html };
}

export function createProjectRenderer(products) {
  const embed = createEmbedder(products); // 产品页面里嵌别的产品的内容（core/embed.js）
  const split = (root) => [path.dirname(root), path.basename(root)];
  return {
    renderProjectView(projectRoot, relPath, opts = {}) {
      const [ws, projectId] = split(projectRoot);
      if (relPath === PROJECT_ENTRY) {
        const nav = buildProjectNav(ws, projectId, products);
        const entry = projectEntryHtml(nav);
        return entry.redirect ? entry.html : injectProjectNav(entry.html, nav, null, { open: true });
      }
      for (const p of routeOwners(products, relPath)) {
        const r = p.render && p.render(ws, projectId, relPath, { query: opts.query || "", localState: opts.localState !== false, embed });
        if (!r) continue;
        if (!r.current) return r.html;
        const open = !!(opts.ui && opts.ui.projectNavOpen);
        return injectProjectNav(withProductTab(r.html, p.navIcon), buildProjectNav(ws, projectId, products), r.current, { open });
      }
      return null;
    },
    resolveProjectFile(projectRoot, relPath) {
      const [ws, projectId] = split(projectRoot);
      for (const p of routeOwners(products, relPath)) {
        const f = p.resolveFile && p.resolveFile(ws, projectId, relPath);
        if (f) return f;
      }
      return null;
    },
  };
}
