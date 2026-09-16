# 钉钉发布流程

前置：`build_doc(mode:"finalize")` 已完成，`docs/<docId>/doc.md` 已按该类型的 writing 规范写好
（`get_doc_kind("<kind>")`）。发布的是 head 版本（`docs/<docId>/versions/<head>/doc.md`，内容
等同当前 `doc.md`）。

1. 用 harness 的钉钉文档工具在目标知识库/文件夹创建在线文档，写入 doc.md 正文。
2. 图片用 attachment 块 + viewType:"preview" 插入到 `![说明](assets/xxx.png)` 原来的位置；
   不要把上传接口返回的 resourceUrl 拼成 Markdown 图片地址（前端会显示"暂无权限访问"坏图）。
   修改记录表 `<!-- protoflow:changelog -->` 会在 preview.html 里被替换成真实表格——发布时照
   preview.html 渲染出的表格誊写即可。
3. 图片全部替换成 attachment 块后，删掉原来那行 markdown 图片语法。
4. 发布完成立即调 `record_publish`（channel:"dingtalk", channelDocId, url）——不登记，chain_status
   就无法检测文档过期。发布前会跑该类型的 checks，error 级 finding（如未闭环的开放问题）会拦截，
   确认清楚回填、或显式 `acknowledgeFindings:true`。
5. 更新已有文档：`build_doc(mode:"finalize")` 切新版本 → 更新同一篇钉钉文档（channelDocId 不变）→
   再 `record_publish` 一次。

新渠道（飞书等）：复制本文件为 publish-<channel>.md，替换第 1-3 步的渠道细节即可，无需改代码。
