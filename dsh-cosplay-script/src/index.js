/**
 * dsh-cosplay-script — 主机侧核心插件（组合行 id: cosplay-core）。
 *
 * 改造版（v1.0.1 / v5）。与上游 0.5.1 的关键差异：
 *
 *   1. **注入方式：固定槽位进系统提示词 + 按需条目进末尾上下文**
 *      核心设定用 `ctx.systemPrompt.section({ text: 函数 })` 渲染（权威位、每轮重算），
 *      条目/本场提示/深度提示用 `ctx.systemPrompt.context()` 放在末尾（≈depth 0）。
 *
 *   2. **作用域：全局 → 会话级**
 *      section/context 的 text 是函数，参数里带 `scope`（= agent，其 .id 即 sessionId），
 *      按会话查表渲染；另支持每会话「本场提示」（sessionNotes）。
 *
 *   3. **角色卡：固定槽位 schema + 按需条目**
 *      槽位 key 固定（identity/consciousness/...），标题与顺序来自 profile 级 `slotSchema`；
 *      场景/世界观细节放 lore/scenes，用触发词召回。详见 store.js。
 *
 *   4. **持久化：$DSH_HOME/cosplay/<profile>.json**
 *      profile 重建/插件禁用不会连带丢卡；写入前留快照。
 *
 * 注：`AssembleContext` 的类型声明只有 `{ scope?, signal? }`（没有 `agent`），
 * 所以这里只用有类型声明的 `scope`，并对 `scope === undefined`（全局组装）做兜底。
 *
 * ⚠ 零外部依赖约束（重要）：
 *   本插件以 `link:` 方式安装在 plugin-src 下。pnpm **不会**为 link 包安装
 *   dependencies，且 plugin-src 目录也解析不到 profile 的 node_modules
 *   （实测：从 plugin-src 里 require.resolve('@deepseek-ai/schemastery') → MODULE_NOT_FOUND）。
 *   因此这里**不能** import 任何内核包，否则宿主加载阶段抛 MODULE_NOT_FOUND，
 *   症状是「设置页里整个「角色扮演」页签消失」。
 *   三个内核包分别用本目录下的 *-lite.js 等价替换：
 *     @deepseek-ai/schemastery          → ./schemastery-lite.js
 *     @deepseek-ai/dsh-tools            → ./tools-lite.js
 *     @deepseek-ai/dsh-typert-protocol  → ./typert-lite.js
 *   佐证：OFM / conversation-manager 也是 link 安装且正常工作，它们的
 *   dependencies 全是空、只 import 内置模块与相对路径。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import z from './schemastery-lite.js'
import { defineTool } from './tools-lite.js'
import { markRemoteMethods, TypertRemoteService } from './typert-lite.js'
import {
  normalizeState,
  normalizeSlotSchema,
  DEFAULT_ROLES,
  DEFAULT_SLOT_SCHEMA,
  upsertRole,
  removeRole,
  findRole,
  nextId,
  nextFieldKey,
  setSessionRole,
  setSessionEnabled,
  clearSession,
  setSessionNote,
  SESSION_NOTE_MAX,
  renderRoleDocument,
  renderSessionContext,
  resolveSessionRole,
  renderCore,
  renderIndex,
  renderEntry,
  renderRecallEntries,
  activate,
  summarize,
  THINKING_DIRECTIVES,
} from './store.js'

export const name = 'cosplay-core'
/**
 * 注入服务（cordis 字符串数组形式）。
 *
 * 说明：cordis 的 inject 是「声明后才能访问」—— 不在 inject 里的服务，
 * `ctx.get(name)` 也拿不到（返回 undefined）。所以 Remote 通道所需的
 * `typert` 必须显式声明。
 *
 * 已验证这些服务在宿主中都存在（否则 apply 永不执行、设置页消失）：
 *   systemPrompt / tools / typert / settings —— 均由 dsh-base 提供。
 */
export const inject = ['settings', 'systemPrompt', 'tools', 'typert']

/** profile 条目 id：cordis.patch.yml 里 `- id: cosplay-core` 必须与此一致。 */
export const ENTRY_ID = 'cosplay-core'

/** 动态字段 schema（v3 兼容）。 */
const FieldSchema = z.object({
  key: z.string().required(),
  label: z.string().default(''),
  value: z.string().default(''),
})

/** v4 条目 schema：设定知识 / 剧情片段。 */
const EntrySchema = z.object({
  id: z.string().required(),
  title: z.string().default(''),
  keys: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
  content: z.string().default(''),
  priority: z.number().default(50),
  always: z.boolean().default(false),
  sticky: z.number().default(0),
  cooldown: z.number().default(0),
})

/** v4 核心设定。 */
const CoreSchema = z.object({
  identity: z.string().default(''),
  personality: z.string().default(''),
  voice: z.string().default(''),
  rules: z.array(z.string()).default([]),
})

/** v4 扮演方式。 */
const PlaySchema = z.object({
  style: z.string().default(''),
  examples: z.string().default(''),
  note: z.string().default(''),
})

/** 槽位 schema：key 固定，标题可覆盖。 */
const SlotDefSchema = z.object({
  key: z.string().required(),
  title: z.string().default(''),
  maxChars: z.number().default(400),
  format: z.union(['text', 'list']).default('text'),
  hidden: z.boolean().default(false),
})

/** 角色卡 schema：v5 结构 + v3 的 fields（仅用于迁移与兼容）。 */
const RoleCardSchema = z.object({
  id: z.string().required(),
  name: z.string().required(),
  version: z.number().default(5),
  emoji: z.string().default(''),
  system_prompt: z.string().default(''),
  slots: z.any().default({}),
  core: CoreSchema.default({}),
  play: PlaySchema.default({}),
  lore: z.array(EntrySchema).default([]),
  scenes: z.array(EntrySchema).default([]),
  fields: z.array(FieldSchema).default([]),
})

/** 会话状态 schema。 */
const SessionStateSchema = z.object({
  roleId: z.string().default(''),
  enabled: z.boolean().default(false),
})

/**
 * 本行 Config。字段全部 volatile：
 *   - 0.2.x 下只有 volatile 字段会出现在自动生成的设置表单里（本插件已关闭 auto）；
 *   - volatile-only 变更由 loader 原地提交进运行时引用，不重启插件。
 *
 * sessionStates 用「记录」形式（sessionId → 状态）。schemastery 没有 Record 类型，
 * 这里用 z.any() 承载并在 store 层做严格归一化（normalizeSessionStates）。
 */
export const Config = z.object({
  enabled: z.boolean().default(false).volatile(),
  thinkingStyle: z.union(['neutral', 'role']).default('neutral').volatile(),
  /** section（默认，系统提示词）| context（回退到 v3 行为）。改动需重启生效。 */
  injection: z.union(['section', 'context']).default('section').volatile(),
  slotSchema: z.array(SlotDefSchema).default(DEFAULT_SLOT_SCHEMA).volatile(),
  roles: z.array(RoleCardSchema).default(DEFAULT_ROLES).volatile(),
  sessionStates: z.any().default({}).volatile(),
  sessionNotes: z.any().default({}).volatile(),
})

/**
 * 读取 Config 字段：0.2.x 运行时把 Config 包成带 `.get()` 的引用（volatile 引用），
 * 普通对象下退化为普通值。引用可能逐层包裹，循环解包。
 */
function readField(holder) {
  let current = holder
  for (let depth = 0; depth < 8; depth++) {
    if (current === undefined || current === null) return current
    if (typeof current.get !== 'function') return current
    current = current.get()
  }
  return current
}

/**
 * 合并写入本行 Config。
 *
 * ⚠ 关于 `ctx.settings.update(ENTRY_ID, patch)`：
 *   桌面端会弹出 `No configurable plugin entry "cosplay-core"` —— 因为本行由
 *   profile 的 bundle patch 声明，没有注册成 settings 的「可配置条目」，
 *   settings.update 因此拒绝写入。
 *
 * 因此这里**先尝试 settings.update，失败则静默降级到其它通道**：
 *   1. ctx.settings.update（桌面端会抛错 → 捕获后跳过）
 *   2. ctx.loader 的条目写入（若宿主暴露）
 *   3. 直接改 profile 的 cordis.patch.yml（最后手段，原子写入）
 * 任何一条成功即可；全都失败才抛错。
 */
async function writeConfig(ctx, patch) {
  const errors = []

  // ② 桩测试钩子（最优先，测试环境专用）
  if (typeof ctx.__test?.applyConfigPatch === 'function') {
    ctx.__test.applyConfigPatch(patch)
    return 'test-hook'
  }

  // ① **先落盘**：profile 的 cordis.patch.yml。
  //
  // 为什么顺序改成"先写文件"：实测发现 `ctx.settings.update()` 在某些 profile 下
  // **不抛错、也不持久化**（静默 no-op）—— 全盘搜不到写入的数据。若先调它并
  // 视为成功，就会出现"UI 显示成功、重启后数据消失"。
  // 文件写入是可验证的（文件确实变了），因此作为权威通道。
  let wroteFile = false
  try {
    wroteFile = writeProfilePatch(ctx, patch)
    if (!wroteFile) errors.push('file: 未找到可写的 profile 补丁文件或 cosplay-core 块')
  } catch (error) {
    errors.push('file: ' + String(error?.message ?? error))
  }

  // ② 再尝试让宿主的内存引用同步（best-effort，失败无所谓：
  //    插件自身维护 memory 覆盖，重启后从文件恢复）。
  if (typeof ctx.settings?.update === 'function') {
    try {
      await ctx.settings.update(ENTRY_ID, patch)
    } catch { /* 桌面端会报 No configurable plugin entry，忽略 */ }
  }

  // ③ loader 条目写入（宿主暴露时是内存同步的正确方式）
  if (!wroteFile) {
    try {
      const loader = typeof ctx.get === 'function' ? ctx.get('loader') : undefined
      if (loader !== undefined && typeof loader.entries === 'function') {
        for (const entry of loader.entries()) {
          if (entry?.options?.id === ENTRY_ID) {
            if (typeof entry.update === 'function') {
              await entry.update({ config: { ...(entry.options?.config ?? {}), ...patch } })
              return 'loader.update'
            }
            if (typeof entry.patch === 'function') {
              await entry.patch({ config: patch })
              return 'loader.patch'
            }
          }
        }
        errors.push('loader: 未找到可写入口')
      }
    } catch (error) {
      errors.push('loader: ' + String(error?.message ?? error))
    }
  }

  if (wroteFile) return 'file:cordis.patch.yml'
  throw new Error('dsh-cosplay-script: 无法持久化角色库（' + errors.join(' | ') + '）')
}

/**
 * DSH 主目录：优先环境变量，其次 `$HOME/.dsh`（不写死用户名）。
 * @returns 目录路径（无末尾斜杠）。
 */
function dshHome() {
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env) return env.replace(/[\\/]+$/, '')
  return `${homedir().replace(/\\/g, '/')}/.dsh`
}

// ── v4.1：独立状态文件 ───────────────────────────────────────────────────────
//
// 为什么不再把角色库写在 profile 的 cordis.patch.yml：
//   2026-11-04 desktop profile 被重建，patch 整块被重置，角色库随之消失。
//   状态放进 $DSH_HOME/cosplay/ 后，profile 重建/插件禁用都不会连带删除。
//
// 布局：
//   $DSH_HOME/cosplay/<profile>.json          # 当前状态（权威）
//   $DSH_HOME/cosplay/history/<ts>.json       # 每次写入前的快照（保留 20 份）
//   $DSH_HOME/cosplay/backup-patch-<ts>.yml   # 迁移时保留的旧 patch 副本

const STATE_SCHEMA_VERSION = 1

function cosplayHome() {
  return `${dshHome()}/cosplay`
}

/** profile 名只保留安全字符，避免路径穿越。 */
function safeProfileKey(value) {
  const key = String(value || '').trim().replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 64)
  return key || 'default'
}

/** 当前 profile 名（用于分文件）；定位不到时归到 default。 */
function cosplayProfileKey(ctx) {
  for (const getter of [
    () => ctx?.get?.('profileContext')?.name,
    () => ctx?.profileContext?.name,
    () => ctx?.reflect?.get?.('profileContext')?.name,
  ]) {
    try {
      const value = getter()
      if (typeof value === 'string' && value) return safeProfileKey(value)
    } catch { /* 继续 */ }
  }
  // baseUrl 兜底（形如 .../profiles/desktop）
  try {
    const parts = String(ctx?.baseUrl ?? '').replace(/\\/g, '/').split('/').filter(Boolean)
    const index = parts.lastIndexOf('profiles')
    if (index >= 0 && parts[index + 1]) return safeProfileKey(parts[index + 1])
  } catch { /* ignore */ }
  return 'default'
}

function cosplayStateFile(ctx) {
  return `${cosplayHome()}/${cosplayProfileKey(ctx)}.json`
}

function cosplayHistoryDir() {
  return `${cosplayHome()}/history`
}

/** 状态 → JSON 文本。 */
export function serializeStateFile(state) {
  return JSON.stringify({
    schemaVersion: STATE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    enabled: state.enabled === true,
    thinkingStyle: state.thinkingStyle === 'role' ? 'role' : 'neutral',
    slotSchema: state.slotSchema ?? [],
    // v5 起 fields 只是迁移输入、core 是 slots 的只读镜像；落盘都不保存，避免重复占空间。
    // 没有 slots 的旧卡仍保留 core，防止未迁移数据丢失。
    roles: (state.roles ?? []).map((role) => {
      const { fields, ...rest } = role
      const hasSlots = Object.values(role.slots ?? {}).some((text) => typeof text === 'string' && text.trim())
      if (hasSlots) delete rest.core
      return rest
    }),
    sessionStates: state.sessionStates ?? {},
    sessionNotes: state.sessionNotes ?? {},
  }, null, 2) + '\n'
}

/** JSON 文本 → 归一化状态；解析失败返回 undefined。 */
export function parseStateFile(text) {
  try {
    const raw = JSON.parse(String(text))
    if (!raw || typeof raw !== 'object') return undefined
    return normalizeState(raw)
  } catch {
    return undefined
  }
}

function readStateFile(ctx) {
  const file = cosplayStateFile(ctx)
  try {
    if (!existsSync(file)) return undefined
    const text = readFileSync(file, 'utf8')
    // 防御：异常大的状态文件不解析（避免卡启动）。
    if (text.length > 10 * 1024 * 1024) {
      try { renameSync(file, `${file}.corrupt-${Date.now()}`) } catch { /* ignore */ }
      return undefined
    }
    const parsed = parseStateFile(text)
    // 坏文件改名留档，下次启动会从 patch 重新播种。
    if (parsed === undefined) {
      try { renameSync(file, `${file}.corrupt-${Date.now()}`) } catch { /* ignore */ }
    }
    return parsed
  } catch {
    return undefined
  }
}

/** 写入前留一份快照，最多保留 20 份。 */
function snapshotStateFile(ctx) {
  const file = cosplayStateFile(ctx)
  if (!existsSync(file)) return
  try {
    mkdirSync(cosplayHistoryDir(), { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    copyFileSync(file, `${cosplayHistoryDir()}/${stamp}.json`)
    const files = readdirSync(cosplayHistoryDir()).filter((name) => name.endsWith('.json')).sort()
    for (const name of files.slice(0, Math.max(0, files.length - 20))) {
      try { unlinkSync(`${cosplayHistoryDir()}/${name}`) } catch { /* ignore */ }
    }
  } catch { /* 快照失败不影响主写入 */ }
}

/** 原子写入状态文件（tmp + rename）。 */
function writeStateFile(ctx, state) {
  const file = cosplayStateFile(ctx)
  mkdirSync(cosplayHome(), { recursive: true })
  snapshotStateFile(ctx)
  const tmp = `${file}.tmp-${Date.now()}`
  writeFileSync(tmp, serializeStateFile(state), 'utf8')
  renameSync(tmp, file)
}

/**
 * 推断当前运行的 profile 目录。
 *
 * 依次尝试（实测 baseUrl 未必可用，因此多路兜底）：
 *   1. `ctx.get('profileContext').name` —— 内核自己用它区分 desktop/web
 *      （cordis.yml 里就有 `ctx.get('profileContext')?.name === 'desktop'`）；
 *   2. `ctx.profileContext.name` 直接属性；
 *   3. `ctx.baseUrl`（形如 .../profiles/<name>）；
 *   4. 以上都失败则返回 undefined（调用方据此**拒绝写盘**，避免跨 profile 污染）。
 *
 * @param ctx - 插件上下文。
 * @returns 目录路径（无末尾斜杠），推断不出时返回 undefined。
 */
function activeProfileDir(ctx) {
  // ── 1/2. profileContext.name（最可靠）──
  let name
  for (const getter of [
    () => ctx?.get?.('profileContext')?.name,
    () => ctx?.profileContext?.name,
    () => ctx?.reflect?.get?.('profileContext')?.name,
  ]) {
    try {
      const v = getter()
      if (typeof v === 'string' && v) { name = v; break }
    } catch { /* 继续 */ }
  }
  if (name) return `${dshHome()}/profiles/${name}`

  // ── 3. baseUrl ──
  let raw
  try {
    raw = ctx?.baseUrl
  } catch {
    return undefined
  }
  if (typeof raw !== 'string' || !raw) return undefined

  let p = raw
  if (p.startsWith('file://')) {
    try {
      p = decodeURIComponent(new URL(p).pathname)
      if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1)
    } catch {
      return undefined
    }
  }
  p = p.replace(/[\\/]+$/, '')
  return /[\\/]profiles[\\/][^\\/]+$/.test(p) ? p : undefined
}

/**
 * 直接改写 profile 的 `cordis.patch.yml` 里 `- id: cosplay-core` 的 config 段。
 *
 * 这是 settings 不可用时的兜底。写入策略：定位该块的行范围 → 用新 config
 * 序列化替换 → 原子写（先写临时文件再 rename）。
 *
 * @param patch - 要写入的 config 对象。
 * @returns 是否成功改写。
 */
function writeProfilePatch(ctx, patch) {
  const block = [
    '- id: cosplay-core',
    '  name: dsh-cosplay-script',
    '  config:',
    ...indentYaml(serializeConfig(patch), 4),
  ]

  // ⚠ 只操作**当前运行的 profile**。若定位不到，宁可不写（内存态仍然生效），
  // 也绝不猜测 —— 否则会把配置写进别的 profile（曾把 web 的写入写进 desktop）。
  const active = activeProfileDir(ctx)
  if (!active) return false
  const file = `${active}/cordis.patch.yml`

  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    text = ''
  }

  const lines = text.length > 0 ? text.split('\n') : []
  // 本函数只处理**顶格**的 `- id:` 行；缩进形式（例如包在 `- insert:` 下）
  // 不在当前 profile patch 的形态里。匹配不到时宁可不写，也不追加第二份。
  const idLine = /^-\s+id:\s*["']?cosplay-core["']?\s*(?:#.*)?$/
  const indentedIdLine = /^\s+-\s+id:\s*["']?cosplay-core["']?/
  const start = lines.findIndex((l) => idLine.test(l))

  if (start >= 0) {
    // ── 替换已存在的块 ──
    let end = lines.length - 1
    for (let i = start + 1; i < lines.length; i++) {
      if (/^-\s+id:\s*/.test(lines[i])) { end = i - 1; break }
    }
    while (end > start && lines[end].trim() === '') end--
    commitPatchFile(file, [...lines.slice(0, start), ...block, ...lines.slice(end + 1)], block)
    return true
  }

  // ── 追加新块 ──
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  // 只在整份文档就是空列表时丢弃 `[]`，不要误删用户其它位置的合法行。
  const cleaned = lines.length === 1 && lines[0].trim() === '[]' ? [] : lines
  // 二次确认：避免"定位没匹配上、又追加一份"导致同 id 两份。
  if (cleaned.some((l) => idLine.test(l) || indentedIdLine.test(l))) return false
  commitPatchFile(file, [...cleaned, ...block], block)
  return true
}

/**
 * 校验写入后的 patch 是否包含完整块，且块内缩进没有坏。
 *
 * 只验 `- id:` 行不够：序列化其它部分坏掉时 id 行仍在。
 * 这里要求整块文本存在，并检查 `config:` 之后每行是 2 的倍数缩进。
 *
 * @param text - 写入后的完整文件文本。
 * @param block - 期望写入的块（行数组）。
 * @returns 是否通过。
 */
export function validatePatchBlock(text, block) {
  if (!Array.isArray(block) || block.length === 0) return false
  const value = String(text ?? '')
  if (!value.includes(block.join('\n'))) return false
  const configIndex = block.findIndex((line) => line === '  config:')
  if (configIndex < 0) return false
  for (const line of block.slice(configIndex + 1)) {
    if (!line.trim()) continue
    const indent = (line.match(/^ */) ?? [''])[0].length
    if (indent < 4 || indent % 2 !== 0) return false
  }
  return true
}

/**
 * 原子写入一个补丁文件（先写临时文件再 rename）。
 * @param file - 目标路径。
 * @param lines - 完整行数组。
 * @param block - 本次写入的块，用于整块回读校验。
 */
function commitPatchFile(file, lines, block) {
  let backup = ''
  if (existsSync(file)) {
    backup = `${file}.bak-${Date.now()}`
    try { copyFileSync(file, backup) } catch { backup = '' }
  }
  const tmp = `${file}.tmp-${Date.now()}`
  writeFileSync(tmp, lines.join('\n') + '\n', 'utf8')
  renameSync(tmp, file)
  // 写入后回读：验证整块内容与缩进，而不是只找 id 行。
  const check = readFileSync(file, 'utf8')
  if (!validatePatchBlock(check, block)) {
    if (backup) {
      try { copyFileSync(backup, file) } catch { /* ignore */ }
    }
    throw new Error('profile patch 写入校验失败（块内容/缩进不一致），已尝试恢复备份')
  }
}

const textOutput = {
  schema: { type: 'string' },
  render(_args, value) {
    return [{ type: 'text', text: String(value) }]
  },
}

// ── 极简 YAML 序列化（只覆盖本插件 config 用到的形态） ──────────────────────
// 不引第三方 yaml 库（零依赖约束），只处理 string / boolean / number /
// 数组 / 纯对象 / 空对象。字符串优先用 YAML 双引号形式，能安全承载中文、
// 引号与换行（换行转 \n），避免块标量（>-）在多行中文下的折行问题。

/** 判断字符串能否安全地不加引号输出。 */
function yamlSafePlain(s) {
  if (s === '') return false
  if (/^[\s#&*!|>'"%@`\-?:,[\]{}]/.test(s)) return false
  if (/[:#\n\r\t]/.test(s)) return false
  if (s !== s.trim()) return false
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(s)) return false
  if (/^-?\d+(\.\d+)?$/.test(s)) return false
  return true
}

/** 单值序列化。 */
function yamlValue(v) {
  if (v === null || v === undefined) return '""'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0'
  if (typeof v === 'string') {
    if (yamlSafePlain(v) && !/[\u4e00-\u9fff]/.test(v)) return v
    return JSON.stringify(v)
  }
  if (Array.isArray(v)) return '[]'
  if (typeof v === 'object') return '{}'
  return JSON.stringify(String(v))
}

/**
 * 序列化一个 YAML 键名。
 *
 * 键名里若出现 `:`、`#`、`{`、空格、或以特殊字符开头，裸写会破坏文档结构。
 * 本插件的固定键（enabled / roles / fields …）都安全，但 `sessionStates`
 * 的键是**会话 id**，其取值不受我们控制，因此统一做一次安全化。
 *
 * @param key - 原始键名。
 * @returns 可直接拼进 YAML 的键名。
 */
function yamlKey(key) {
  const k = String(key)
  // 安全裸写：字母数字下划线连字符点开头，且不含会破坏结构的字符
  if (/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(k)) return k
  return JSON.stringify(k)
}

/**
 * serializeConfig：把 config 对象序列化成 YAML 行数组（不含缩进）。
 * @param obj - 待序列化对象。
 * @returns 行数组。
 */
export function serializeConfig(obj) {
  /** @type {string[]} */
  const out = []
  const walk = (value, indent) => {
    const pad = ' '.repeat(indent)
    if (Array.isArray(value)) {
      if (value.length === 0) { out.push(`${pad}[]`); return }
      for (const item of value) {
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
          const keys = Object.keys(item)
          if (keys.length === 0) { out.push(`${pad}- {}`); continue }
          // 第一个键跟 `- ` 同行
          const [first, ...rest] = keys
          const firstKey = yamlKey(first)
          const fv = item[first]
          if (fv !== null && typeof fv === 'object' && !Array.isArray(fv)) {
            if (Object.keys(fv).length === 0) {
              out.push(`${pad}- ${firstKey}: {}`)
            } else {
              out.push(`${pad}- ${firstKey}:`)
              walk(fv, indent + 4)
            }
          } else if (Array.isArray(fv)) {
            if (fv.length === 0) {
              out.push(`${pad}- ${firstKey}: []`)
            } else {
              out.push(`${pad}- ${firstKey}:`)
              walk(fv, indent + 4)
            }
          } else {
            out.push(`${pad}- ${firstKey}: ${yamlValue(fv)}`)
          }
          for (const k of rest) {
            const v = item[k]
            const keyName = yamlKey(k)
            if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
              if (Object.keys(v).length === 0) {
                out.push(`${pad}  ${keyName}: {}`)
              } else {
                out.push(`${pad}  ${keyName}:`)
                walk(v, indent + 4)
              }
            } else if (Array.isArray(v) && v.length > 0) {
              out.push(`${pad}  ${keyName}:`)
              walk(v, indent + 4)
            } else {
              out.push(`${pad}  ${keyName}: ${yamlValue(v)}`)
            }
          }
        } else {
          out.push(`${pad}- ${yamlValue(item)}`)
        }
      }
      return
    }
    if (value !== null && typeof value === 'object') {
      const keys = Object.keys(value)
      if (keys.length === 0) { out.push(`${pad}{}`); return }
      for (const k of keys) {
        const v = value[k]
        const keyName = yamlKey(k)
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
          if (Object.keys(v).length === 0) { out.push(`${pad}${keyName}: {}`); continue }
          out.push(`${pad}${keyName}:`)
          walk(v, indent + 2)
        } else if (Array.isArray(v)) {
          if (v.length === 0) { out.push(`${pad}${keyName}: []`); continue }
          out.push(`${pad}${keyName}:`)
          walk(v, indent + 2)
        } else {
          out.push(`${pad}${keyName}: ${yamlValue(v)}`)
        }
      }
    }
  }
  walk(obj, 0)
  return out
}

/** 给序列化结果整体加缩进。 */
function indentYaml(lines, n) {
  const pad = ' '.repeat(n)
  return lines.map((l) => (l.trim() === '' ? l : pad + l))
}

/**
 * 从投影缓存读会话标题（零 IO 快路径）。
 *
 * 内核 `cachedSnapshot(meta, ['title'])` 返回 `{ asOfSeq, values: { title } }`，
 * 其中 title 是 `string | null`（见 dsh-session-title 的 titleProjectionDefinition，
 * stateSchema 为 `z.string().min(1).nullable()`）。
 *
 * @param cache - sessionProjectionCache 服务。
 * @param meta - 会话原始记录（lifecycle identity witness）。
 * @returns 标题；不可用时返回空串。
 */
function readCachedTitle(cache, meta) {
  const pick = (block) => {
    const t = block?.values?.title
    return typeof t === 'string' && t.trim() ? t.trim() : ''
  }
  try {
    if (typeof cache.cachedSnapshot === 'function') {
      const t = pick(cache.cachedSnapshot(meta, ['title']))
      if (t) return t
    }
  } catch { /* 继续尝试 predecessor */ }
  try {
    if (typeof cache.cachedPredecessorTitle === 'function') {
      const t = pick(cache.cachedPredecessorTitle(meta))
      if (t) return t
    }
  } catch { /* ignore */ }
  return ''
}

// ── typert Remote（浏览器设置页的数据通道） ─────────────────────────────────
// 方法标记由 ./typert-lite.js 的 markRemoteMethods 完成（等价于宿主的 @Remote）。

/** 设置页可用的角色库读写服务（Remote 命名空间 `cosplay`）。 */
class CosplayRuntime extends TypertRemoteService {
  constructor(ctx, read, write) {
    super(ctx, 'cosplay')
    this._read = read
    this._write = write
  }
  getState() {
    return this._read()
  }
  /**
   * 列出会话，供设置页的会话选择器使用。
   *
   * 标题来源：SessionHeader **没有 title 字段**（见 dsh-session 的
   * validateSessionHeader）。标题由 dsh-session-title 以 `session/title`
   * 事件追加进会话日志，因此这里逐条用 sessionQuery.observeSession() 读取
   * 最新一条 `session/title` 事件。
   *
   * 读取标题失败不致命：退回「首条用户消息摘要」再退回 session id 尾段。
   */
  async listSessions() {
    // 多重兜底取 sessionQuery：ctx.get / ctx.reflect.get / 直接属性。
    let query
    try {
      if (typeof this.ctx?.get === 'function') query = this.ctx.get('sessionQuery')
    } catch { /* 属性守卫可能抛错，继续尝试下一种 */ }
    if (query === undefined) {
      try {
        if (typeof this.ctx?.reflect?.get === 'function') query = this.ctx.reflect.get('sessionQuery')
      } catch { /* ignore */ }
    }
    if (query === undefined) {
      try { query = this.ctx?.sessionQuery } catch { /* ignore */ }
    }
    if (query === undefined || typeof query.listSessions !== 'function') {
      return { ok: false, sessions: [], reason: '宿主未提供 sessionQuery 服务' }
    }
    try {
      const records = await query.listSessions()
      const list = (Array.isArray(records) ? records : []).map((r) => {
        const header = r?.header ?? r ?? {}
        const id = header.id ?? r?.id ?? ''
        return {
          id: typeof id === 'string' ? id : '',
          cwd: typeof header.cwd === 'string' ? header.cwd : '',
          time: typeof header.createdAt === 'number' ? header.createdAt
            : typeof header.time === 'number' ? header.time : 0,
          // 投影缓存要的是 **header**（它读 meta.id / meta.version / meta.createdAt /
          // meta.cwd / meta.isSeeded），不是整条记录 { header, live, persisted }。
          // 传错会导致 meta.id 为 undefined → 缓存永不命中 → 退回读日志。
          __header: header,
        }
      }).filter((s) => s.id)

      // ── 快路径：投影缓存（零 IO）────────────────────────────────────────
      // 内核的 sessionProjectionCache.cachedSnapshot(header, ['title']) 直接返回
      // 已折叠的标题，不读会话日志 —— DSH 自己的会话列表就用这条路径。
      const cache = this._projectionCache()
      const withTitles = list.map((s) => {
        const title = cache === undefined ? '' : readCachedTitle(cache, s.__header)
        return { ...s, title }
      })

      // ── 慢路径：仅对缓存缺失的最多 8 条读日志（有界并发 4）──────────────
      // 这条只发生在新会话/缓存未落盘时，且严格限制数量，避免一次扫 40 份日志。
      const missing = withTitles
        .map((s, i) => ({ s, i }))
        .filter((x) => !x.s.title)
        .slice(0, 8)

      if (missing.length > 0 && typeof query.observeSession === 'function') {
        const CONCURRENCY = 4
        let cursor = 0
        const worker = async () => {
          while (cursor < missing.length) {
            const task = missing[cursor++]
            try {
              const t = await this._readTitleFromLog(query, task.s.id)
              if (t) withTitles[task.i] = { ...withTitles[task.i], title: t }
            } catch { /* 单条失败不影响整体 */ }
          }
        }
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, missing.length) }, worker))
      }

      // 剥掉内部字段，只暴露给前端的字段
      const sessions = withTitles.map(({ __header, ...rest }) => rest)
      return { ok: true, sessions, reason: '' }
    } catch (error) {
      return { ok: false, sessions: [], reason: String(error?.message ?? error) }
    }
  }

  /** 取 sessionProjectionCache 服务（运行时安全访问）。 */
  _projectionCache() {
    for (const getter of [
      () => this.ctx?.get?.('sessionProjectionCache'),
      () => this.ctx?.reflect?.get?.('sessionProjectionCache'),
      () => this.ctx?.sessionProjectionCache,
    ]) {
      try {
        const v = getter()
        if (v !== undefined) return v
      } catch { /* 继续下一种 */ }
    }
    return undefined
  }

  /**
   * 读一个会话的显示标题（慢路径：读日志）。
   * @param query - sessionQuery 服务。
   * @param sessionId - 会话 id。
   * @returns 标题文本；读不到返回空串。
   */
  async _readTitleFromLog(query, sessionId) {
    let lease
    try {
      lease = await query.observeSession(sessionId, { projectionMode: 'none' })
      const events = lease?.events ?? []
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i]
        if (e?.type !== 'session/title') continue
        const t = e?.data?.title
        if (typeof t === 'string' && t.trim()) return t.trim()
      }
      for (const e of events) {
        if (e?.type !== 'user/message') continue
        const content = e?.data?.message?.content
        const text = Array.isArray(content)
          ? content.filter((b) => b && b.type === 'text').map((b) => b.text).join(' ')
          : typeof content === 'string' ? content : ''
        const trimmed = String(text).replace(/\s+/g, ' ').trim()
        if (trimmed) return trimmed.slice(0, 40)
      }
      return ''
    } catch {
      return ''
    } finally {
      try { await lease?.release?.() } catch { /* ignore */ }
    }
  }
  // ── 写操作 ────────────────────────────────────────────────────────────────
  // 一律传「变更函数」而不是算好的状态：基线在写入队列内读取，避免并发丢失更新。
  async upsertRole(card) {
    return this._write((state) => upsertRole(state, card))
  }
  async removeRole(id) {
    return this._write((state) => removeRole(state, id))
  }
  async setEnabled(enabled) {
    return this._write((state) => ({ ...state, enabled: enabled === true }))
  }
  async setThinkingStyle(style) {
    const next = style === 'role' ? 'role' : 'neutral'
    return this._write((state) => ({ ...state, thinkingStyle: next }))
  }
  // ── 会话级 ──
  async setSessionRole(sessionId, roleId) {
    const id = roleId === '' || roleId === undefined || roleId === null ? null : roleId
    return this._write((state) => setSessionRole(state, sessionId, id))
  }
  async setSessionEnabled(sessionId, enabled) {
    return this._write((state) => setSessionEnabled(state, sessionId, enabled === true))
  }
  /**
   * 一次写入同时设置角色与开关。
   *
   * 为什么单独开一个方法：每次 `_write` 都会把整份配置序列化并落盘，
   * 分两次调用（先 setSessionRole 再 setSessionEnabled）等于写两遍文件 ——
   * 这是 UI 点一下要等的主要原因。合并后只写一次。
   *
   * @param sessionId - 会话 id。
   * @param roleId - 角色 id；空串或 null 表示不扮演。
   * @param enabled - 是否开启该会话的扮演。
   */
  async bindSession(sessionId, roleId, enabled) {
    const id = roleId === '' || roleId === undefined || roleId === null ? null : roleId
    return this._write((state) => setSessionEnabled(setSessionRole(state, sessionId, id), sessionId, enabled === true))
  }
  async clearSession(sessionId) {
    return this._write((state) => clearSession(state, sessionId))
  }
  /** 更新 profile 级槽位 schema（标题 / 顺序 / 建议字数 / 隐藏）。 */
  async setSlotSchema(schema) {
    return this._write((state) => ({ ...state, slotSchema: normalizeSlotSchema(schema) }))
  }
  /**
   * 设置页预览：返回已保存角色实际会注入的 core，以及给一条示例消息时的召回。
   */
  async preview(roleId, sampleText, sessionId) {
    const state = this._read()
    const role = findRole(state, roleId)
    if (!role) return { core: '', recall: '', coreChars: 0, recallChars: 0 }
    const core = renderCore(role, { slotSchema: state.slotSchema })
    const blocks = []
    if (role.play?.note?.trim()) blocks.push(`## 角色提示\n[${role.play.note.trim()}]`)
    const note = typeof sessionId === 'string' ? state.sessionNotes?.[sessionId] : undefined
    if (note) blocks.push(`## 本场提示\n[${note}]`)
    const sample = typeof sampleText === 'string' ? sampleText : ''
    if (sample) {
      const entries = renderRecallEntries(activate(role, sample, 1, { until: new Map(), cooldownUntil: new Map() }), 800)
      if (entries) blocks.push(entries)
    }
    const recall = blocks.join('\n\n')
    return { core, recall, coreChars: core.length, recallChars: recall.length }
  }
  /** 设置某会话的「本场提示」（空串 = 清除）。 */
  async setSessionNote(sessionId, note) {
    return this._write((state) => setSessionNote(state, sessionId, note))
  }
}
markRemoteMethods(CosplayRuntime.prototype, [
  'getState', 'listSessions', 'upsertRole', 'removeRole', 'setEnabled', 'setThinkingStyle',
  'setSessionRole', 'setSessionEnabled', 'bindSession', 'clearSession', 'setSlotSchema', 'preview',
  'setSessionNote',
])

const srcJsonCodec = (typeSymbol) => ({ mode: 'src-json', typeSymbol })

const strParam = (name) => ({ name, wire: name, source: 'json', codec: srcJsonCodec(`dsh-cosplay-script#${name}`) })

const COSPLAY_INVOCATIONS = [
  {
    id: 'dsh-cosplay-script#cosplay/getState',
    service: 'cosplay', namespace: 'cosplay', method: 'getState',
    invocation: { kind: 'direct' }, parameters: [],
    result: srcJsonCodec('dsh-cosplay-script#CosplayState'),
  },
  {
    id: 'dsh-cosplay-script#cosplay/listSessions',
    service: 'cosplay', namespace: 'cosplay', method: 'listSessions',
    invocation: { kind: 'direct' }, parameters: [],
    result: srcJsonCodec('dsh-cosplay-script#SessionList'),
  },
  {
    id: 'dsh-cosplay-script#cosplay/upsertRole',
    service: 'cosplay', namespace: 'cosplay', method: 'upsertRole',
    invocation: { kind: 'direct' }, parameters: [strParam('card')],
    result: srcJsonCodec('dsh-cosplay-script#CosplayState'),
  },
  {
    id: 'dsh-cosplay-script#cosplay/removeRole',
    service: 'cosplay', namespace: 'cosplay', method: 'removeRole',
    invocation: { kind: 'direct' }, parameters: [strParam('id')],
    result: srcJsonCodec('dsh-cosplay-script#CosplayState'),
  },
  {
    id: 'dsh-cosplay-script#cosplay/setEnabled',
    service: 'cosplay', namespace: 'cosplay', method: 'setEnabled',
    invocation: { kind: 'direct' }, parameters: [strParam('enabled')],
    result: srcJsonCodec('dsh-cosplay-script#CosplayState'),
  },
  {
    id: 'dsh-cosplay-script#cosplay/setThinkingStyle',
    service: 'cosplay', namespace: 'cosplay', method: 'setThinkingStyle',
    invocation: { kind: 'direct' }, parameters: [strParam('style')],
    result: srcJsonCodec('dsh-cosplay-script#CosplayState'),
  },
  {
    id: 'dsh-cosplay-script#cosplay/setSessionRole',
    service: 'cosplay', namespace: 'cosplay', method: 'setSessionRole',
    invocation: { kind: 'direct' }, parameters: [strParam('sessionId'), strParam('roleId')],
    result: srcJsonCodec('dsh-cosplay-script#CosplayState'),
  },
  {
    id: 'dsh-cosplay-script#cosplay/setSessionEnabled',
    service: 'cosplay', namespace: 'cosplay', method: 'setSessionEnabled',
    invocation: { kind: 'direct' }, parameters: [strParam('sessionId'), strParam('enabled')],
    result: srcJsonCodec('dsh-cosplay-script#CosplayState'),
  },
  {
    id: 'dsh-cosplay-script#cosplay/bindSession',
    service: 'cosplay', namespace: 'cosplay', method: 'bindSession',
    invocation: { kind: 'direct' }, parameters: [strParam('sessionId'), strParam('roleId'), strParam('enabled')],
    result: srcJsonCodec('dsh-cosplay-script#CosplayState'),
  },
  {
    id: 'dsh-cosplay-script#cosplay/clearSession',
    service: 'cosplay', namespace: 'cosplay', method: 'clearSession',
    invocation: { kind: 'direct' }, parameters: [strParam('sessionId')],
    result: srcJsonCodec('dsh-cosplay-script#CosplayState'),
  },
  {
    id: 'dsh-cosplay-script#cosplay/setSlotSchema',
    service: 'cosplay', namespace: 'cosplay', method: 'setSlotSchema',
    invocation: { kind: 'direct' }, parameters: [strParam('schema')],
    result: srcJsonCodec('dsh-cosplay-script#CosplayState'),
  },
  {
    id: 'dsh-cosplay-script#cosplay/preview',
    service: 'cosplay', namespace: 'cosplay', method: 'preview',
    invocation: { kind: 'direct' }, parameters: [strParam('roleId'), strParam('sampleText'), strParam('sessionId')],
    result: srcJsonCodec('dsh-cosplay-script#Preview'),
  },
  {
    id: 'dsh-cosplay-script#cosplay/setSessionNote',
    service: 'cosplay', namespace: 'cosplay', method: 'setSessionNote',
    invocation: { kind: 'direct' }, parameters: [strParam('sessionId'), strParam('note')],
    result: srcJsonCodec('dsh-cosplay-script#CosplayState'),
  },
]

const COSPLAY_MEMBERS = [
  { kind: 'method', name: 'getState', signature: 'getState(): CosplayState' },
  { kind: 'method', name: 'listSessions', signature: 'listSessions(): Promise<SessionList>' },
  { kind: 'method', name: 'upsertRole', signature: 'upsertRole(card: RoleCard): Promise<CosplayState>' },
  { kind: 'method', name: 'removeRole', signature: 'removeRole(id: string): Promise<CosplayState>' },
  { kind: 'method', name: 'setEnabled', signature: 'setEnabled(enabled: boolean): Promise<CosplayState>' },
  { kind: 'method', name: 'setThinkingStyle', signature: 'setThinkingStyle(style: "neutral" | "role"): Promise<CosplayState>' },
  { kind: 'method', name: 'setSessionRole', signature: 'setSessionRole(sessionId: string, roleId: string | null): Promise<CosplayState>' },
  { kind: 'method', name: 'setSessionEnabled', signature: 'setSessionEnabled(sessionId: string, enabled: boolean): Promise<CosplayState>' },
  { kind: 'method', name: 'bindSession', signature: 'bindSession(sessionId: string, roleId: string | null, enabled: boolean): Promise<CosplayState>' },
  { kind: 'method', name: 'clearSession', signature: 'clearSession(sessionId: string): Promise<CosplayState>' },
  { kind: 'method', name: 'setSlotSchema', signature: 'setSlotSchema(schema: SlotDef[]): Promise<CosplayState>' },
  { kind: 'method', name: 'preview', signature: 'preview(roleId: string, sampleText: string, sessionId?: string): Promise<Preview>' },
  { kind: 'method', name: 'setSessionNote', signature: 'setSessionNote(sessionId: string, note: string): Promise<CosplayState>' },
]

const TYPERT_MANIFEST = {
  package: 'dsh-cosplay-script',
  face: 'host',
  schemas: [],
  model: {
    services: [
      {
        key: 'cosplay',
        exportName: 'CosplayRuntime',
        description: 'Cosplay 角色库与开关（dsh-cosplay-script 设置页数据通道）。',
        tags: [],
        members: COSPLAY_MEMBERS,
      },
    ],
    events: [],
    objects: [],
  },
  invocations: COSPLAY_INVOCATIONS,
}

/** 角色卡注入：system prompt section（权威位）。 */
export const CORE_SECTION = 'cosplay:core'
/** 紧跟部署人格(0) 之后、PLAN_POLICY(500) 之前。 */
const CORE_SECTION_ORDER = 5

/** 动态召回的 context 名称（只放本轮激活的条目）。 */
export const RECALL_NAME = 'cosplay:recall'
/** 动态尾部，和 soul-md 的召回同一区间。 */
const RECALL_ORDER = 300

/** 回退模式的上下文条目（injection: 'context'）。 */
export const CONTEXT_NAME = 'cosplay:role-card'

/** 上下文排序：放在 WORKING_DIRECTORY(100) 之后、SANDBOX_POLICY(110) 之前。 */
const CONTEXT_ORDER = 105

/**
 * 插件入口。
 * @param ctx - 插件上下文。
 * @param config - 本行 Config（0.2.x 为带 `.get()` 的 volatile 引用）。
 */
export function apply(ctx, config) {
  // ── 状态源 ────────────────────────────────────────────────────────────────
  // `config` 是 apply() 时拿到的 volatile 引用。**它不会因为我们写了文件而更新**：
  // 内核只在 settings.update 成功提交时原地改写它，而本插件走的是 bundle patch
  // （settings 不认这个条目）。因此这里维护一份进程内 override：
  //   - 写入成功后立刻缓存新状态 → UI 立即看到变化；
  //   - 重启后 override 为空，从文件读到已持久化的值。
  let memory = null

  // 读取的规范化结果做进程内缓存：config 在运行时不会变（我们只写补丁文件，
  // 不改这个引用），所以同一份对象可以复用。这既避免了每步重复深拷贝，
  // 也让上下文渲染缓存可以按对象身份命中断言（见下方 renderCache）。
  let configState = null
  const readFromConfig = () => {
    if (configState === null) {
      configState = normalizeState({
        enabled: readField(readStateRef().enabled),
        thinkingStyle: readField(readStateRef().thinkingStyle),
        slotSchema: readField(readStateRef().slotSchema),
        roles: readField(readStateRef().roles),
        sessionStates: readField(readStateRef().sessionStates),
        sessionNotes: readField(readStateRef().sessionNotes),
      })
    }
    return configState
  }

  function readStateRef() {
    return readField(config) ?? {}
  }

  // ── v4.1：状态文件 ────────────────────────────────────────────────────────
  // 测试环境（ctx.__test）完全跳过文件读写，避免污染真实数据。
  const fileEnabled = typeof ctx.__test?.applyConfigPatch !== 'function'
  let fileState
  let fileLoaded = false
  const readFileState = () => {
    if (!fileEnabled) return undefined
    if (!fileLoaded) {
      fileLoaded = true
      fileState = readStateFile(ctx)
    }
    return fileState
  }

  // 首次启动：把 patch 里的旧配置迁移到独立 JSON（只做一次）。
  if (fileEnabled && !existsSync(cosplayStateFile(ctx))) {
    try {
      const initial = readFromConfig()
      if (initial.enabled || initial.roles.length > 0 || Object.keys(initial.sessionStates).length > 0) {
        writeStateFile(ctx, initial)
        fileState = initial
        fileLoaded = true
      }
    } catch (error) {
      console.warn('[dsh-cosplay-script] 状态迁移失败，继续使用 profile patch:', String(error?.message ?? error))
    }
  }

  const read = () => memory ?? readFileState() ?? readFromConfig()

  // ── 串行化写入 ────────────────────────────────────────────────────────────
  // 每次写入都要序列化整份配置并落盘（异步 I/O）。若不排队，连续两次操作会出现：
  //   调用方都基于旧 memory 计算新状态 → 后完成的那次覆盖前一次 → 丢失更新
  //   （典型复现：选完角色立刻点「开启该会话」，其中一次被吃掉）。
  // 因此写入按队列串行执行，且**在队列内**才读取基线状态。
  let writeChain = Promise.resolve()

  /**
   * 提交一次状态变更。
   * @param input - 新状态对象，或 `(current) => next` 的变更函数。
   *               传函数时基线在队列执行时刻读取，天然避免丢失更新。
   * @returns 写入后的状态。
   */
  const write = (input) => {
    const run = async () => {
      const base = read()
      const next = normalizeState(typeof input === 'function' ? input(base) : input)
      const payload = {
        enabled: next.enabled === true,
        thinkingStyle: next.thinkingStyle === 'role' ? 'role' : 'neutral',
        slotSchema: next.slotSchema,
        roles: next.roles,
        sessionStates: next.sessionStates,
        sessionNotes: next.sessionNotes,
      }
      if (typeof ctx.__test?.applyConfigPatch === 'function') {
        ctx.__test.applyConfigPatch(payload)
      } else if (fileEnabled) {
        try {
          writeStateFile(ctx, next)
        } catch (error) {
          console.warn('[dsh-cosplay-script] 写状态文件失败，回退到 patch:', String(error?.message ?? error))
          await writeConfig(ctx, payload)
        }
      } else {
        await writeConfig(ctx, payload)
      }
      memory = next
      return memory
    }
    const result = writeChain.then(run, run)
    // 队列本身不因单次失败而断裂
    writeChain = result.then(() => undefined, () => undefined)
    return result
  }

  // ── typert Remote（设置页数据通道；同时注册 `cosplay` 服务） ───────────────
  new CosplayRuntime(ctx, read, write)
  // `typert` 在 inject 里（声明后才能 ctx.get 到），此处注册 manifest。
  // 注册失败不致命：工具与上下文注入仍然可用，只是设置页拿不到数据通道。
  try {
    ctx.effect(() => {
      const dispose = ctx.typert.register(TYPERT_MANIFEST)
      return () => {
        void dispose()
      }
    }, 'dsh-cosplay-script: typert manifest')
  } catch (error) {
    console.warn('[dsh-cosplay-script] typert manifest 注册失败:', String(error?.message ?? error))
  }

  // ── 关闭自动生成的设置表单（本插件自带设置页） ─────────────────────────────
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })

  // ── 注入层：section（默认）或 context（回退） ─────────────────────────────
  // 默认：core 走 system prompt section（权威位），召回走 context（动态尾部）。
  // 回退：injection='context' 时恢复 v3 的整卡上下文快照。
  const rawConfig = () => readField(readStateRef()) ?? {}
  const injectionMode = () => (rawConfig().injection === 'context' ? 'context' : 'section')

  const roleFor = (assembly) => {
    const sessionId = assembly?.scope?.id
    if (typeof sessionId !== 'string' || !sessionId) return null
    return resolveSessionRole(read(), sessionId)
  }

  // 会话运行时：召回只属于"当轮消息"，因此必须在 inbox/claimed 时算好。
  const runtimeStates = new WeakMap()
  const runtimeOf = (agent) => {
    const session = agent?.session
    if (!session || typeof session !== 'object') return null
    let rt = runtimeStates.get(session)
    if (rt === undefined) {
      rt = { turn: 0, text: '', until: new Map(), cooldownUntil: new Map() }
      runtimeStates.set(session, rt)
    }
    return rt
  }

  const renderCache = new WeakMap() // state -> Map<sessionId, text>
  const renderLegacyContext = (context) => {
    const sessionId = context?.scope?.id
    if (typeof sessionId !== 'string' || !sessionId) return ''
    const state = read()
    let perState = renderCache.get(state)
    if (perState === undefined) {
      perState = new Map()
      renderCache.set(state, perState)
    }
    const hit = perState.get(sessionId)
    if (hit !== undefined) return hit
    const text = renderSessionContext(state, sessionId)
    perState.set(sessionId, text)
    return text
  }

  /** 本轮召回文本：由 inbox 钩子写入的当轮消息驱动。 */
  const recallText = (assembly) => {
    if (injectionMode() !== 'section') return ''
    const sessionId = assembly?.scope?.id
    if (typeof sessionId !== 'string' || !sessionId) return ''
    const rt = runtimeOf(assembly?.scope)
    if (rt === null) return ''
    const role = roleFor(assembly)
    if (!role) return ''
    return composeRecall(role, read(), sessionId, rt)
  }

  /** 角色深度提示 + 本场提示 + 本轮召回。 */
  const composeRecall = (role, state, sessionId, rt) => {
    const blocks = []
    if (role.play?.note?.trim()) blocks.push(`## 角色提示\n[${role.play.note.trim()}]`)
    const note = state.sessionNotes?.[sessionId]
    if (note) blocks.push(`## 本场提示\n[${note}]`)
    const entries = renderRecallEntries(activate(role, rt.text, rt.turn, rt), 800)
    if (entries) blocks.push(entries)
    return blocks.join('\n\n')
  }

  if (injectionMode() === 'section') {
    ctx.systemPrompt.section({
      name: CORE_SECTION,
      order: CORE_SECTION_ORDER,
      interpolate: false,
      text: (assembly) => {
        const sessionId = assembly?.scope?.id
        if (typeof sessionId !== 'string' || !sessionId) return ''
        const state = read()
        const role = resolveSessionRole(state, sessionId)
        if (!role) return ''
        const doc = renderCore(role, { slotSchema: state.slotSchema })
        const directive = THINKING_DIRECTIVES[state.thinkingStyle]
        return directive ? `${doc}\n\n${directive}` : doc
      },
    })
    ctx.systemPrompt.context({
      name: RECALL_NAME,
      order: RECALL_ORDER,
      interpolate: false,
      text: (assembly) => recallText(assembly),
    })
  } else {
    ctx.systemPrompt.context({
      name: CONTEXT_NAME,
      order: CONTEXT_ORDER,
      text: renderLegacyContext,
    })
  }

  // 记录当轮用户消息：DSH 先组装提示词、再走 agent/pre-step，
  // 所以召回必须在 agent/inbox/claimed 这个更早的同步钩子里取文本。
  if (typeof ctx.on === 'function') {
    ctx.effect(() => {
      const dispose = ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
        if (!agent || !message) return
        const rt = runtimeOf(agent)
        if (rt === null) return
        if (message.source?.kind !== undefined && message.source.kind !== 'user') return
        rt.turn = Number.isFinite(turn) ? turn : rt.turn + 1
        rt.text = Array.isArray(message.content)
          ? message.content.filter((block) => block?.type === 'text').map((block) => block.text).join('\n').slice(0, 2000)
          : ''
      })
      return () => { try { dispose?.() } catch { /* ignore */ } }
    }, 'dsh-cosplay: recall cursor')

    ctx.effect(() => {
      const dispose = ctx.on('session/disposed', (session) => {
        runtimeStates.delete(session)
      })
      return () => { try { dispose?.() } catch { /* ignore */ } }
    }, 'dsh-cosplay: runtime cleanup')
  }

  // ── 全局工具（角色库管理；不自动改卡） ────────────────────────────────────

  const entriesOf = (role) => [...(role.lore ?? []), ...(role.scenes ?? [])]

  /** 目录文本：让模型知道「有什么」，不灌正文。 */
  const buildIndex = (role, maxChars = 1200) => {
    const entries = entriesOf(role)
    const lines = [`# ${role.name} (${role.id})`]
    lines.push('', `核心：${role.core?.identity ? summarize(role.core.identity, 80) : '（空）'}`)
    if (role.play?.style) lines.push(`扮演方式：${summarize(role.play.style, 60)}`)
    lines.push('', `条目 ${entries.length} 条：`)
    const sorted = [...entries].sort((a, b) => (b.priority ?? 50) - (a.priority ?? 50))
    let used = lines.join('\n').length
    for (const entry of sorted) {
      const row = `- \`${entry.id}\` ${entry.title}｜${entry.always ? '常驻' : '按需'}｜priority ${entry.priority ?? 50}｜${entry.content.length} 字${entry.keys.length ? `｜关键词 ${entry.keys.join('/')}` : ''}`
      if (used + 1 + row.length > maxChars) {
        lines.push('（目录不完整；内容仍可通过 cosplay_recall 读取）')
        break
      }
      lines.push(row)
      used += 1 + row.length
    }
    if (entries.length === 0) lines.push('（无条目；内容都在核心设定里）')
    return lines.join('\n')
  }

  const findEntry = (role, entryId) => entriesOf(role).find((entry) => entry.id === entryId) ?? null

  ctx.tools.register(defineTool({
    name: 'cosplay_index',
    description:
      '查看一张角色卡的目录：核心摘要 + 全部条目（id、标题、常驻/按需、优先级、长度、关键词）。不返回正文。' +
      '需要核对设定、或用户提到卡里可能有的内容时，先调用本工具，再用 cosplay_recall 取正文。只读操作。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '角色 id（可从 cosplay_list 获取）。' },
      },
      required: ['id'],
    },
    output: textOutput,
    async execute(args) {
      const role = findRole(read(), args.id)
      return role ? buildIndex(role) : `未找到角色: ${args.id}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'cosplay_recall',
    description:
      '读取角色卡中某一条目的正文（单条）。先用 cosplay_index 查看条目 id。不要凭记忆复述设定，需要时调用本工具。只读操作。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '角色 id。' },
        entryId: { type: 'string', description: '条目 id（从 cosplay_index 获取）。' },
      },
      required: ['id', 'entryId'],
    },
    output: textOutput,
    async execute(args) {
      const role = findRole(read(), args.id)
      if (!role) return `未找到角色: ${args.id}`
      const entry = findEntry(role, args.entryId)
      return entry ? renderEntry(entry) : `未找到条目: ${args.entryId}（用 cosplay_index 查看可用条目）`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'cosplay_preview',
    description:
      '预览某角色实际注入的内容：系统提示词里的核心文本，以及（可选）给一条示例消息时本轮会召回的条目。用于排错与确认预算。只读操作。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '角色 id。' },
        sampleText: { type: 'string', description: '可选。用于测试召回的示例用户消息。' },
      },
      required: ['id'],
    },
    output: textOutput,
    async execute(args) {
      const state = read()
      const role = findRole(state, args.id)
      if (!role) return `未找到角色: ${args.id}`
      const core = renderCore(role, { slotSchema: state.slotSchema })
      const sample = typeof args.sampleText === 'string' ? args.sampleText : ''
      const recall = sample
        ? renderRecallEntries(activate(role, sample, 1, { until: new Map(), cooldownUntil: new Map() }), 800)
        : ''
      return [
        `【系统提示词 section】${core.length} 字`,
        core,
        recall ? `\n【本轮召回】${recall.length} 字\n${recall}` : '\n（未提供示例消息，跳过召回）',
      ].join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'cosplay_note',
    description:
      `更新当前会话的「本场提示」（≤${SESSION_NOTE_MAX} 字，第三人称概要）。只在场景、时间、地点、关系或目标发生明显变化时调用；` +
      '不要每轮调用，不要写角色卡内容。它只影响当前会话，下一轮就会随上下文注入。空串表示清除。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: `新的本场提示（≤${SESSION_NOTE_MAX} 字）；空串表示清除。` },
      },
      required: ['text'],
    },
    output: textOutput,
    async execute(args, exec) {
      const agent = exec?.agent
      // 与注入侧保持一致：只认 session.id；不再回退到 agent.id，
      // 否则可能出现"写进去了但永远不注入"的静默不一致。
      const sessionId = agent?.session?.id
      if (typeof sessionId !== 'string' || !sessionId) {
        return '无法确定当前会话（缺少 agent.session.id），未更新本场提示。'
      }
      const text = typeof args.text === 'string' ? args.text.trim().slice(0, SESSION_NOTE_MAX) : ''
      await write((state) => setSessionNote(state, sessionId, text))
      return text ? `已更新本场提示（${text.length} 字）。` : '已清除本场提示。'
    },
  }))

  ctx.tools.register(defineTool({
    name: 'cosplay_show',
    description: '（兼容旧名）查看角色卡目录，等价于 cosplay_index。只读操作。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '角色 id（可从 cosplay_list 获取）。' },
      },
      required: ['id'],
    },
    output: textOutput,
    async execute(args) {
      const role = findRole(read(), args.id)
      return role ? buildIndex(role) : `未找到角色: ${args.id}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'cosplay_list',
    description: '列出角色库中全部角色（含 id、名称、字段数），以及各会话当前绑定的角色，并显示总开关状态。只读操作，任何时候都可用。',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    output: textOutput,
    async execute() {
      const state = read()
      const head = state.enabled ? 'Cosplay 总开关：开启' : 'Cosplay 总开关：关闭（所有会话都不扮演）'
      const lines = [head]
      if (state.roles.length === 0) {
        lines.push('角色库为空。')
      } else {
        lines.push('', '角色库：')
        for (const r of state.roles) {
          const n = [...(r.lore ?? []), ...(r.scenes ?? [])].length
          lines.push(`  ${r.emoji ?? ''} ${r.name} (${r.id}) — 核心${r.core?.identity ? '有' : '空'} / ${n} 个条目`)
        }
      }
      const bound = Object.entries(state.sessionStates).filter(([, st]) => st.enabled && st.roleId)
      if (bound.length > 0) {
        lines.push('', '已绑定角色的会话：')
        for (const [sessionId, st] of bound) {
          const role = findRole(state, st.roleId)
          lines.push(`  ${sessionId} → ${role ? role.name : st.roleId}`)
        }
      }
      return lines.join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'cosplay_upsert',
    description:
      '创建或更新一个角色卡。v5 结构：slots（固定槽位：身份/意识/性格/语气/用户档案/守则/行为）、play（扮演方式/示例/深度提示）、lore[]（设定知识条目）、scenes[]（剧情片段条目）；' +
      '条目含 keys（触发词）、exclude（排除词）、content、priority、always（常驻）、sticky/cooldown。' +
      '兼容旧结构 fields[]：每项 { label, value }，未提供 v5 结构时按标签自动迁移。' +
      'name 必填；emoji 与 system_prompt 可选。这是唯一写入角色库的入口 —— 除非用户明确要求，否则不要主动调用。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '既有角色 id；省略表示新建。' },
        name: { type: 'string', description: '角色显示名（必填）。' },
        emoji: { type: 'string', description: '可选缩略标记（仅用于内部标识，界面不展示）。' },
        system_prompt: { type: 'string', description: '总体扮演指令（可选，原样置于核心文本开头）。' },
        core: {
          type: 'object',
          description: '核心设定：identity / personality / voice / rules[]。',
          properties: {
            identity: { type: 'string', description: '身份与背景。' },
            personality: { type: 'string', description: '性格。' },
            voice: { type: 'string', description: '语气、自称、称呼、口癖。' },
            rules: { type: 'array', items: { type: 'string' }, description: '硬规则清单。' },
          },
        },
        play: {
          type: 'object',
          description: '扮演方式：style（描写优先级/长度权衡/视角）、examples（示例对话）、note（每轮末尾的深度提示）。',
          properties: {
            style: { type: 'string' },
            examples: { type: 'string' },
            note: { type: 'string', description: '每轮末尾注入的短提示（≤200 字），例如视角/句式/篇幅要求。' },
          },
        },
        lore: {
          type: 'array',
          description: '设定知识条目。',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              keys: { type: 'array', items: { type: 'string' }, description: '触发词。' },
              exclude: { type: 'array', items: { type: 'string' }, description: '排除词。' },
              content: { type: 'string' },
              priority: { type: 'number' },
              always: { type: 'boolean' },
              sticky: { type: 'number' },
              cooldown: { type: 'number' },
            },
            required: ['content'],
          },
        },
        scenes: {
          type: 'array',
          description: '剧情片段条目（结构同 lore）。',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              keys: { type: 'array', items: { type: 'string' } },
              exclude: { type: 'array', items: { type: 'string' } },
              content: { type: 'string' },
              priority: { type: 'number' },
              always: { type: 'boolean' },
              sticky: { type: 'number' },
              cooldown: { type: 'number' },
            },
            required: ['content'],
          },
        },
        slots: {
          type: 'object',
          description: '固定槽位内容：{ identity, consciousness, personality, voice, userProfile, rules, behavior }，值为纯文本。rules 用换行分隔每条。',
          additionalProperties: { type: 'string' },
        },
        fields: {
          type: 'array',
          description: '旧结构字段数组（兼容）。每项包含 label 与 value；没有 v5 结构时按标签自动迁移。',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: '字段标题。' },
              value: { type: 'string', description: '字段内容。' },
            },
            required: ['label'],
          },
        },
      },
      required: ['name'],
    },
    output: textOutput,
    async execute(args) {
      const state = read()
      const id = args.id || nextId(state, args.name)
      const fields = Array.isArray(args.fields)
        ? args.fields
            .filter((f) => f && typeof f === 'object')
            .map((f) => ({
              key: nextFieldKey(),
              label: typeof f.label === 'string' ? f.label : '',
              value: typeof f.value === 'string' ? f.value : '',
            }))
            .filter((f) => f.label.trim() || f.value.trim())
        : []
      const next = upsertRole(state, {
        id,
        name: args.name,
        emoji: args.emoji,
        system_prompt: args.system_prompt,
        slots: args.slots,
        slotsEdited: args.slots !== undefined,
        fields,
        core: args.core,
        play: args.play,
        lore: args.lore,
        scenes: args.scenes,
      })
      await write(next)
      const role = findRole(next, id)
      const entries = [...(role.lore ?? []), ...(role.scenes ?? [])]
      return `已保存角色「${role.name}」(${role.id})：核心${role.core?.identity ? '已设置' : '为空'}，${entries.length} 个条目${entries.length ? `（${entries.map((e) => e.title).join(' / ')}）` : ''}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'cosplay_remove',
    description: '从角色库删除一个角色（角色库管理）。会同时解除所有会话对该角色的绑定。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '要删除的角色 id。' },
      },
      required: ['id'],
    },
    output: textOutput,
    async execute(args) {
      const state = read()
      if (!findRole(state, args.id)) return `未找到角色: ${args.id}`
      await write(removeRole(state, args.id))
      return `已删除角色 ${args.id}。`
    },
  }))

  console.log(`[dsh-cosplay-script] cosplay-core activated (entry=${ENTRY_ID}, mode=${injectionMode()}, scope=session)`)
}
