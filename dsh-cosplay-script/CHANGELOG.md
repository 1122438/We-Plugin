# Changelog

## 1.0.0（2026-11-05）

首个正式版。包名 `dsh-cosplay-v3-optimization` → **`dsh-cosplay-script`**。

### 角色卡

- v5 结构：固定槽位（identity / consciousness / personality / voice / userProfile / rules / behavior）+ 按需条目（lore / scenes）。
- 槽位标题、顺序、建议字数、隐藏/删除可在设置页配置；标题进入模型看到的 Markdown 标题。
- 旧 `fields[]` / v4 `core` 自动迁移；落盘不再重复保存 `fields` 与 `core`，状态文件约减半。
- 本场提示（每会话 ≤200 字）、角色级深度提示（play.note）。
- 内置默认卡：蓝色大肥鱼、洁尔佩塔（3 条设定 + 2 个场景）。

### 注入

- 核心槽位走 `systemPrompt.section`（order 5），每轮按 session 重算。
- 角色提示 → 本场提示 → 命中条目走 `systemPrompt.context`（order 300），位于上下文末尾。
- 条目支持触发词、排除词、优先级、预算、sticky/cooldown、常驻。
- `cosplay_note` 工具：模型在场景变化时更新本场提示。

### 设置页

- 总开关 / 思考风格 / 会话绑定 / 失效绑定提示。
- 角色库、三页编辑器（核心 / 扮演 / 条目）、槽位设置、注入预览。
- 会话标题栏与新会话页的角色选择器。

### 工程

- 零运行时依赖（三个 lite 层替代内核包）。
- JSON 持久化到 `$DSH_HOME/cosplay/<profile>.json`，写入前快照 20 份。
- 13 个 Remote 端点、8 个工具；host/client 描述符由测试逐字比对。
- 40 条 store 单测 + host 集成 + client 渲染冒烟。

## 0.12.0

- 本场提示（Author's Note）与角色级深度提示。
- 槽位设置：改标题/顺序/建议字数/隐藏/删除/添加。

## 0.11.0

- 槽位 schema 可配置；设置页注入预览。
- 修复设置页空白（factory 提前 return 导致的 TDZ）。

## 0.10.0

- v5 固定槽位 + 按需条目的第一版；从 v3/v4 迁移。
