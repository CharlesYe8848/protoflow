// core/projectNav.js — 框架层的项目侧边栏：画布、文档、表格三个产品页面左上角共用同一份。
// 顶部是项目名（点开切换项目），下面按类型列出本项目的产物。它只认识"产物清单"这一份数据，
// 不认识任何产品内部的概念（画布的页面/标注、文档的目录都留在各产品自己的侧栏里）。
//
// 不烘焙进页面模板：本地服务返回这几个页面时由 core/renderService.js 实时注入（数据是当下的
// 产物清单），所以文档/表格那些 finalize 时冻结的 preview.html 也总能看到最新的产物列表，不用为了
// 刷新导航去重渲染别的产物。导出产物不经过本地服务，天然不带侧边栏。
//
// 默认收起；展开/收起记在用户级偏好里（服务端 ~/.protoflow/ui.json），切换产物、切换项目都保持。
// 收起时只剩一个图标按钮（放在产品页面预留的 [data-pf-nav-slot] 里，这是产品对框架唯一的约定——
// 留个位置，不认识侧边栏），点开才展开面板。列表按产物类型的图标区分，不分组、不要组头。
import * as store from "./store.js";
import { BRAND_ICON_SVG } from "./brand.js";

// 当前项目的导航数据：项目名 + 每个产品的一组产物。产品在注册描述里提供
//   nav(ws, pid) → [{ id, title, href, meta }]（href 相对项目根目录，客户端按当前地址补 /p/<key>/
//   前缀；没有可看的页面就给 null，显示成置灰）、navIcon（列表里的类型图标，一段 SVG）。
// 列表顺序全由产品决定（注册表里的先后 + 各产品 nav() 返回的顺序），框架不排序。
// 切换项目后打开框架的项目入口（PROJECT_ENTRY，见 core/renderService.js）。
export const PROJECT_ENTRY = "index.html";

// 打开项目时顺带同步产品登记和项目说明（core/store.js 的 syncProjectProducts）。登记过、但当前没启用的产品
// （插件没装或被禁用）也列一组：产物照样看得见，只是打不开（href 为 null，标"未安装"）。
const UNINSTALLED_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2.5" stroke-dasharray="3 3"/></svg>';

export function buildProjectNav(ws, projectId, products) {
  const pj = store.readProject(ws, projectId);
  if (!pj) throw new Error(`项目 ${projectId} 不存在`);
  store.syncProjectProducts(ws, projectId, products);
  const uninstalled = store.uninstalledProducts(ws, projectId, products).map(({ type, kind }) => ({
    type, label: `未安装的产品：${type}`, icon: UNINSTALLED_ICON, uninstalled: true,
    items: store.listEntities(ws, projectId, kind).map((e) => ({ id: e.id, title: e.title || e.id, href: null, meta: "未安装" })),
  })).filter((g) => g.items.length);
  return {
    project: { id: projectId, name: pj.name },
    entry: PROJECT_ENTRY,
    groups: [
      ...products.filter((p) => p.nav).map((p) => ({ type: p.type, label: p.label, icon: p.navIcon || "", items: p.nav(ws, projectId) })),
      ...uninstalled,
    ],
  };
}

// 侧边栏里第一个能打开的产物（href 不为 null），项目入口跳这里；一个都没有回 null。
export function firstNavHref(nav) {
  for (const g of nav.groups) for (const item of g.items) if (item.href) return item.href;
  return null;
}

// 把侧边栏插到 <body> 开头。current = { type, id } 标出当前所在的产物。
// opts.open：初始是否展开（来自用户级偏好 ~/.protoflow/ui.json，见 core/localServer.js 的
// /__protoflow_ui）。在同项目里切换产物、切到别的项目都保持同一个展开状态。
export function injectProjectNav(html, nav, current, opts = {}) {
  const data = JSON.stringify({ nav, current, open: !!opts.open }).replace(/</g, "\\u003c");
  const block = `<style>${NAV_CSS}</style><script>window.__PF_PNAV__ = ${data};${NAV_SCRIPT}<\/script>`;
  return String(html).replace(/<body([^>]*)>/, (m) => m + block);
}

const OPEN_W = 248;

const NAV_CSS = `
html.pf-fs .pf-pnav,html.pf-fs .pf-pnav__launcher{display:none!important}
html.pf-fs body,html.pf-fs.pf-pnav-open body{margin-left:0!important}
html.pf-pnav-open body{margin-left:${OPEN_W}px}
.pf-pnav{position:fixed;left:0;top:0;bottom:0;width:${OPEN_W}px;z-index:80;background:#fff;border-right:1px solid #e2e8f0;display:none;flex-direction:column;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:13px;color:#0f172a;box-sizing:border-box}
html.pf-pnav-open .pf-pnav{display:flex}
.pf-pnav *{box-sizing:border-box}
.pf-pnav__launcher,.pf-pnav__toggle{flex:none;width:28px;height:28px;padding:0;border:0;background:transparent;border-radius:6px;color:#64748b;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;vertical-align:middle}
.pf-pnav__launcher:hover,.pf-pnav__toggle:hover{background:rgba(15,23,42,.06);color:#0f172a}
.pf-pnav__launcher--float{position:fixed;left:8px;top:6px;z-index:79;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,.12)}
html.pf-pnav-open .pf-pnav__launcher{display:none}
.pf-pnav__top{display:flex;align-items:center;gap:4px;height:40px;padding:0 8px;flex:none}
.pf-pnav__proj{flex:1;min-width:0;display:flex;align-items:center;gap:4px;height:28px;padding:0 6px;border:0;background:transparent;border-radius:6px;font:inherit;font-weight:600;color:#0f172a;cursor:pointer;text-align:left}
.pf-pnav__proj:hover{background:rgba(15,23,42,.06)}
.pf-pnav__brand{flex:none;width:20px;height:20px;display:inline-flex;margin-right:2px}
.pf-pnav__brand svg{width:100%;height:100%}
.pf-pnav__proj-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pf-pnav__caret{flex:none;font-size:10px;color:#94a3b8}
.pf-pnav__body{flex:1;min-height:0;overflow:auto;padding:6px 8px 16px}
.pf-pnav__item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border-radius:6px;color:#334155;text-decoration:none;line-height:1.4}
a.pf-pnav__item:hover{background:#f1f5f9;color:#0f172a}
.pf-pnav__item.is-current{background:var(--pf-brand-tint,#eef1f5);color:#0f172a;font-weight:600}
.pf-pnav__item.is-disabled{color:#94a3b8;cursor:default}
.pf-pnav__icon{flex:none;width:16px;height:16px;display:inline-flex;color:#64748b}
.pf-pnav__item.is-current .pf-pnav__icon{color:#0f172a}
.pf-pnav__item.is-disabled .pf-pnav__icon{color:#cbd5e1}
.pf-pnav__item-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pf-pnav__item-meta{flex:none;font-size:11px;color:#94a3b8;font-weight:400}
.pf-pnav__empty{padding:4px 8px;font-size:12px;color:#cbd5e1}
.pf-pnav__menu{position:absolute;left:8px;right:8px;top:40px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 8px 24px rgba(15,23,42,.12);padding:4px;z-index:81;max-height:360px;overflow:auto}
.pf-pnav__menu[hidden]{display:none}
.pf-pnav__menu button{position:relative;display:block;width:100%;text-align:left;border:0;background:none;padding:8px 25px 8px 10px;border-radius:6px;font:inherit;font-size:12.5px;color:#0f172a;cursor:pointer;overflow-wrap:anywhere}
.pf-pnav__menu button:hover{background:#f1f5f9}
.pf-pnav__menu button.is-current{cursor:default;background:none;font-weight:600}
.pf-pnav__menu button.is-current::after{content:"";position:absolute;right:10px;top:50%;transform:translateY(-50%);width:5px;height:5px;border-radius:50%;background:#0f172a}
.pf-pnav__menu-meta{display:block;font-size:11px;color:#94a3b8;margin-top:2px;font-weight:400}
`;

// 客户端脚本：只用 DOM API + textContent 建节点，项目名/产物标题都是用户内容，不拼 HTML 字符串。
// 注意这段是 Node 源码里的模板字符串：里面不要写带反斜杠的正则（会被外层模板字符串吃掉一个
// 反斜杠，见 tests/projectNav.test.js 的语法检查），地址解析用 split。
const NAV_SCRIPT = `
(function(){
  var D = window.__PF_PNAV__ || {}, nav = D.nav || { groups: [] }, cur = D.current || {};
  var seg = location.pathname.split("/");
  if (seg[1] !== "p" || !seg[2]) return;
  var key = seg[2];
  var root = document.documentElement;
  // 同步设上展开状态：脚本在 <body> 开头执行，页面内容还没画出来，展开的项目栏不会先闪一下收起
  if (D.open) root.classList.add("pf-pnav-open");
  function setOpen(v){
    root.classList.toggle("pf-pnav-open", v);
    try {
      fetch("/__protoflow_ui", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectNavOpen: v }) }).catch(function(){});
    } catch (e) {}
  }

  var SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  // 展开/收起共用一个侧栏图标（圆角框 + 左侧一条竖线，参考 Claude / Luma），线条比列表图标细一点，
  // 放在顶栏里不抢标题。产品页面自己已经没有侧栏开关了，不会撞。
  var ICON_SIDEBAR = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><line x1="9.5" y1="4" x2="9.5" y2="20"/></svg>';
  var ICON_OPEN = ICON_SIDEBAR, ICON_CLOSE = ICON_SIDEBAR;
  // 每类产物一个图标，列表里不分组、不要组头。
  // 类型图标由各产品提供（g.icon，产品注册描述里的 navIcon）；没给就用一个通用的文件图标
  var FALLBACK_ICON = SVG + '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>';
  function el(tag, cls, text){ var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function build(){
    var box = el("aside", "pf-pnav");
    var top = el("div", "pf-pnav__top");
    // 面板里的按钮负责收起；收起时唯一的入口是 launcher：优先放进产品页面预留的
    // [data-pf-nav-slot] 里（产品只留位置、不认识侧边栏），没留位置才悬浮在左上角。
    var toggle = el("button", "pf-pnav__toggle"); toggle.type = "button"; toggle.innerHTML = ICON_CLOSE; toggle.title = "收起项目栏";
    toggle.addEventListener("click", function(){ setOpen(false); menu.hidden = true; });
    // 产品可以留多个位置，每个位置放一个，显示哪个由产品自己的 CSS 决定。
    function launcher(){
      var b = el("button", "pf-pnav__launcher"); b.type = "button"; b.innerHTML = ICON_OPEN; b.title = "展开项目栏";
      b.addEventListener("click", function(){ setOpen(true); });
      return b;
    }
    function placeLaunchers(){
      var slots = document.querySelectorAll("[data-pf-nav-slot]");
      if (slots.length) slots.forEach(function(s){ s.appendChild(launcher()); });
      else { var f = launcher(); f.className += " pf-pnav__launcher--float"; document.body.appendChild(f); }
    }
    // 脚本插在 <body> 开头，那时页面里预留的位置还没解析出来，入口按钮等 DOM 就绪再放
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", placeLaunchers); else placeLaunchers();

    var proj = el("button", "pf-pnav__proj"); proj.type = "button"; proj.title = "切换项目";
    var brand = el("span", "pf-pnav__brand"); brand.innerHTML = ${JSON.stringify(BRAND_ICON_SVG)}; brand.setAttribute("aria-hidden", "true");
    proj.appendChild(brand);
    proj.appendChild(el("span", "pf-pnav__proj-name", (nav.project && nav.project.name) || ""));
    proj.appendChild(el("span", "pf-pnav__caret", "\\u25be"));
    top.appendChild(proj); top.appendChild(toggle);

    var menu = el("div", "pf-pnav__menu"); menu.hidden = true;
    proj.addEventListener("click", function(e){
      e.stopPropagation();
      if (!menu.hidden) { menu.hidden = true; return; }
      menu.hidden = false;
      menu.innerHTML = "";
      menu.appendChild(el("div", "pf-pnav__empty", "加载中…"));
      fetch("/__protoflow_projects").then(function(r){ return r.ok ? r.json() : []; }).catch(function(){ return []; })
        .then(function(list){
          menu.innerHTML = "";
          (Array.isArray(list) ? list : []).forEach(function(p){
            var isCur = p.id === decodeURIComponent(key);
            var b = el("button", isCur ? "is-current" : "", p.name || p.id);
            b.type = "button";
            if (isCur) b.setAttribute("aria-current", "true");
            if (p.lastOpenedAt) b.appendChild(el("span", "pf-pnav__menu-meta", String(p.lastOpenedAt).slice(0, 10)));
            if (!isCur) b.addEventListener("click", function(){ location.href = "/p/" + encodeURIComponent(p.id) + "/" + (nav.entry || ""); });
            menu.appendChild(b);
          });
          if (!menu.children.length) menu.appendChild(el("div", "pf-pnav__empty", "没有其它项目"));
        });
    });
    document.addEventListener("click", function(e){ if (!menu.hidden && !menu.contains(e.target) && e.target !== proj) menu.hidden = true; });
    document.addEventListener("keydown", function(e){ if (e.key === "Escape") menu.hidden = true; });

    var body = el("div", "pf-pnav__body");
    (nav.groups || []).forEach(function(g){
      (g.items || []).forEach(function(it){
        var isCur = cur.type === g.type && cur.id === it.id;
        var row = el(it.href && !isCur ? "a" : "div", "pf-pnav__item" + (isCur ? " is-current" : "") + (!it.href ? " is-disabled" : ""));
        if (it.href && !isCur) row.href = "/p/" + key + "/" + it.href;
        row.title = (g.label ? g.label + "：" : "") + it.title + (it.href ? "" : g.uninstalled ? "（这个产品没有启用，打不开；数据都还在）" : "（还没有定版，没有可看的版本）");
        var ic = el("span", "pf-pnav__icon"); ic.innerHTML = g.icon || FALLBACK_ICON;
        row.appendChild(ic);
        row.appendChild(el("span", "pf-pnav__item-title", it.title));
        if (it.meta) row.appendChild(el("span", "pf-pnav__item-meta", it.meta));
        body.appendChild(row);
      });
    });
    if (!body.children.length) body.appendChild(el("div", "pf-pnav__empty", "这个项目还没有产物"));

    box.appendChild(top); box.appendChild(menu); box.appendChild(body);
    document.body.insertBefore(box, document.body.firstChild);
  }
  build();
})();
`;
