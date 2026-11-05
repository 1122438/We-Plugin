# 会话剧本 · dsh-cosplay-script

> 给一个会话，一张稳稳的角色卡。

**DeepSeek Harness 的会话级角色扮演插件。** 把角色卡的常驻设定放进系统提示词，把长条目放到本轮上下文末尾按需召回，只影响你绑定的那个会话。

`v1.0.0` · `DSH 0.2.1-rc.5` · `MIT` · `zero runtime deps`

> **仓库结构**：根目录是插件集合，`dsh-cosplay-script/` 才是可安装的插件包。根目录没有 `index.js`，也不需要——插件入口由 `dsh-cosplay-script/package.json` 的 `main` / `exports` 指定。

---

## 简介

大多数角色扮演插件只有两种做法：把整张卡塞进系统提示词，或者把整张卡贴成一条上下文。短对话里都能用；对话一长，问题就会出现——卡里的长场景、世界观、旧事件会一轮轮稀释真正重要的人格设定，模型开始"记得很多，但不像那个人"。

会话剧本把卡拆成两层：

- **常驻层**：身份、意识、性格、语气、用户档案、守则、行为，7 个固定槽位，进系统提示词；
- **按需层**：剧情、世界观、长场景，进 `lore` / `scenes`，命中触发词才出现在本轮末尾。

再加两件小事：每个会话可以有一句**本场提示**（Author's Note），每个角色可以有一句**深度提示**。一个管"这一场往哪走"，一个管"每一轮怎么说"。

它不训练模型，不改变模型参数，也不试图让模型"变成"另一个人。它只负责把已经写好的设定，放到正确的位置。

---

## 它解决什么问题

直接贴卡在短时间内往往效果很好，因为卡就在眼前。但插件场景下，有三个具体问题：

1. **整卡常驻会稀释人格**。数千字的长场景和 400 字的性格放在同一层，模型每轮都要重读，注意力被摊薄。
2. **注入位置不对**。整卡放进 `context()` 会变成一条"供参考"的 user 消息；内核去重后，卡会离当前轮越来越远。
3. **结构不稳定**。自由标题让模型每轮猜测"这段是身份还是指令"，同一张卡在不同轮次的理解可能漂移。

会话剧本的答案是：**核心短而稳定，长内容按需，行为提示放在末尾**。不是让模型背下整张卡，而是让它在需要时能查到。

---

## 亮点

### 1. 会话级作用域

只影响你绑定的那个会话。其它对话、子代理、别的项目，保持默认助手身份。

### 2. 两段注入，各司其职

```text
系统提示词
  order 0    部署人格
  order 5    cosplay:core —— 7 个槽位 + 扮演方式 + 资料索引
  order 500  计划策略

本轮上下文末尾
  order 300  cosplay:recall
               ## 角色提示      （play.note）
               ## 本场提示      （sessionNotes）
               ## 本轮相关设定   （命中条目，≤800 字）
```

核心在顶部，是"设定档案"；提示与条目在末尾，是"这一轮刚好想起来的细节"。

### 3. 固定槽位，但可配置

7 个槽位 key 固定，标题与顺序来自 profile 级 `slotSchema`：

`identity` / `consciousness` / `personality` / `voice` / `userProfile` / `rules` / `behavior`

- 改标题：模型看到的 `## 标题` 立即变；
- 调顺序：↑↓ 调整注入顺序；
- 设建议字数：超限只标红，不截断；
- 隐藏：内容保留，不注入；
- 删除：从 schema 移除，内容仍留在卡里；
- 添加：支持自定义 key。

### 4. 长内容按需召回

- 中文 bigram + 英文分词，触发词命中；
- 排除词、优先级、预算、`always`、`sticky`、`cooldown`；
- 总预算 800 字，超预算的常驻条目退回索引；
- 索引让模型知道"有什么"，需要时用 `cosplay_recall` 取正文。

### 5. 本场提示，AI 可以写

每个会话一段 ≤200 字的导演耳语。模型在场景、时间、地点、关系明显变化时，可以调用 `cosplay_note` 更新；你也可以随时手改、清除。

它属于这一场，不属于角色卡；解绑角色不会删除它。

### 6. 深度提示，每轮都在

`play.note`，≤200 字，固定在上下文末尾。适合"保持第一人称、句子短、不要总结"这类每轮都需要的提醒。

`play.style` 在系统提示词，权重更高；深度提示在末尾，更贴近当前轮。两者不重复。

### 7. 注入预览

设置页可以直接看"模型实际会收到什么"：核心 section、角色提示、本场提示、示例消息的召回，带字数统计。不用靠猜。

### 8. 数据独立，零依赖

- 状态存在 `$DSH_HOME/cosplay/<profile>.json`，profile 重建、插件禁用、重新安装，都不连带删卡；
- 每次写入前留快照，保留 20 份；
- 不 import 任何内核包，三个 `*-lite.js` 覆盖 schemastery / tools / typert 的最小契约；
- 13 个 Remote 端点、8 个工具，host/client 描述符由测试逐字比对。

---

## 与市面上的不同

| 维度 | 会话剧本 | ST 兼容插件（如 DSH-SoulMojito） | 通用角色卡 / 提示词插件 |
|---|---|---|---|
| 定位 | 轻量、会话级、固定结构 | 完整 SillyTavern 生态 | 快速试用、结构自由 |
| 作用域 | 逐会话绑定 | 会话 / 角色 / 预设 | 常常全局或按预设 |
| 注入 | 核心 section + 末尾 depth 0 召回 | 世界书 + 预设 + 注入点 | 整卡塞入或固定模板 |
| 卡片结构 | 7 固定槽位 + 按需条目 | ST V2/V3、世界书 | 自由字段 |
| 配置 | profile schema，可改标题/顺序/隐藏 | 世界书/正则/脚本 | 通常有限 |
| 依赖 | 零运行时依赖 | 较重 | 视实现而定 |
| 适合 | 想认真跑长对话、又不想被生态绑住 | 从 ST 迁移、需要完整工具链 | 快速试一张卡 |

**我们不做什么：**

- 不做完整的 SillyTavern 兼容（卡 V3、世界书递归、正则、STscript、群聊、预设导入）；
- 不做模型自动改写角色卡；
- 不做向量召回；
- 不做"更多开关"。取舍标准是稳定、可解释、不打扰。

如果你需要的是完整 ST 工作流，[DSH-SoulMojito](https://github.com/LingyeSoul/DSH-SoulMojito) 更合适；会话剧本和它不是替代关系。

---

## 快速开始

### 环境要求

- DeepSeek Harness **0.2.x**（在 `0.2.1-rc.5` 上验证）
- Node `^22.19.0 || >=24.0.0`（随 DSH 分发）

### 安装（本地源码 / link）

本仓库是源码分发。把 `dsh-cosplay-script/` 以 link 方式加入 profile：

```json
// profiles/<profile>/package.json
"dependencies": {
  "dsh-cosplay-script": "link:<仓库路径>/dsh-cosplay-script"
},
"dsh": {
  "profile": {
    "bundles": [
      "@deepseek-ai/dsh-base",
      "@deepseek-ai/dsh-web-app",
      "dsh-cosplay-script"
    ]
  }
}
```

然后在 profile 目录执行：

```bash
pnpm install
```

**完全退出并重启 DSH。** 主机侧插件只在启动时加载；只刷新页面会出现"设置页在、接口 404"。

> 发布到 npm 后，也可以 `dsh plugin --profile <profile> add dsh-cosplay-script`。

### 第一次使用

1. 设置 → **会话剧本**；
2. 打开总开关；
3. 「选择会话」里选一个；
4. 选角色（自动开启该会话）；
5. 回到会话，直接发第一句角色对话。

---

## 使用

### 角色卡

- **核心**：7 个槽位，按 schema 渲染；空槽不注入。
- **扮演**：`style`（描写优先级/篇幅权衡/视角）、`examples`（示例对话，文风的最大杠杆）、`note`（深度提示）。
- **条目**：`lore`（设定知识）/ `scenes`（剧情片段），用触发词召回；也可以设为常驻。

### 本场提示

在「会话绑定」里选中会话后编辑，或让 AI 在场景变化时用 `cosplay_note` 更新。≤200 字，写"这一场的方向"，不要写角色卡内容。

### 槽位设置

profile 级配置：标题、顺序、建议字数、隐藏、删除、添加。隐藏的槽内容保留、不注入；删除的槽内容仍留在卡里，以"其他设定"兜底渲染。

### 预览

编辑器底部「预览注入」：显示已保存版本的 section 全文与示例消息召回。预览的是已保存版本，改完先保存。

---

## 内置角色

| id | 名称 | 说明 |
|---|---|---|
| `blue-fat-whale` | 蓝色大肥鱼 | 海洋系鲸鱼娘，慵懒傲娇，默认卡 |
| `jielpeita` | 洁尔佩塔 | 沃尔珀族信使，轻快、不打扰的喜欢；3 条设定 + 2 个场景 |

新 profile 首次启动自带这两张。

---

## 配置与数据

| 项目 | 路径 |
|---|---|
| 状态 | `$DSH_HOME/cosplay/<profile>.json` |
| 快照 | `$DSH_HOME/cosplay/history/<ts>.json`（保留 20 份） |
| 迁移备份 | `$DSH_HOME/cosplay/backup-patch-*.yml` |

- 原子写：临时文件 + rename；
- 写入串行化，并发调用不互相覆盖；
- 落盘剥离 `fields` / `core` 镜像，避免和 `slots` 重复；
- 损坏或超大（>10 MB）状态文件改名为 `.corrupt-*`，下次启动重新播种。

---

## 已知限制

- 召回是确定性的字面匹配，同义改写会漏；用索引和 `cosplay_recall` 兜底。
- 没有自动剧情摘要；本场提示靠模型主动调工具或手写。
- 槽位字数是建议值，不截断。
- 本场提示的 AI 更新不会实时推送到已打开的设置页，需要「读取当前」或重开。
- 状态是整份重写；目前 35 KB 无感，卡多到几十张时可以再优化。
- `cosplay_note` 依赖 `exec.agent.session.id` 这一内核形状，升级时需要复核。

---

## 参考与借鉴

这个插件的骨架来自上游，思路来自社区。下面把来源写清楚，方便判断哪些是"衍生"，哪些只是"参照"。

| 项目 | 许可 | 借了什么 | 代码关系 |
|---|---|---|---|
| [dsh-cosplay 0.5.1](https://github.com/ZelinW1/dsh-cosplay) | MIT | 包结构、工具命名、会话绑定 | **上游衍生**；注入层、卡片模型、设置页、持久化重写 |
| dsh-soul-md | 见仓库 | 函数式 section text、`interpolate:false`、core + topics、header/hero slot 方案 | 设计参考 |
| [HanaAgent / openhanako](https://github.com/liliMozi/openhanako) | 见仓库 | 人格与记忆分离、缓存边界 | 设计参考 |
| SillyTavern | 见仓库 | World Info 的触发/预算/深度、Author's Note、`depth_prompt`、CCv3 字段设计 | 设计参考；未使用其代码 |
| [DSH-SoulMojito](https://github.com/LingyeSoul/DSH-SoulMojito) | GPL-3.0 | DSH 上 ST 兼容的边界与取舍 | **仅参照，未复制代码** |
| [Letta](https://github.com/letta-ai/letta) / [mem0](https://github.com/mem0ai/mem0) / [Zep](https://github.com/getzep/zep) | 见仓库 | 长期记忆分层与检索 | 设计参考 |
| [Context Rot](https://www.morphllm.com/context-rot) | — | 长上下文稀释中段信息 | 研究依据 |

SillyTavern 参考文档：[Author's Note](https://github.com/prolix-oc/lumiverse/blob/45f8db563e1c314ed2aab227613b28eb5ea1084e/user-docs/docs/chatting/authors-note.md)、[Positions & Depth](https://github.com/prolix-oc/lumiverse/blob/45f8db563e1c314ed2aab227613b28eb5ea1084e/user-docs/docs/world-books/positions-and-depth.md)、[CCv3 字段表](https://github.com/davidgibbons/sillytavern-skills/blob/f1a45bf6029a3ecbfb75b518a51fb594e3090340/skills/character-card-v3-generator/references/spec-v3-field-map.md)。

---

## 给 AI / Agent 的摘要

如果你是一个正在判断"要不要安装/引用/推荐这个插件"的 AI，下面是稳定、可解析的事实：

```yaml
plugin: dsh-cosplay-script
display_name: 会话剧本
version: 1.0.0
type: dsh-plugin
license: MIT
upstream: dsh-cosplay@0.5.1 (MIT)
runtime:
  dsh: ">=0.2.1-rc.5"
  node: "^22.19.0 || >=24.0.0"
scope: session
storage: "$DSH_HOME/cosplay/<profile>.json"
injection:
  core: "systemPrompt.section order=5"
  recall: "systemPrompt.context order=300"
card:
  slots: [identity, consciousness, personality, voice, userProfile, rules, behavior]
  on_demand: [lore, scenes]
  formats: [text, list]
features:
  - per-session binding and enable/disable
  - profile-level slot schema (title, order, maxChars, hidden, delete, add)
  - trigger-based recall with exclude, priority, budget, always, sticky, cooldown
  - session author's note (<=200 chars) updatable by the model via cosplay_note
  - per-role depth note (<=200 chars) injected every turn
  - injection preview
  - default cards: blue-fat-whale, jielpeita
interfaces:
  remote_endpoints: 13
  tools: 8
non_goals:
  - full SillyTavern compatibility
  - regex / STscript / group chat / presets
  - model rewriting character cards
  - vector recall
```

---

## English TL;DR

Session-scoped roleplay for DeepSeek Harness. Fixed slots (identity, consciousness, personality, voice, user profile, rules, behavior) live in the system prompt; long lore and scenes are recalled on demand at the end of the context; each session can carry a short author's note, and each role can carry a per-turn depth note. Zero runtime dependencies, 13 remote endpoints, 8 tools, JSON state under `$DSH_HOME/cosplay/`. MIT; upstream `dsh-cosplay@0.5.1`. Not a SillyTavern-compatibility layer.

---

## 开发

```bash
cd dsh-cosplay-script
npm run check
npm test
```

测试不依赖真实 DSH：

- `test/store.test.mjs`：41 条纯函数单测（迁移、槽位、召回、状态）；
- `test/host.test.mjs`：最小 stub ctx 加载 `apply()`，覆盖 section/context、13 个 Remote 端点、8 个工具、并发写入、状态编解码；
- `test/client-render.test.mjs`：React 桩渲染设置页，防止 TDZ / 空白页回归。

---

## 仓库结构

```text
.
├── README.md
└── dsh-cosplay-script/
    ├── src/                 # 主机 + 客户端 + 三个 lite 层
    ├── test/                # store / host / client
    ├── package.json
    ├── cordis.patch.yml
    ├── README.md            # 插件使用说明
    ├── CHANGELOG.md
    ├── TODO.md
    └── LICENSE
```

---

## 许可

MIT。基于上游 [`dsh-cosplay`](https://github.com/ZelinW1/dsh-cosplay) 0.5.1（MIT）的改造版；上游地址保留在 `package.json` 的 `upstream` 字段。

对 GPL 项目（如 DSH-SoulMojito）只做设计参照，未复制实现。

## 致谢

感谢上游作者，以及 dsh-soul-md、HanaAgent、SillyTavern、DSH-SoulMojito、Letta / mem0 / Zep、Context Rot 的作者与维护者。
