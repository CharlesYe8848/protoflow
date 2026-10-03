/* pf-kit.js — 幻灯片可选工具库（protoflow-slides skill 带的，要用就拷进幻灯片的 design/，配 pf-kit.css）：
 * 图标、图表、数字滚动、标题自适应。只处理 section 里的元素，不碰页面别的部分。长什么样由 CSS 变量决定（颜色 --accent 等、
 * 图表圆角 --chart-radius、图表字重 --chart-weight）。用法见 skill 的 references/kit.md。
 * 写错图标名、图表类型时 console.error（检查脚本会当脚本错误报出来）。
 *
 * 图标：<i data-icon="名字"></i> → 内联 SVG（跟文字同色，大小由外面的类决定）。可用的名字见 kit.md「图标」。
 *       图标来自 Lucide（ISC 许可，见 LICENSE-lucide.txt）。
 * 图表：<div class="chart" data-chart="类型" data-labels="7月,8月,9月" data-values="34,33,32" data-unit="%" data-highlight="2"></div>
 *   bar      柱状（竖）        hbar   条形（横）       funnel  漏斗（逐级递减）
 *   line     折线              ring   环形（单个值，data-max 缺省 100）
 *   progress 进度条（单个值，data-max 缺省 100）
 *   stacked  堆叠柱（每根柱子由几组数据叠成，顶上写合计）
 * 对比多组数据：data-values 用 | 分隔每一组，data-series 写每组的名字（比如 data-series="今年,去年"
 *   data-values="34,33,32|30,31,29"）。bar 画成并排的柱子，line 画成几条线，stacked 叠起来，都带图例。
 *   第一组是焦点（强调色），其余用灰色——把要说的那一组写在前面。
 *   data-highlight：用强调色标出第几项（从 0 开始）；不写时柱状、条形、折线标最后一项，漏斗标流失最大的一级。
 * 图表按容器的实际大小画成 SVG，文字是画布像素（不会随容器缩小），所以容器要给够空间——放在版式留好的图表区里。
 */
(function () {
  var ICONS = {"arrow-right":"<path d=\"M5 12h14\" /><path d=\"m12 5 7 7-7 7\" />","arrow-up-right":"<path d=\"M7 7h10v10\" /><path d=\"M7 17 17 7\" />","arrow-down-right":"<path d=\"m7 7 10 10\" /><path d=\"M17 7v10H7\" />","trending-up":"<path d=\"M16 7h6v6\" /><path d=\"m22 7-8.5 8.5-5-5L2 17\" />","trending-down":"<path d=\"M16 17h6v-6\" /><path d=\"m22 17-8.5-8.5-5 5L2 7\" />","chart-column":"<path d=\"M3 3v16a2 2 0 0 0 2 2h16\" /><path d=\"M18 17V9\" /><path d=\"M13 17V5\" /><path d=\"M8 17v-3\" />","chart-bar":"<path d=\"M3 3v16a2 2 0 0 0 2 2h16\" /><path d=\"M7 16h8\" /><path d=\"M7 11h12\" /><path d=\"M7 6h3\" />","chart-line":"<path d=\"M3 3v16a2 2 0 0 0 2 2h16\" /><path d=\"m19 9-5 5-4-4-3 3\" />","chart-pie":"<path d=\"M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z\" /><path d=\"M21.21 15.89A10 10 0 1 1 8 2.83\" />","target":"<circle cx=\"12\" cy=\"12\" r=\"10\" /><circle cx=\"12\" cy=\"12\" r=\"6\" /><circle cx=\"12\" cy=\"12\" r=\"2\" />","flag":"<path d=\"M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528\" />","rocket":"<path d=\"M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5\" /><path d=\"M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09\" /><path d=\"M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z\" /><path d=\"M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05\" />","zap":"<path d=\"M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z\" />","lightbulb":"<path d=\"M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5\" /><path d=\"M9 18h6\" /><path d=\"M10 22h4\" />","sparkles":"<path d=\"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z\" /><path d=\"M20 2v4\" /><path d=\"M22 4h-4\" /><circle cx=\"4\" cy=\"20\" r=\"2\" />","star":"<path d=\"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z\" />","heart":"<path d=\"M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5\" />","thumbs-up":"<path d=\"M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z\" /><path d=\"M7 10v12\" />","check":"<path d=\"M20 6 9 17l-5-5\" />","circle-check":"<circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"m16 9-5.5 5.5L8 12\" />","x":"<path d=\"M18 6 6 18\" /><path d=\"m6 6 12 12\" />","circle-x":"<circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"m15 9-6 6\" /><path d=\"m9 9 6 6\" />","circle-alert":"<circle cx=\"12\" cy=\"12\" r=\"10\" /><line x1=\"12\" x2=\"12\" y1=\"8\" y2=\"12\" /><line x1=\"12\" x2=\"12.01\" y1=\"16\" y2=\"16\" />","triangle-alert":"<path d=\"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3\" /><path d=\"M12 9v4\" /><path d=\"M12 17h.01\" />","info":"<circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"M12 16v-4\" /><path d=\"M12 8h.01\" />","shield":"<path d=\"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\" />","shield-check":"<path d=\"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\" /><path d=\"m9 12 2 2 4-4\" />","lock":"<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\" /><path d=\"M7 11V7a5 5 0 0 1 10 0v4\" />","key":"<path d=\"m2 21 9.6-9.6\" /><path d=\"m7.5 15.5 2.3 2.3a1 1 0 0 1 0 1.4l-2.1 2.1a1 1 0 0 1-1.4 0L4 19\" /><circle cx=\"15.5\" cy=\"7.5\" r=\"5.5\" />","user":"<path d=\"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2\" /><circle cx=\"12\" cy=\"7\" r=\"4\" />","users":"<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\" /><path d=\"M16 3.128a4 4 0 0 1 0 7.744\" /><path d=\"M22 21v-2a4 4 0 0 0-3-3.87\" /><circle cx=\"9\" cy=\"7\" r=\"4\" />","user-check":"<path d=\"m16 11 2 2 4-4\" /><path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\" /><circle cx=\"9\" cy=\"7\" r=\"4\" />","user-plus":"<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\" /><circle cx=\"9\" cy=\"7\" r=\"4\" /><line x1=\"19\" x2=\"19\" y1=\"8\" y2=\"14\" /><line x1=\"22\" x2=\"16\" y1=\"11\" y2=\"11\" />","briefcase":"<path d=\"M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16\" /><rect width=\"20\" height=\"14\" x=\"2\" y=\"6\" rx=\"2\" />","building-2":"<path d=\"M10 12h4\" /><path d=\"M10 8h4\" /><path d=\"M14 21v-3a2 2 0 0 0-4 0v3\" /><path d=\"M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2\" /><path d=\"M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16\" />","store":"<path d=\"M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5\" /><path d=\"M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244\" /><path d=\"M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05\" />","shopping-cart":"<path d=\"m2.05 2.05 1.099-.028a1 1 0 0 1 1.008.815l2.69 14.347A1 1 0 0 0 7.83 18H18\" /><path d=\"M4.563 5h16.435a1 1 0 0 1 .981 1.204l-1.026 6.226A2 2 0 0 1 18.962 14H6.25\" /><circle cx=\"18\" cy=\"20\" r=\"2\" /><circle cx=\"8\" cy=\"20\" r=\"2\" />","shopping-bag":"<path d=\"M16 10a4 4 0 0 1-8 0\" /><path d=\"M3.103 6.034h17.794\" /><path d=\"M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z\" />","credit-card":"<rect width=\"20\" height=\"14\" x=\"2\" y=\"5\" rx=\"2\" /><line x1=\"2\" x2=\"22\" y1=\"10\" y2=\"10\" /><path d=\"M6 14h2\" />","wallet":"<path d=\"M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1\" /><path d=\"M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4\" />","banknote":"<rect width=\"20\" height=\"12\" x=\"2\" y=\"6\" rx=\"2\" /><circle cx=\"12\" cy=\"12\" r=\"2\" /><path d=\"M6 12h.01M18 12h.01\" />","receipt":"<path d=\"M12 17V7\" /><path d=\"M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8\" /><path d=\"M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z\" />","package":"<path d=\"M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z\" /><path d=\"M12 22V12\" /><polyline points=\"3.29 7 12 12 20.71 7\" /><path d=\"m7.5 4.27 9 5.15\" />","truck":"<path d=\"M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2\" /><path d=\"M15 18H9\" /><path d=\"M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14\" /><circle cx=\"17\" cy=\"18\" r=\"2\" /><circle cx=\"7\" cy=\"18\" r=\"2\" />","map-pin":"<path d=\"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0\" /><circle cx=\"12\" cy=\"10\" r=\"3\" />","map":"<path d=\"M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z\" /><path d=\"M15 5.764v15\" /><path d=\"M9 3.236v15\" />","globe":"<circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20\" /><path d=\"M2 12h20\" />","smartphone":"<rect width=\"14\" height=\"20\" x=\"5\" y=\"2\" rx=\"2\" ry=\"2\" /><path d=\"M12 18h.01\" />","monitor":"<rect width=\"20\" height=\"14\" x=\"2\" y=\"3\" rx=\"2\" /><line x1=\"8\" x2=\"16\" y1=\"21\" y2=\"21\" /><line x1=\"12\" x2=\"12\" y1=\"17\" y2=\"21\" />","laptop":"<path d=\"M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z\" /><path d=\"M20.054 15.987H3.946\" />","tablet":"<rect width=\"16\" height=\"20\" x=\"4\" y=\"2\" rx=\"2\" ry=\"2\" /><line x1=\"12\" x2=\"12.01\" y1=\"18\" y2=\"18\" />","cloud":"<path d=\"M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z\" />","database":"<ellipse cx=\"12\" cy=\"5\" rx=\"9\" ry=\"3\" /><path d=\"M3 5V19A9 3 0 0 0 21 19V5\" /><path d=\"M3 12A9 3 0 0 0 21 12\" />","server":"<rect width=\"20\" height=\"8\" x=\"2\" y=\"2\" rx=\"2\" ry=\"2\" /><rect width=\"20\" height=\"8\" x=\"2\" y=\"14\" rx=\"2\" ry=\"2\" /><line x1=\"6\" x2=\"6.01\" y1=\"6\" y2=\"6\" /><line x1=\"6\" x2=\"6.01\" y1=\"18\" y2=\"18\" />","cpu":"<path d=\"M12 20v2\" /><path d=\"M12 2v2\" /><path d=\"M17 20v2\" /><path d=\"M17 2v2\" /><path d=\"M2 12h2\" /><path d=\"M2 17h2\" /><path d=\"M2 7h2\" /><path d=\"M20 12h2\" /><path d=\"M20 17h2\" /><path d=\"M20 7h2\" /><path d=\"M7 20v2\" /><path d=\"M7 2v2\" /><rect x=\"4\" y=\"4\" width=\"16\" height=\"16\" rx=\"2\" /><rect x=\"8\" y=\"8\" width=\"8\" height=\"8\" rx=\"1\" />","code":"<path d=\"m16 18 6-6-6-6\" /><path d=\"m8 6-6 6 6 6\" />","git-branch":"<path d=\"M15 6a9 9 0 0 0-9 9V3\" /><circle cx=\"18\" cy=\"6\" r=\"3\" /><circle cx=\"6\" cy=\"18\" r=\"3\" />","settings":"<path d=\"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915\" /><circle cx=\"12\" cy=\"12\" r=\"3\" />","wrench":"<path d=\"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z\" />","layers":"<path d=\"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z\" /><path d=\"M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12\" /><path d=\"M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17\" />","layout-grid":"<rect width=\"7\" height=\"7\" x=\"3\" y=\"3\" rx=\"1\" /><rect width=\"7\" height=\"7\" x=\"14\" y=\"3\" rx=\"1\" /><rect width=\"7\" height=\"7\" x=\"14\" y=\"14\" rx=\"1\" /><rect width=\"7\" height=\"7\" x=\"3\" y=\"14\" rx=\"1\" />","puzzle":"<path d=\"M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z\" />","workflow":"<rect width=\"8\" height=\"8\" x=\"3\" y=\"3\" rx=\"2\" /><path d=\"M7 11v4a2 2 0 0 0 2 2h4\" /><rect width=\"8\" height=\"8\" x=\"13\" y=\"13\" rx=\"2\" />","repeat":"<path d=\"m17 2 4 4-4 4\" /><path d=\"M3 11v-1a4 4 0 0 1 4-4h14\" /><path d=\"m7 22-4-4 4-4\" /><path d=\"M21 13v1a4 4 0 0 1-4 4H3\" />","refresh-cw":"<path d=\"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8\" /><path d=\"M21 3v5h-5\" /><path d=\"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16\" /><path d=\"M8 16H3v5\" />","clock":"<circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"M12 6v6l4 2\" />","timer":"<line x1=\"10\" x2=\"14\" y1=\"2\" y2=\"2\" /><line x1=\"12\" x2=\"15\" y1=\"14\" y2=\"11\" /><circle cx=\"12\" cy=\"14\" r=\"8\" />","calendar":"<path d=\"M8 2v3\" /><path d=\"M16 2v3\" /><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\" /><path d=\"M3 9h18\" />","hourglass":"<path d=\"M5 22h14\" /><path d=\"M5 2h14\" /><path d=\"M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22\" /><path d=\"M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2\" />","mail":"<path d=\"m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7\" /><rect x=\"2\" y=\"4\" width=\"20\" height=\"16\" rx=\"2\" />","message-circle":"<path d=\"M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719\" />","phone":"<path d=\"M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384\" />","bell":"<path d=\"M10.268 21a2 2 0 0 0 3.464 0\" /><path d=\"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326\" />","search":"<path d=\"m21 21-4.34-4.34\" /><circle cx=\"11\" cy=\"11\" r=\"8\" />","filter":"<path d=\"M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z\" />","file-text":"<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\" /><path d=\"M14 2v5a1 1 0 0 0 1 1h5\" /><path d=\"M10 9H8\" /><path d=\"M16 13H8\" /><path d=\"M16 17H8\" />","clipboard-list":"<rect width=\"8\" height=\"4\" x=\"8\" y=\"2\" rx=\"1\" ry=\"1\" /><path d=\"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2\" /><path d=\"M12 11h4\" /><path d=\"M12 16h4\" /><path d=\"M8 11h.01\" /><path d=\"M8 16h.01\" />","list-checks":"<path d=\"M13 5h8\" /><path d=\"M13 12h8\" /><path d=\"M13 19h8\" /><path d=\"m3 17 2 2 4-4\" /><path d=\"m3 7 2 2 4-4\" />","book-open":"<path d=\"M12 5v16\" /><path d=\"M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z\" />","graduation-cap":"<path d=\"M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z\" /><path d=\"M22 10v6\" /><path d=\"M6 12.5V16a6 3 0 0 0 12 0v-3.5\" />","handshake":"<path d=\"m11 17 2 2a1 1 0 1 0 3-3\" /><path d=\"m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4\" /><path d=\"m21 3 1 11h-2\" /><path d=\"M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3\" /><path d=\"M3 4h8\" />","award":"<path d=\"m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526\" /><circle cx=\"12\" cy=\"8\" r=\"6\" />","trophy":"<path d=\"M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2\" /><path d=\"M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2\" /><path d=\"M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3\" /><path d=\"M4 22h16\" /><path d=\"M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z\" /><path d=\"M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3\" />","gift":"<path d=\"M12 7v14\" /><path d=\"M20 11v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8\" /><path d=\"M7.5 7a1 1 0 0 1 0-5A4.8 8 0 0 1 12 7a4.8 8 0 0 1 4.5-5 1 1 0 0 1 0 5\" /><rect x=\"3\" y=\"7\" width=\"18\" height=\"4\" rx=\"1\" />","percent":"<line x1=\"19\" x2=\"5\" y1=\"5\" y2=\"19\" /><circle cx=\"6.5\" cy=\"6.5\" r=\"2.5\" /><circle cx=\"17.5\" cy=\"17.5\" r=\"2.5\" />","coins":"<path d=\"M13.744 17.736a6 6 0 1 1-7.48-7.48\" /><path d=\"M15 6h1v4\" /><path d=\"m6.134 14.768.866-.5 2 3.464\" /><circle cx=\"16\" cy=\"8\" r=\"6\" />","piggy-bank":"<path d=\"M11 17h3v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3a3.16 3.16 0 0 0 2-2h1a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1h-1a5 5 0 0 0-2-4V3a4 4 0 0 0-3.2 1.6l-.3.4H11a6 6 0 0 0-6 6v1a5 5 0 0 0 2 4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1z\" /><path d=\"M16 10h.01\" /><path d=\"M2 8v1a2 2 0 0 0 2 2h1\" />","scale":"<path d=\"M12 3v18\" /><path d=\"m19 8 3 8a5 5 0 0 1-6 0zV7\" /><path d=\"M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1\" /><path d=\"m5 8 3 8a5 5 0 0 1-6 0zV7\" /><path d=\"M7 21h10\" />","gauge":"<path d=\"m12 14 4-4\" /><path d=\"M3.34 19a10 10 0 1 1 17.32 0\" />","activity":"<path d=\"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2\" />","eye":"<path d=\"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0\" /><circle cx=\"12\" cy=\"12\" r=\"3\" />","mouse-pointer-click":"<path d=\"M14 4.1 12 6\" /><path d=\"m5.1 8-2.9-.8\" /><path d=\"m6 12-1.9 2\" /><path d=\"M7.2 2.2 8 5.1\" /><path d=\"M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z\" />","hand":"<path d=\"M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2\" /><path d=\"M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2\" /><path d=\"M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8\" /><path d=\"M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15\" />","bot":"<path d=\"M12 8V4H8\" /><rect width=\"16\" height=\"12\" x=\"4\" y=\"8\" rx=\"2\" /><path d=\"M2 14h2\" /><path d=\"M20 14h2\" /><path d=\"M15 13v2\" /><path d=\"M9 13v2\" />","brain":"<path d=\"M12 18V5\" /><path d=\"M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4\" /><path d=\"M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5\" /><path d=\"M17.997 5.125a4 4 0 0 1 2.526 5.77\" /><path d=\"M18 18a4 4 0 0 0 2-7.464\" /><path d=\"M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517\" /><path d=\"M6 18a4 4 0 0 1-2-7.464\" /><path d=\"M6.003 5.125a4 4 0 0 0-2.526 5.77\" />","headphones":"<path d=\"M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3\" />","link":"<path d=\"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71\" /><path d=\"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71\" />","share-2":"<circle cx=\"18\" cy=\"5\" r=\"3\" /><circle cx=\"6\" cy=\"12\" r=\"3\" /><circle cx=\"18\" cy=\"19\" r=\"3\" /><line x1=\"8.59\" x2=\"15.42\" y1=\"13.51\" y2=\"17.49\" /><line x1=\"15.41\" x2=\"8.59\" y1=\"6.51\" y2=\"10.49\" />","download":"<path d=\"M12 15V3\" /><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" /><path d=\"m7 10 5 5 5-5\" />","upload":"<path d=\"M12 3v12\" /><path d=\"m17 8-5-5-5 5\" /><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" />","send":"<path d=\"M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z\" /><path d=\"m21.854 2.147-10.94 10.939\" />","compass":"<circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z\" />","route":"<circle cx=\"6\" cy=\"19\" r=\"3\" /><path d=\"M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15\" /><circle cx=\"18\" cy=\"5\" r=\"3\" />","leaf":"<path d=\"M11 20a10 10 0 0010-10 25.9 25.9 0 00-1.04-7.281 1 1 0 00-1.755-.325C15.833 5.5 13 5.5 9.8 6.1A7 7 0 0011 20\" /><path d=\"M2 21a5 5 0 012.911-4.544C7.613 15.212 8.351 15.24 11 13\" />","circle-dollar-sign":"<circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8\" /><path d=\"M12 18V6\" />","badge-percent":"<path d=\"M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z\" /><path d=\"m15 9-6 6\" /><path d=\"M9 9h.01\" /><path d=\"M15 15h.01\" />","chart-no-axes-combined":"<path d=\"M12 16v5\" /><path d=\"M16 14.639V21\" /><path d=\"M20 10.656V21\" /><path d=\"m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15\" /><path d=\"M4 18.463V21\" /><path d=\"M8 14.656V21\" />","funnel":"<path d=\"M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z\" />","scan-line":"<path d=\"M3 7V5a2 2 0 0 1 2-2h2\" /><path d=\"M17 3h2a2 2 0 0 1 2 2v2\" /><path d=\"M21 17v2a2 2 0 0 1-2 2h-2\" /><path d=\"M7 21H5a2 2 0 0 1-2-2v-2\" /><path d=\"M7 12h10\" />","qr-code":"<rect width=\"5\" height=\"5\" x=\"3\" y=\"3\" rx=\"1\" /><rect width=\"5\" height=\"5\" x=\"16\" y=\"3\" rx=\"1\" /><rect width=\"5\" height=\"5\" x=\"3\" y=\"16\" rx=\"1\" /><path d=\"M21 16h-3a2 2 0 0 0-2 2v3\" /><path d=\"M21 21v.01\" /><path d=\"M12 7v3a2 2 0 0 1-2 2H7\" /><path d=\"M3 12h.01\" /><path d=\"M12 3h.01\" /><path d=\"M12 16v.01\" /><path d=\"M16 12h1\" /><path d=\"M21 12v.01\" /><path d=\"M12 21v-1\" />","fingerprint":"<path d=\"M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4\" /><path d=\"M14 13.12c0 2.38 0 6.38-1 8.88\" /><path d=\"M17.29 21.02c.12-.6.43-2.3.5-3.02\" /><path d=\"M2 12a10 10 0 0 1 18-6\" /><path d=\"M2 16h.01\" /><path d=\"M21.8 16c.2-2 .131-5.354 0-6\" /><path d=\"M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2\" /><path d=\"M8.65 22c.21-.66.45-1.32.57-2\" /><path d=\"M9 6.8a6 6 0 0 1 9 5.2v2\" />"};
  var NS = "http://www.w3.org/2000/svg";

  function renderIcon(el) {
    var inner = ICONS[el.getAttribute("data-icon")];
    if (!inner) { el.setAttribute("data-icon-missing", ""); console.error("[pf-kit] 没有这个图标：" + el.getAttribute("data-icon") + "（可用的见 references/kit.md）"); return; }
    el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + "</svg>";
  }

  function list(s) { return String(s || "").split(",").map(function (x) { return x.trim(); }).filter(function (x) { return x !== ""; }); }
  function fmt(v, unit) { var n = Math.round(v * 10) / 10; return (n % 1 === 0 ? String(n) : n.toFixed(1)) + (unit || ""); }
  function el(tag, attrs, text) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  function renderChart(box) {
    var type = box.getAttribute("data-chart");
    var labels = list(box.getAttribute("data-labels"));
    var series = String(box.getAttribute("data-values") || "").split("|").map(function (g) { return list(g).map(Number); }).filter(function (g) { return g.length; });
    var values = series[0] || [];
    var names = list(box.getAttribute("data-series"));
    var multi = series.length > 1 || type === "stacked";
    var unit = box.getAttribute("data-unit") || "";
    var hl = box.hasAttribute("data-highlight") ? Number(box.getAttribute("data-highlight")) : null;
    // 按容器的实际大小画（进度条这种扁的图表高度就是那几十像素，不能给个最小值，不然会被等比压缩）
    var W = Math.max(1, box.clientWidth), H = Math.max(1, box.clientHeight);
    var cs = getComputedStyle(box);
    var C = {
      accent: cs.getPropertyValue("--accent").trim() || "#2f54eb",
      ink: cs.getPropertyValue("--ink").trim() || "#0f172a",
      muted: cs.getPropertyValue("--muted").trim() || "#64748b",
      soft: cs.getPropertyValue("--chart-soft").trim() || "#cbd5e1",
      line: cs.getPropertyValue("--line").trim() || "#e2e8f0",
    };
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img", "font-family": cs.fontFamily });
    var LBL = 30, VAL = 36; // 画布像素
    var max = Math.max.apply(null, values.concat([Number(box.getAttribute("data-max")) || 0])) || 1;
    C.ink2 = cs.getPropertyValue("--ink-2").trim() || "#334155";
    var R0 = Number(cs.getPropertyValue("--chart-radius").trim() || 6), WB = cs.getPropertyValue("--chart-weight").trim() || "700";
    // 多组数据：第一组强调色，其余灰；顶上画图例，图表整体往下让出图例的高度
    var palette = type === "stacked" ? [C.accent, C.ink2, C.soft, C.line] : [C.accent, C.soft, C.ink2, C.line];
    var legendH = 0;
    if (multi) {
      legendH = LBL + 36;
      var lx = 0;
      series.forEach(function (_, k) {
        var name = names[k] || ("第 " + (k + 1) + " 组");
        svg.appendChild(el("rect", { x: lx, y: 4, width: 26, height: 26, rx: R0, fill: palette[k % palette.length] }));
        svg.appendChild(el("text", { x: lx + 40, y: 28, "font-size": LBL, fill: C.ink, "font-weight": k === 0 ? 700 : 400 }, name));
        lx += 40 + name.length * LBL + 56;
      });
    }
    var g = el("g", { transform: "translate(0," + legendH + ")" });
    svg.appendChild(g);
    H = H - legendH;
    var add = function (node) { g.appendChild(node); };

    if ((type === "bar" && series.length > 1) || type === "stacked") {
      // 并排柱（bar 多组）/ 堆叠柱（stacked）
      var cats = Math.max.apply(null, series.map(function (x) { return x.length; }));
      var totals = []; for (var c = 0; c < cats; c++) totals.push(series.reduce(function (a, x) { return a + (x[c] || 0); }, 0));
      var smax = type === "stacked" ? Math.max.apply(null, totals) : Math.max.apply(null, series.map(function (x) { return Math.max.apply(null, x); }));
      smax = Math.max(smax, Number(box.getAttribute("data-max")) || 0) || 1;
      var slot = W / cats, top2 = VAL + 24, bottom2 = H - LBL - 28, groupW = slot * 0.7;
      for (var ci = 0; ci < cats; ci++) {
        var gx = ci * slot + (slot - groupW) / 2;
        if (type === "stacked") {
          var acc = 0;
          series.forEach(function (x, k) {
            var v = x[ci] || 0, h = (bottom2 - top2) * v / smax, y = bottom2 - (bottom2 - top2) * (acc + v) / smax;
            add(el("rect", { x: gx, y: y, width: groupW, height: Math.max(h - 3, 0), fill: palette[k % palette.length], rx: Math.min(R0, 4) }));
            if (h > LBL + 10) add(el("text", { x: gx + groupW / 2, y: y + h / 2 + LBL * 0.35, "text-anchor": "middle", "font-size": LBL - 2, fill: k === 0 || k === 1 ? "#fff" : C.ink }, fmt(v, unit)));
            acc += v;
          });
          add(el("text", { x: gx + groupW / 2, y: bottom2 - (bottom2 - top2) * totals[ci] / smax - 14, "text-anchor": "middle", "font-size": VAL, "font-weight": WB, fill: C.ink }, fmt(totals[ci], unit)));
        } else {
          var bw2 = groupW / series.length;
          series.forEach(function (x, k) {
            var v = x[ci] || 0, h = (bottom2 - top2) * v / smax, bx = gx + k * bw2 + 4, y = bottom2 - h;
            add(el("rect", { x: bx, y: y, width: bw2 - 8, height: Math.max(h, 2), rx: R0, fill: palette[k % palette.length] }));
            add(el("text", { x: bx + (bw2 - 8) / 2, y: y - 12, "text-anchor": "middle", "font-size": k === 0 ? VAL - 4 : LBL - 4, "font-weight": k === 0 ? 800 : 400, fill: k === 0 ? C.accent : C.muted }, fmt(v, unit)));
          });
        }
        add(el("text", { x: ci * slot + slot / 2, y: H - 8, "text-anchor": "middle", "font-size": LBL, fill: C.muted }, labels[ci] || ""));
      }
      add(el("line", { x1: 0, x2: W, y1: bottom2, y2: bottom2, stroke: C.line, "stroke-width": 3 }));
    } else if (type === "line" && series.length > 1) {
      // 多条线：第一组强调色、粗；其余灰、细。每条线末端写组名和最后一个值
      var all2 = [].concat.apply([], series), lo2 = Math.min.apply(null, all2), hi2 = Math.max.apply(null, all2), pad2 = (hi2 - lo2) * 0.15 || 1;
      var nPts = Math.max.apply(null, series.map(function (x) { return x.length; }));
      var t2 = 40, b2 = H - LBL - 32, l2 = 40, r2 = W - 220;
      var px2 = function (i) { return nPts > 1 ? l2 + (r2 - l2) * i / (nPts - 1) : (l2 + r2) / 2; };
      var py2 = function (v) { return b2 - (b2 - t2) * (v - (lo2 - pad2)) / ((hi2 + pad2) - (lo2 - pad2)); };
      add(el("line", { x1: 0, x2: W, y1: b2, y2: b2, stroke: C.line, "stroke-width": 3 }));
      // 末端数字：按线末端的高度排好，挨得太近就上下推开，不叠在一起
      var ends = series.map(function (x, k) { var li = x.length - 1; return { k: k, y: py2(x[li]), v: x[li], x: px2(li) }; }).sort(function (a, b) { return a.y - b.y; });
      for (var ei = 1; ei < ends.length; ei++) if (ends[ei].y - ends[ei - 1].y < VAL + 8) ends[ei].y = ends[ei - 1].y + VAL + 8;
      series.slice().reverse().forEach(function (x, rk) {
        var k = series.length - 1 - rk, col = palette[k % palette.length], main = k === 0;
        add(el("polyline", { points: x.map(function (v, i) { return px2(i) + "," + py2(v); }).join(" "), fill: "none", stroke: col, "stroke-width": main ? 7 : 5, "stroke-linejoin": "round", "stroke-linecap": "round" }));
        var li = x.length - 1;
        add(el("circle", { cx: px2(li), cy: py2(x[li]), r: main ? 14 : 9, fill: col }));
      });
      ends.forEach(function (e) {
        var main = e.k === 0;
        add(el("text", { x: e.x + 28, y: e.y + (main ? VAL : LBL) * 0.35, "font-size": main ? VAL : LBL, "font-weight": main ? 800 : 400, fill: main ? C.accent : C.muted }, fmt(e.v, unit)));
      });
      for (var li2 = 0; li2 < nPts; li2++) add(el("text", { x: px2(li2), y: H - 8, "text-anchor": "middle", "font-size": LBL, fill: C.muted }, labels[li2] || ""));
    } else if (type === "bar") {
      if (hl == null) hl = values.length - 1;
      var n = values.length, gap = W / n * 0.32, bw = W / n - gap, top = VAL + 24, bottom = H - LBL - 28;
      values.forEach(function (v, i) {
        var h = (bottom - top) * v / max, x = i * (bw + gap) + gap / 2, y = bottom - h;
        add(el("rect", { x: x, y: y, width: bw, height: Math.max(h, 2), rx: R0, fill: i === hl ? C.accent : C.soft }));
        add(el("text", { x: x + bw / 2, y: y - 14, "text-anchor": "middle", "font-size": VAL, "font-weight": WB, fill: i === hl ? C.accent : C.ink }, fmt(v, unit)));
        add(el("text", { x: x + bw / 2, y: H - 8, "text-anchor": "middle", "font-size": LBL, fill: C.muted }, labels[i] || ""));
      });
      add(el("line", { x1: 0, x2: W, y1: bottom, y2: bottom, stroke: C.line, "stroke-width": 3 }));
    } else if (type === "hbar") {
      var nn = values.length, rowH = H / nn, bh = Math.min(rowH * 0.56, 88);
      var labelW = Math.min(W * 0.28, 340), valW = 150, span = W - labelW - valW;
      if (hl == null) hl = values.indexOf(max);
      values.forEach(function (v, i) {
        var cy = rowH * i + rowH / 2, w = Math.max(span * v / max, 4), on = i === hl;
        add(el("rect", { x: labelW, y: cy - bh / 2, width: span, height: bh, rx: R0 ? bh / 2 : 0, fill: C.line, opacity: 0.55 }));
        add(el("rect", { x: labelW, y: cy - bh / 2, width: w, height: bh, rx: R0 ? bh / 2 : 0, fill: on ? C.accent : C.soft }));
        add(el("text", { x: 0, y: cy + LBL * 0.35, "font-size": LBL, "font-weight": on ? 700 : 400, fill: C.ink }, labels[i] || ""));
        add(el("text", { x: W, y: cy + VAL * 0.35, "text-anchor": "end", "font-size": VAL, "font-weight": WB, fill: on ? C.accent : C.ink }, fmt(v, unit)));
      });
    } else if (type === "funnel") {
      // 经典漏斗：第 i 段梯形上沿按第 i 级的值、下沿接第 i+1 级，整体连成一个漏斗，占满宽度。
      // 左边贴着漏斗边缘写环节和数值，右边在两级交界处写转化率——文字跟着漏斗往里收。
      // 高亮的是"流失最大的那一步"（data-highlight 写第几级，从 0 数，指这一步的结果那一级）：
      // 收窄的那段梯形用强调色，交界处写"流失 x%"，那一级的数值也标成强调色。
      var fn = values.length, gapY = 8, rowH2 = (H - gapY * (fn - 1)) / fn;
      var side = Math.min(W * 0.2, 260), fw = W - side * 2, fcx = W / 2;
      if (hl == null) { var drop = -1; hl = 1; for (var k = 1; k < fn; k++) if (values[k - 1] - values[k] > drop) { drop = values[k - 1] - values[k]; hl = k; } }
      var widthOf = function (v) { return Math.max(fw * v / max, fw * 0.22); };
      values.forEach(function (v, i) {
        var y0 = i * (rowH2 + gapY), y1 = y0 + rowH2, top = widthOf(v), bot = i + 1 < fn ? widthOf(values[i + 1]) : top * 0.82;
        var hot = i + 1 === hl; // 这段梯形就是那一步的流失
        var pts = [[fcx - top / 2, y0], [fcx + top / 2, y0], [fcx + bot / 2, y1], [fcx - bot / 2, y1]].map(function (p) { return p.join(","); }).join(" ");
        add(el("polygon", { points: pts, fill: hot ? C.accent : C.soft }));
        var cy = y0 + rowH2 / 2, lx = fcx - top / 2 - 28, isRes = i === hl; // 贴着这一段最宽处（上沿）的左边，不压到图形
        add(el("text", { x: lx, y: cy - 8, "text-anchor": "end", "font-size": LBL, fill: C.muted }, labels[i] || ""));
        add(el("text", { x: lx, y: cy + VAL + 4, "text-anchor": "end", "font-size": VAL + 12, "font-weight": WB, fill: isRes ? C.accent : C.ink }, fmt(v, unit)));
        if (i + 1 < fn) {
          var rate = v ? values[i + 1] / v * 100 : 0, rx = fcx + (top + bot) / 4 + 32;
          add(el("text", { x: rx, y: cy + LBL * 0.35, "font-size": LBL, "font-weight": hot ? 800 : 400, fill: hot ? C.accent : C.muted },
            hot ? "流失 " + fmt(100 - rate, "%") : "转化 " + fmt(rate, "%")));
        }
      });
    } else if (type === "line") {
      if (hl == null) hl = values.length - 1;
      var lo = Math.min.apply(null, values), hi = max, pad = (hi - lo) * 0.15 || 1;
      var t = VAL + 36, b = H - LBL - 32, l = 40, r = W - 40;
      var px = function (i) { return values.length > 1 ? l + (r - l) * i / (values.length - 1) : (l + r) / 2; };
      var py = function (v) { return b - (b - t) * (v - (lo - pad)) / ((hi + pad) - (lo - pad)); };
      add(el("line", { x1: 0, x2: W, y1: b, y2: b, stroke: C.line, "stroke-width": 3 }));
      add(el("polyline", { points: values.map(function (v, i) { return px(i) + "," + py(v); }).join(" "), fill: "none", stroke: C.ink, "stroke-width": 6, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      values.forEach(function (v, i) {
        var on = i === hl;
        add(el("circle", { cx: px(i), cy: py(v), r: on ? 16 : 9, fill: on ? C.accent : C.ink }));
        // 只标起点和高亮的点：每个点都标数字会压到线上，也抢了焦点
        // 起点的数字放在点的下方（线从这里往上走，放上方会压到线）
        if (on || i === 0) add(el("text", { x: px(i), y: on ? py(v) - 32 : py(v) + 52, "text-anchor": i === 0 ? "start" : on && i === values.length - 1 ? "end" : "middle", "font-size": on ? VAL + 8 : LBL, "font-weight": on ? 800 : 400, fill: on ? C.accent : C.muted }, fmt(v, unit)));
        add(el("text", { x: px(i), y: H - 8, "text-anchor": "middle", "font-size": LBL, fill: C.muted }, labels[i] || ""));
      });
    } else if (type === "ring") {
      var v0 = values[0] || 0, mx = Number(box.getAttribute("data-max")) || 100;
      var R = Math.min(W, H) / 2 - 20, sw = Math.max(R * 0.16, 18), cx = W / 2, cy = H / 2, circ = 2 * Math.PI * (R - sw / 2);
      add(el("circle", { cx: cx, cy: cy, r: R - sw / 2, fill: "none", stroke: C.line, "stroke-width": sw }));
      add(el("circle", { cx: cx, cy: cy, r: R - sw / 2, fill: "none", stroke: C.accent, "stroke-width": sw, "stroke-linecap": "round",
        "stroke-dasharray": (circ * Math.min(v0 / mx, 1)) + " " + circ, transform: "rotate(-90 " + cx + " " + cy + ")" }));
      add(el("text", { x: cx, y: cy + R * 0.14, "text-anchor": "middle", "font-size": Math.max(R * 0.42, 40), "font-weight": WB, fill: C.ink }, fmt(v0, unit)));
      if (labels[0]) add(el("text", { x: cx, y: cy + R * 0.14 + Math.max(R * 0.22, LBL) + 8, "text-anchor": "middle", "font-size": LBL, fill: C.muted }, labels[0]));
    } else if (type === "progress") {
      var p = values[0] || 0, pm = Number(box.getAttribute("data-max")) || 100, th = Math.min(H, 20);
      add(el("rect", { x: 0, y: (H - th) / 2, width: W, height: th, rx: th / 2, fill: C.line }));
      add(el("rect", { x: 0, y: (H - th) / 2, width: Math.max(W * Math.min(p / pm, 1), th), height: th, rx: th / 2, fill: C.accent }));
    } else {
      box.setAttribute("data-chart-unknown", "");
      console.error("[pf-kit] 不认识的图表类型：" + type + "（可用：bar hbar funnel line ring progress stacked）");
      return;
    }
    markAnimations(g, type, series.length > 1);
    box.innerHTML = "";
    box.appendChild(svg);
  }

  // 动效标记：图画完后按图的类型给图形打上 pf-a-* 类，怎么动写在 base.css（翻到这一页才动；导出、检查、总览不动）。
  //   pf-a-y 由下往上长（柱）、pf-a-x 由左往右伸（条形、进度）、pf-a-drop 一级级往下展开（漏斗）、
  //   pf-a-draw 沿路径画出（折线）、pf-a-pop 弹出（点）、pf-a-sweep 转一圈（环形）、pf-a-fade 最后淡入（数字、标签）。
  // --i 是同类里的第几个，用来错开时间。
  function markAnimations(g, type, multi) {
    var n = {};
    var mark = function (node, cls) { node.classList.add(cls); node.style.setProperty("--i", n[cls] = (n[cls] || 0) + 1); };
    Array.prototype.forEach.call(g.children, function (node) {
      var tag = node.tagName.toLowerCase();
      if (tag === "text") return mark(node, "pf-a-fade");
      if (type === "bar" || type === "stacked") { if (tag === "rect") mark(node, "pf-a-y"); }
      else if (type === "hbar") { if (tag === "rect" && node.getAttribute("opacity") == null) mark(node, "pf-a-x"); }
      else if (type === "progress") { if (tag === "rect" && node.previousSibling) mark(node, "pf-a-x"); }
      else if (type === "funnel") { if (tag === "polygon") mark(node, "pf-a-drop"); }
      else if (type === "line") {
        if (tag === "polyline") { node.setAttribute("pathLength", "1"); mark(node, "pf-a-draw"); }
        else if (tag === "circle") mark(node, "pf-a-pop");
      } else if (type === "ring") {
        if (tag === "circle" && node.getAttribute("stroke-dasharray")) {
          node.style.setProperty("--len", String(parseFloat(node.getAttribute("stroke-dasharray"))));
          mark(node, "pf-a-sweep");
        }
      }
    });
  }

  // 数字滚动：翻到这一页时，写了 data-count 的元素里的数从 0 滚到目标值，保留前后缀（+、%、s、万、<small>秒</small>）。
  // 自己的版式里要滚的数字可以登记：(window.PFDesign = window.PFDesign || {}, PFDesign.countSelectors = PFDesign.countSelectors || []).push("…")
  // （翻页时才取，先后都行）。
  // 滚完恢复原样；导出、检查（减少动态效果）、总览时不滚。用 setTimeout 不用 requestAnimationFrame（后台、无头浏览器里 rAF 不可靠）。
  // 别的脚本可能先加载、先登记了（window.PFDesign.countSelectors），合在一起，跟文件先后无关
  var COUNT_SELECTORS = (window.PFDesign && window.PFDesign.countSelectors) || [];
  COUNT_SELECTORS.push("section [data-count]");
  function motionOK() {
    var root = document.documentElement;
    return !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      && !root.classList.contains("pf-print") && !root.classList.contains("pf-overview");
  }
  // 两步：翻到这一页的那一刻（壳子在切页时同步发 pf:enter，还没画出来）先把数字置成 0，
  // 等数字跟着整块淡入时再开始滚——不然会先闪出最终值、再跳回 0 往上滚。
  function prepareCount(el) {
    clearTimeout(el.__pfTimer);
    if (el.__pfOrig == null) el.__pfOrig = el.innerHTML;
    el.innerHTML = el.__pfOrig;
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), tn = null, m = null;
    while (walker.nextNode()) { m = /^([^\d-]*)(-?\d[\d,]*\.?\d*)([\s\S]*)$/.exec(walker.currentNode.data); if (m) { tn = walker.currentNode; break; } }
    if (!tn) return null;
    var target = parseFloat(m[2].replace(/,/g, "")), dec = (m[2].split(".")[1] || "").length, comma = m[2].indexOf(",") >= 0;
    var fmt = function (v) { var t = v.toFixed(dec); return comma ? t.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : t; };
    var show = function (e) { tn.data = m[1] + fmt(target * e) + m[3]; };
    show(0);
    return function run() {
      var start = Date.now(), dur = 900;
      (function tick() {
        var t = Math.min(1, (Date.now() - start) / dur);
        show(1 - Math.pow(1 - t, 3));
        if (t < 1) el.__pfTimer = setTimeout(tick, 30); else el.innerHTML = el.__pfOrig;
      })();
    };
  }
  function onActivate(slide) {
    if (!motionOK()) return;
    Array.prototype.forEach.call(slide.querySelectorAll(COUNT_SELECTORS.join(", ")), function (el) {
      var run = prepareCount(el);
      if (run) el.__pfTimer = setTimeout(run, 150);
    });
  }
  // 壳子翻到一页时在它的 section 上发 pf:enter（冒泡）
  document.addEventListener("pf:enter", function (e) { onActivate(e.target); });

  // 标题自适应（写了 data-nofit 的不管）：短标题（≤ 14 个字）不许折行、中等的最多两行、再长最多三行；放不下就逐步缩小字号，最小到原来的 70%
  // （还放不下是内容太长，检查脚本会报，该删字或拆页）。用 offsetHeight 量，不受画布缩放影响。
  function fitHeadings() {
    Array.prototype.forEach.call(document.querySelectorAll("section h1, section h2, section blockquote"), function (h) {
      if (h.closest(".chart, .mermaid, [data-nofit]")) return;
      var n = (h.textContent || "").replace(/\s+/g, "").length;
      if (!n) return;
      h.style.fontSize = ""; h.style.wordBreak = "";
      var base = parseFloat(getComputedStyle(h).fontSize), size = base;
      // 写了 <br> 的是作者自己断的行，每个 <br> 多给一行
      var maxLines = (n <= 14 ? 1 : n <= 30 ? 2 : 3) + h.querySelectorAll("br").length;
      var fits = function () {
        var lh = parseFloat(getComputedStyle(h).lineHeight) || size * 1.2;
        return h.offsetHeight / lh <= maxLines + 0.3 && h.scrollWidth <= h.clientWidth + 2;
      };
      for (var i = 0; i < 12 && !fits() && size > base * 0.7; i++) {
        size = Math.max(size * 0.94, base * 0.7);
        h.style.fontSize = size + "px";
      }
      // 只在标点处折行放不下（整句没有标点、又太长）：退回按字折行
      if (!fits()) h.style.wordBreak = "normal";
    });
  }

  function renderAll() {
    fitHeadings();
    Array.prototype.forEach.call(document.querySelectorAll("section .chart[data-chart]"), renderChart);
    window.PFDesign.ready = true;
  }
  function init() {
    Array.prototype.forEach.call(document.querySelectorAll("section [data-icon]"), renderIcon);
    renderAll();
    // 字体晚到时重新量一次（标题宽度会变，图表跟着重画）
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(renderAll);
  }
  window.PFDesign = Object.assign(window.PFDesign || {}, { icons: Object.keys(ICONS), charts: ["bar", "hbar", "funnel", "line", "ring", "progress", "stacked"], countSelectors: COUNT_SELECTORS, render: init, ready: false });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
