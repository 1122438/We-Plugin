# v1.0.0 · 会话剧本

> 给一个会话，一张稳稳的角色卡。

**dsh-cosplay-script** 的首个公开版本。DeepSeek Harness 的会话级角色扮演插件：核心设定放进系统提示词，长条目按需召回，只影响你绑定的那个会话。

## 这个版本包含什么

- 7 个固定槽位：身份 / 意识 / 性格 / 语气 / 用户档案 / 守则 / 行为
- 两段注入：核心在系统提示词（order 5），角色提示 / 本场提示 / 召回在上下文末尾（order 300，≈depth 0）
- 长内容按需：触发词召回，预算 800 字；支持排除词、优先级、always、sticky、cooldown
- 本场提示：每会话 ≤200 字，AI 可用 `cosplay_note` 在场景变化时更新
- 深度提示：`play.note`，每轮末尾注入
- 槽位设置：标题、顺序、建议字数、隐藏、删除、添加
- 注入预览：直接看模型实际会收到什么
- 数据独立：`$DSH_HOME/cosplay/<profile>.json`，profile 重建不丢卡
- 零运行时依赖：13 个 Remote 端点、8 个工具
- 内置两张默认卡：蓝色大肥鱼、洁尔佩塔

## 安装

### Release tgz（推荐）

1. 下载本页附件 `dsh-cosplay-script-1.0.0.tgz`；
2. 在终端执行：

```bash
dsh plugin --profile desktop add ./dsh-cosplay-script-1.0.0.tgz
```

3. **完全退出并重启 DSH。**

校验（可选）：

```text
SHA-256: 4fef6d09cea9eb77c70adf42a30b55043da63448a38014e75738fb608ffee00c
```

`desktop` 换成你的 profile；桌面端的 `desktop` profile 只能由桌面应用自带 CLI 管理。

### 从源码

```bash
git clone https://github.com/1122438/We-Plugin.git
```

把 `dsh-cosplay-script/` 以 link 方式加入 profile 的 `dependencies` 与 `bundles`，执行 `pnpm install`，再完全重启 DSH。详见 [README](https://github.com/1122438/We-Plugin#安装)。

## 第一次使用（5 步）

1. 设置 → **会话剧本**；
2. 打开总开关；
3. 「选择会话」里选一个；
4. 选角色（自动开启该会话）；
5. 回到会话，直接发第一句角色对话。

内置两张默认卡，新 profile 首次启动即可用。

## 环境

- DeepSeek Harness **0.2.x**（在 `0.2.1-rc.5` 上验证）
- Node `^22.19.0 || >=24.0.0`（随 DSH 分发）

## 已知限制

- 召回是确定性的字面匹配，同义改写会漏；
- 没有自动剧情摘要；本场提示靠模型主动调工具或手写；
- 槽位字数是建议值，不截断；
- 本场提示的 AI 更新不会实时推送到已打开的设置页；
- 不做完整 SillyTavern 兼容、不做模型改写角色卡、不做向量召回。

## 参考与致谢

基于上游 [dsh-cosplay 0.5.1](https://github.com/ZelinW1/dsh-cosplay)（MIT），并参考了 dsh-soul-md、HanaAgent、SillyTavern World Info / Author's Note / CCv3、[DSH-SoulMojito](https://github.com/LingyeSoul/DSH-SoulMojito)（GPL-3.0，仅参照未复制）、Letta / mem0 / Zep、Context Rot。

完整说明、安装与对比见仓库 [README](https://github.com/1122438/We-Plugin)。
