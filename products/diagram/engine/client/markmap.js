// 浏览器端：Markmap 脑图。约定见同目录 README.md。依赖 window.d3、window.markmap（markmap-view）。
(function () {
  // 按层级从深到浅的灰，跟 ProtoFlow 的黑白品牌色一致；最深一级也要在白底上看得清。
  var COLORS = ["#0f172a", "#475569", "#7b889a", "#9aa5b4"];
  var PAD = 24;

  function plainText(html) {
    var d = document.createElement("div");
    d.innerHTML = html || "";
    return (d.textContent || "").replace(/\s+/g, " ").trim();
  }

  function walk(node, parents, visit) {
    visit(node, parents);
    (node.children || []).forEach(function (c) { walk(c, parents.concat([node]), visit); });
  }

  PFDiagram.register("markmap", {
    render: function (stage, page, ctx) {
      var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "pf-markmap");
      svg.style.width = "10px";
      svg.style.height = "10px";
      stage.appendChild(svg);
      var mm = new window.markmap.Markmap(svg, {
        // 首次渲染不要动画：渲染完成时节点就得在最终位置上，选择、框选才量得准；之后折叠展开再用动画。
        zoom: false, pan: false, autoFit: false, duration: 0,
        spacingHorizontal: 64, spacingVertical: 8, paddingX: 8, maxWidth: 320,
        color: function (node) { return COLORS[Math.min((node.state && node.state.depth) || 0, COLORS.length - 1)]; },
      });
      stage.__pfMarkmap = mm;
      // 画面的平移缩放由预览页统一做：svg 缩到内容本身的大小，内容挪到左上角。
      function fitSvg() {
        var r = mm.state.rect;
        if (!r) return;
        svg.style.width = Math.ceil(r.x2 - r.x1 + PAD * 2) + "px";
        svg.style.height = Math.ceil(r.y2 - r.y1 + PAD * 2) + "px";
        mm.svg.call(mm.zoom.transform, window.d3.zoomIdentity.translate(PAD - r.x1, PAD - r.y1));
      }
      var renderData = mm.renderData.bind(mm);
      mm.renderData = function () {
        return renderData.apply(null, arguments).then(function (res) { fitSvg(); ctx.resized(); return res; });
      };
      var data = JSON.parse(JSON.stringify((page.data && page.data.root) || { content: "", children: [] }));
      return mm.setData(data).then(function () { fitSvg(); mm.options.duration = 200; });
    },

    nodes: function (stage) {
      var mm = stage.__pfMarkmap;
      if (!mm || !mm.state.data) return [];
      var parentsById = {};
      walk(mm.state.data, [], function (node, parents) { parentsById[node.state.id] = parents; });
      var out = [];
      stage.querySelectorAll("g.markmap-node").forEach(function (g) {
        var d = window.d3.select(g).datum();
        if (!d || !d.state) return;
        var label = plainText(d.content);
        if (!label) return;
        var path = (parentsById[d.state.id] || []).map(function (p) { return plainText(p.content); }).filter(Boolean);
        path.push(label);
        var lines = null;
        var raw = d.payload && d.payload.lines;
        if (raw) {
          var se = String(raw).split(",").map(Number);
          lines = [se[0] + 1, Math.max(se[0] + 1, se[1])];
        }
        out.push({ el: g, key: "n" + d.state.id, info: { label: label, path: path, lines: lines, match: "path" } });
      });
      return out;
    },

    // 切页、切版本前调用：markmap 在 svg 上挂了 ResizeObserver，不销毁的话离开页面后还会重排、报错。
    dispose: function (stage) {
      if (stage.__pfMarkmap) { stage.__pfMarkmap.destroy(); stage.__pfMarkmap = null; }
    },

    // 节点末端的小圆圈是折叠开关，点它不算选中。
    ignoreClick: function (target) {
      return !!(target && target.closest && target.closest("circle"));
    },
  });
})();
