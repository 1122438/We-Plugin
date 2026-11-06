# v1.0.1 · 会话剧本

稳定补丁。基于 2026-11-04 审计与 2026-11-07 独立复核。

## 修复

- `sticky` 语义修正：`0` = 只命中本轮，`N` = 额外保持 N 轮；
- 本场提示上限统一 200（文案、工具、存储、装载）；
- `cosplay_note` 不再回退 `agent.id`；缺少 `agent.session.id` 时明确报错；
- 英文触发词大小写不敏感；
- `lore` / `scenes` 跨数组 id 去重；
- 只有 `play.note` 的卡不再丢 note；
- 索引尾部预算、`buildIndex` 累计长度；
- profile patch 兜底写入：`.bak` + 整块回读校验 + 失败恢复。

## 安装

```bash
dsh plugin --profile desktop add ./dsh-cosplay-script-1.0.1.tgz
```

完全退出并重启 DSH。

校验：

```text
SHA-256: beb0ae5515a1cf3ff7040477f74a4e770c4070ca2896a43525f47f7c1b35439a
```

## 兼容性

- 版本号 `1.0.1`；落盘结构未变（`schemaVersion: 1`），旧状态直接可读；
- `sticky` 行为变化只影响“命中后是否多留一轮”：需要多留的条目改成 `sticky: 1`；
- 已有的 `lore` / `scenes` 如果存在跨数组同 id，装载时会自动加 `-2` 后缀，两条内容都保留。

## 已知未做

- snapshot 的 fsync / mtime 排序；
- 完整 YAML 解析器往返测试；
- `STATE_SCHEMA_VERSION` 迁移（本次未改结构）；
- UI 交互测试。

详见仓库 `TODO/`（本地工作区）。
