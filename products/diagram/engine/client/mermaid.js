// 浏览器端：Mermaid。约定见同目录 README.md。依赖 window.mermaid。
(function () {
  var seq = 0;
  var inited = false;

  function init(theme) {
    if (inited) return;
    window.mermaid.initialize({ startOnLoad: false, theme: "base", themeVariables: theme || {}, securityLevel: "strict" });
    inited = true;
  }

  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function text(el) { return (el.textContent || "").replace(/\s+/g, " ").trim(); }

  // 源码里的行号（从 1 开始）。按 id 找时优先取"定义"那一行：id 后面紧跟形状括号、as 或冒号；
  // 找不到定义就取第一次出现。按文字找时取第一行包含这段文字的。
  function locate(source, id, label) {
    var lines = String(source || "").split(/\r?\n/);
    if (id) {
      var word = "(^|[^\\w\\u4e00-\\u9fa5])" + escapeRe(id) + "(?=$|[^\\w\\u4e00-\\u9fa5])";
      var any = new RegExp(word);
      var def = new RegExp(word + "\\s*(\\[|\\(|\\{|>|as\\s|:|\\s*$)");
      var first = -1;
      for (var i = 0; i < lines.length; i++) {
        if (!any.test(lines[i])) continue;
        if (first < 0) first = i;
        if (def.test(lines[i])) return [i + 1, i + 1];
      }
      if (first >= 0) return [first + 1, first + 1];
    }
    if (label) {
      for (var j = 0; j < lines.length; j++) if (lines[j].indexOf(label) >= 0) return [j + 1, j + 1];
    }
    return null;
  }

  // 流程图连线的 data-id：L_<起点>_<终点>_<n>。节点 id 里可能有下划线，按已知节点 id 找拆法。
  function edgeEnds(did, nodeIds) {
    var m = /^L_(.+)_\d+$/.exec(did || "");
    if (!m) return null;
    var parts = m[1].split("_");
    for (var i = 1; i < parts.length; i++) {
      var from = parts.slice(0, i).join("_"), to = parts.slice(i).join("_");
      if (nodeIds[from] && nodeIds[to]) return [from, to];
    }
    return null;
  }

  // 连线在源码里的行：同一行里先后出现起点和终点（链式写法 a --> b --> c 也能找到）。
  function locateEdge(source, from, to) {
    var w = function (id) { return "(^|[^\\w\\u4e00-\\u9fa5])" + escapeRe(id) + "(?=$|[^\\w\\u4e00-\\u9fa5])"; };
    var re = new RegExp(w(from) + "[\\s\\S]*" + w(to));
    var lines = String(source || "").split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) if (re.test(lines[i])) return [i + 1, i + 1];
    return null;
  }

  // g.node 的 id 形如 "<svg id>-flowchart-A-0"、"-state-待支付-1"、"-classId-订单-0"、"-entity-USER-0"，
  // 中间那段就是源码里的节点 id；子图（g.cluster）的 id 直接是 "<svg id>-S1"。Mermaid 自带的脑图
  // 节点只有序号（node_0），按文字匹配。
  var NODE_ID_RE = /^(?:flowchart|state|classId|entity)-(.+)-\d+$/;

  PFDiagram.register("mermaid", {
    render: function (stage, page, ctx) {
      init(ctx.theme);
      var id = "pfm" + (++seq);
      return window.mermaid.render(id, page.source).then(function (res) {
        stage.innerHTML = res.svg;
        var svg = stage.querySelector("svg");
        var vb = svg.viewBox && svg.viewBox.baseVal;
        svg.removeAttribute("style");
        if (vb && vb.width) {
          svg.setAttribute("width", String(Math.ceil(vb.width)));
          svg.setAttribute("height", String(Math.ceil(vb.height)));
        }
        svg.style.display = "block";
        svg.style.maxWidth = "none";
      }, function (err) {
        // 渲染失败时 mermaid 可能在 body 上留一个临时节点，清掉。
        var leftover = document.getElementById("d" + id);
        if (leftover) leftover.remove();
        throw new Error((err && (err.message || err.str)) || String(err));
      });
    },

    // 人能看到的每个元素都要能选中：框选整张图就是全选。先按图表类型认出有意义的对象（节点、连线、
    // 参与者、消息、备注），剩下有文字但没认出来的，兜底成按文字定位的对象。时序图竖着的生命线不算，
    // 它贯穿整张图，算进去框选任何区域都会带上它。
    nodes: function (stage, page) {
      var svg = stage.querySelector("svg");
      if (!svg) return [];
      var prefix = svg.id + "-";
      var src = page.source;
      var out = [];
      var covered = [];
      function push(els, key, info, lines) {
        els = els.filter(Boolean);
        if (!els.length) return;
        info.lines = lines !== undefined ? lines : locate(src, info.id, info.label);
        out.push({ el: els.length === 1 ? els[0] : els, key: key, info: info });
        covered = covered.concat(els);
      }
      function isCovered(el) {
        for (var i = 0; i < covered.length; i++) if (covered[i] === el || covered[i].contains(el)) return true;
        return false;
      }

      // 节点、子图（流程图、状态图、类图、ER 图、Mermaid 脑图）
      var nodeIds = {};
      svg.querySelectorAll("g.node, g.cluster").forEach(function (g) {
        var raw = g.id && g.id.indexOf(prefix) === 0 ? g.id.slice(prefix.length) : g.id || "";
        var label = text(g);
        var m = NODE_ID_RE.exec(raw);
        var nodeId = m ? m[1] : g.classList.contains("cluster") ? raw : "";
        if (/^root_(start|end)$/.test(nodeId)) { // 状态图的起止点
          push([g], "g:" + raw, { label: nodeId === "root_start" ? "[*] 起点" : "[*] 终点", match: "text" }, locate(src, null, "[*]"));
          return;
        }
        if (!label && !nodeId) return;
        if (nodeId) nodeIds[nodeId] = true;
        push([g], "g:" + (nodeId || raw), nodeId ? { label: label, id: nodeId, match: "id" } : { label: label, match: "text" });
      });

      // 连线：线 + 线上的文字。流程图的 data-id 形如 L_<起点>_<终点>_<n>，按已知节点 id 拆出起止点。
      svg.querySelectorAll("path[data-id]").forEach(function (path) {
        var did = path.getAttribute("data-id");
        var labelG = svg.querySelector('g.label[data-id="' + did.replace(/"/g, '\\"') + '"]');
        var caption = labelG ? text(labelG) : "";
        var ends = edgeEnds(did, nodeIds);
        var info = ends
          ? { label: ends[0] + " → " + ends[1] + (caption ? "（" + caption + "）" : ""), match: "id" }
          : { label: caption ? "连线：" + caption : "连线", match: "text" };
        push([path, caption ? labelG : null], "e:" + did, info, ends ? locateEdge(src, ends[0], ends[1]) : caption ? locate(src, null, caption) : null);
      });

      // 时序图：参与者（方框或小人，上下两处同一个 key），不含生命线
      svg.querySelectorAll("rect.actor[name]").forEach(function (r) {
        var pid = r.getAttribute("name");
        var label = r.nextElementSibling && r.nextElementSibling.tagName === "text" ? r.nextElementSibling : null;
        push([r, label], "actor:" + pid, { label: label ? text(label) : pid, id: pid, match: "id" });
      });
      svg.querySelectorAll("g.actor-man[name]").forEach(function (g) {
        var pid = g.getAttribute("name");
        push([g], "actor:" + pid, { label: text(g), id: pid, match: "id" });
      });
      // 时序图：消息 = 文字 + 箭头。按文档顺序配对：每条消息先画文字、再画线；多行文字（<br/>）是
      // 连续几个 text，都归给后面那条线。
      var pending = [], msg = 0;
      svg.querySelectorAll("text.messageText, line[class^='messageLine'], path[class^='messageLine']").forEach(function (el) {
        if (el.tagName === "text") { pending.push(el); return; }
        var texts = pending; pending = [];
        var label = texts.map(text).filter(Boolean).join(" ");
        push(texts.concat([el]), "msg:" + (msg++), { label: label || "消息", match: "text" }, texts.length ? locate(src, null, text(texts[0])) : null);
      });
      // 时序图：备注、loop / alt / opt 这类分组的标签
      svg.querySelectorAll("g[data-id]").forEach(function (g) {
        var note = g.querySelector("rect.note");
        if (note) { push([g], "note:" + g.getAttribute("data-id"), { label: text(g), match: "text" }); return; }
        var box = g.querySelector("polygon.labelBox");
        if (box) {
          var cond = g.querySelector("text.loopText");
          push([box, g.querySelector("text.labelText"), cond], "block:" + g.getAttribute("data-id"),
            { label: text(g.querySelector("text.labelText") || g) + (cond ? " " + text(cond) : ""), match: "text" },
            locate(src, null, cond ? text(cond).replace(/^\[|\]$/g, "") : ""));
        }
      });

      // 兜底：有文字但上面没认出来的元素（饼图、甘特图、旅程图……）
      svg.querySelectorAll("text, foreignObject").forEach(function (t, i) {
        var label = text(t);
        if (!label || isCovered(t)) return;
        push([t], "t:" + i, { label: label, match: "text" });
      });
      return out;
    },
  });
})();
