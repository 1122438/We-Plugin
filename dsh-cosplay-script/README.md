# dsh-cosplay-script · 会话剧本

> 给 **指定会话** 绑定角色卡。**核心设定注入系统提示词**（权威位），
> 设定条目与剧情场景按关键词**按需召回**，需要时可随时回顾。
> 基于上游 [`dsh-cosplay`](https://github.com/ZelinW1/dsh-cosplay) 0.5.1 重写；v1.0 起为 v5 结构。

- **会话级作用域** —— 只有你点开的那个会话会扮演，其它会话保持默认助手身份
- **零运行时依赖** —— 不 import 任何内核包，装到哪都能解析
- **固定槽位** —— 身份/意识/性格/语气/用户档案/守则/行为，标题与顺序由 profile schema 决定
- **槽位可配置** —— 改标题、调顺序、设建议字数、隐藏或删除用不到的槽
- **内置默认卡** —— 蓝色大肥鱼 / 洁尔佩塔；新 profile 首次启动即可用
- **按需** —— 条目由触发词命中时注入；索引让模型知道「有什么」
- **本场提示** —— 每会话一段导演耳语；AI 在场景变化时用 `cosplay_note` 更新，你也可以手改
- **深度提示** —— 角色级每轮末尾提醒（视角、句式、篇幅），不进系统提示词
- **可回顾与预览** —— `cosplay_index` 看目录、`cosplay_recall` 取正文；设置页可预览实际注入文本

## 与上游 0.5.1 的差异

| 方面 | 上游 0.5.1 | 本版 1.0.1 |
|---|---|---|
| 作用域 | 全局开关，所有会话 + 子代理一起扮演 | **会话级**：逐会话绑定角色与开关 |
| 注入方式 | `systemPrompt.section()`，拼成「你正在扮演 X」的指令段 | **`section()` 常驻核心 + `context()` 按需召回**（函数式 text、`interpolate:false`） |
| 字段 | 17 个固定框 | **固定槽位 schema（可配置）+ 按需条目** |
| 酒馆兼容 | 支持 v2 角色卡导入导出 | **已移除**（不面向酒馆） |
| Agent 自动填卡 | 内置 skill 自动写卡 | **已移除**：避免模型自作主张改卡；需要时让它输出内容、你粘贴 |
| 外部依赖 | `@deepseek-ai/schemastery` 等内核包 | **零依赖**（内置三个精简兼容层） |

## 环境要求

- DeepSeek Harness **0.2.x**（在 `0.2.1-rc.5` 上验证）
- 需要 `systemPrompt`、`tools`、`typert`、`settings` 四个内核服务（由 `dsh-base` 提供）
- Node `^22.19.0 || >=24.0.0`（随 DSH 分发）

## 安装

### 方式一：Release tgz（推荐）

1. 打开 [Releases](https://github.com/1122438/We-Plugin/releases/latest)，下载 `dsh-cosplay-script-1.0.1.tgz`；
2. 在终端执行：

```bash
dsh plugin --profile <profile> add ./dsh-cosplay-script-1.0.1.tgz
```

3. **完全退出并重启 DSH。**

`<profile>` 换成目标 profile（桌面端 `desktop`，Web 版 `web`）。
桌面端的 `desktop` profile 只能由桌面应用自带 CLI 管理，普通 CLI 会拒绝。

### 方式二：本地源码（开发调试）

```json
// profiles/<profile>/package.json
"dependencies": {
  "dsh-cosplay-script": "link:/绝对路径/dsh-cosplay-script"
},
"dsh": {
  "profile": {
    "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-cosplay-script"]
  }
}
```

然后在该 profile 目录执行 `pnpm install`，**完全重启 DSH**。

### 方式三：npm（发布后）

```bash
dsh plugin --profile <profile> add dsh-cosplay-script
```

> 安装后必须**完全退出并重启 DSH**：主机侧插件只在启动时加载。
> 浏览器端会随插件包自动重载，但主机端不会 —— 没重启会出现「设置页在、但所有接口 404」。

## 使用

1. 设置 → **会话剧本**
2. 打开总开关
3. 「选择会话」里挑一个（新建的对话显示为「新对话」，排在最前）
4. 选角色 → 自动开启该会话
5. 回到该会话，**直接发第一句角色对话**（不需要先寒暄）

> 新建对话后如果列表里没有它，点「刷新」或切走再切回来（窗口获得焦点会自动重取）。

## 配置存放位置

状态存在 `$DSH_HOME/cosplay/<profile>.json`（权威），写入前快照到 `history/`，保留 20 份：

```json
{
  "schemaVersion": 1,
  "enabled": true,
  "thinkingStyle": "neutral",
  "slotSchema": [
    { "key": "identity", "title": "身份简介", "maxChars": 800, "format": "text" }
  ],
  "roles": [
    {
      "id": "jielpeita",
      "name": "洁尔佩塔",
      "slots": { "identity": "...", "personality": "..." },
      "play": { "style": "...", "examples": "...", "note": "..." },
      "lore": [],
      "scenes": []
    }
  ],
  "sessionStates": {
    "session-abc": { "roleId": "jielpeita", "enabled": true }
  },
  "sessionNotes": {
    "session-abc": "雨夜，门没锁。"
  }
}
```

profile 的 `cordis.patch.yml` 只保留 bundle 的 `insert` 行与首次迁移前的旧配置；不再作为角色库的日常写入位置。

## 工作原理

1. 主机侧注册 `systemPrompt.section({ name: 'cosplay:core', order: 5, interpolate: false, text })`：
   内核每次组装提示词时按 sessionId 渲染槽位（标题来自 `slotSchema`）+ 扮演方式 + 资料索引。
2. 另注册 `systemPrompt.context({ name: 'cosplay:recall', order: 300 })`：
   依次放**角色深度提示 → 本场提示 → 本轮命中条目**（≤800 字），全部在上下文末尾（≈depth 0）。
3. `agent/inbox/claimed` 钩子记录当轮用户消息；用中文 bigram + 触发词做确定性匹配，
   支持排除词、优先级、预算、sticky / cooldown。`sticky` 是命中后额外保持的轮数，
   `0` 表示只在本轮命中时注入、不额外保持。
4. 内核把非空 context 包成运行时上下文快照；**内容不变时不会追加**。
5. `cosplay_note` 工具让模型在场景变化时更新本场提示（≤200 字，空串清除）。

置 `injection: 'context'` 可回退到 v3 行为（整卡放进运行时上下文）。

设置页走插件自有的 Typert Remote 命名空间 `cosplay`（`/api/cosplay/*`）：
13 个端点由主机侧 manifest 声明，客户端描述符必须逐字对齐。

## 已知限制

- **状态存在插件自有 JSON**：`$DSH_HOME/cosplay/<profile>.json`（每次写入前留快照到
  `$DSH_HOME/cosplay/history/`，保留 20 份）。首次启动会把 profile patch 里的旧配置迁移过来，
  之后 patch 只保留 bundle 的 `insert` 行，不再写 config。这样 profile 重建/插件禁用不会连带丢卡。
- **核心文本常驻**：槽位 + 索引进系统提示词，条目正文按需。改卡会触发系统提示词更新，
  建议对话前把卡定好。
- **迁移**：旧 `fields[]` 在读取时迁移——按标签进槽位，其余进条目（≤300 字常驻，长内容按需）。
  落盘时会丢掉 `fields` 与 `core` 镜像，避免与 `slots` 重复占空间。
- **本场提示**：每会话 ≤200 字；解绑角色不会删除它，只有「清除」或清理失效会话时才会移除。
- **深度提示**：每轮末尾注入，适合视角/句式；不要把它当成第二份系统提示词。
- **`session/title` 依赖投影缓存**：标题优先从 `sessionProjectionCache` 零 IO 读取；
  缓存缺失时回退读日志（最多 8 条），仍拿不到则显示「新对话」。
- **`emoji` 字段保留但界面不展示**：仅为向后兼容旧数据。

## 开发与测试

```bash
npm run check      # 6 个源文件语法检查
npm test           # store 纯函数单测（40 条）+ 主机侧集成测试 + 客户端渲染冒烟
npm run verify     # 两者都跑
npm run pack:check # 检查 npm 包内容（确认 test/ 不进包）
```

测试不依赖真实 DSH：`test/host.test.mjs` 用最小 stub ctx 加载 `apply()`，
覆盖会话隔离、服务注册、13 个端点标记、**并发写入不丢更新**、会话 id 校验，
以及「客户端与主机的 Remote id 必须逐字一致」（不一致会 404）。

## 来源与许可

MIT。基于上游 [`dsh-cosplay`](https://github.com/ZelinW1/dsh-cosplay) 0.5.1 的改造版，
原项目同样以 MIT 分发。上游地址保留在 `package.json` 的 `upstream` 字段。

发布到自己的仓库前，请把 `package.json` 的 `repository` / `bugs` / `homepage` 补成你的地址。
