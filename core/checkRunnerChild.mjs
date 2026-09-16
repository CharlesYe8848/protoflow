// core/checkRunnerChild.mjs — check 模块在这个子进程里跑，跟 MCP server 主进程隔离：
// 死循环/抛错/segfault 不会拖垮 server，超时由父进程 SIGKILL 硬砍。
// 收 { modules:[绝对路径], ctx }，回 { findings:[] }。
function base(p) { return p.split(/[\\/]/).pop(); }

process.on("message", async ({ modules, ctx }) => {
  const findings = [];
  for (const m of modules || []) {
    try {
      const mod = await import(`file://${m}`);
      const fn = mod.default || mod.check;
      if (typeof fn !== "function") continue;
      const out = await fn(ctx);
      for (const f of out || []) {
        if (!f || !f.message) continue;
        findings.push({
          code: f.code || "CHECK",
          level: f.level === "error" || f.level === "info" ? f.level : "warn",
          message: String(f.message),
          ...(f.hint ? { hint: String(f.hint) } : {}),
          check: base(m),
        });
      }
    } catch (e) {
      findings.push({ code: "CHECK_ERROR", level: "warn", message: `check ${base(m)} 抛错：${e && e.message || e}`, check: base(m) });
    }
  }
  try { process.send({ findings }); } catch {}
  process.exit(0);
});
