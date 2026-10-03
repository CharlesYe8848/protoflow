# 钉钉发布流程

前置：`build_doc` 已定版；属于某个流程 skill 的文档按它做过发布前检查（比如产品研发流程的
`scripts/check.mjs`，有 error 先跟用户确认）。发布的是 head 版本（`docs/<docId>/doc.json` 的 `head`；
刚定完版时内容就是当前 `doc.md`）。

1. 用 harness 的钉钉文档工具在目标知识库/文件夹创建在线文档，写入 doc.md 正文。
2. 图片用 attachment 块 + viewType:"preview" 插入到 `![说明](assets/xxx.png)` 原来的位置；
   不要把上传接口返回的 resourceUrl 拼成 Markdown 图片地址（前端会显示"暂无权限访问"坏图）。
   修改记录表 `<!-- protoflow:changelog -->` 会在 preview.html 里被替换成真实表格——发布时照
   preview.html 渲染出的表格誊写即可。
3. 图片全部替换成 attachment 块后，删掉原来那行 markdown 图片语法。
4. 发布完成立即调 `record_publish`（channel:"dingtalk", channelDocId, url）——不登记，健康检查（get_project findings）
   就无法检测已发布的内容落后。
5. 更新已有文档：`build_doc` 切新版本 → 更新同一篇钉钉文档（channelDocId 不变）→
   再 `record_publish` 一次。

新渠道（飞书等）：复制本文件为 publish-<channel>.md，替换第 1-3 步的渠道细节即可，无需改代码。
