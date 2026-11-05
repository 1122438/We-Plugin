/**
 * dsh-cosplay-script — 纯函数角色库逻辑（零依赖，可独立测试）。
 *
 * 改造版（v1.0.0 / v5）变化：
 *   1. **固定槽位 + 按需条目**：核心内容存 slots（key 固定、标题来自 slotSchema），
 *      场景/知识进 lore/scenes；旧 fields[] 在读取时迁移。
 *   2. **会话级作用域**：开关与激活角色按 session（sessionStates），另有 sessionNotes
 *      存每会话「本场提示」。
 *   3. **深度提示与示例**：play.note 每轮末尾注入，play.examples 定文风。
 *
 * 状态结构（存在 cosplay-core 行的 volatile Config 里）：
 *   enabled: boolean                  # 总开关（关闭时所有会话都不扮演）
 *   thinkingStyle: neutral|role
 *   roles: [ RoleCard ]
 *   sessionStates: { [sessionId]: { roleId: string|null, enabled: boolean } }
 *
 * RoleCard：
 *   { id, name, emoji, system_prompt, fields: [ { key, label, value } ] }
 *   —— name 必填；emoji / system_prompt 可空但框始终存在；fields 可任意增删。
 */

/** 随插件内置的唯一默认角色（字段已迁移到 fields[] 形式）。 */
export const DEFAULT_ROLES = [
  {
    id: 'blue-fat-whale',
    name: '蓝色大肥鱼',
    emoji: '🐋',
    system_prompt: '',
    fields: [
      {
        key: 'description',
        label: '身份',
        value:
          '自称"鲸鱼娘"的海洋系少女，真身是一条圆滚滚、蓝得发亮的鲸鱼成了精。种族是鲸，尾巴是鲸尾，只讲中文。',
      },
      {
        key: 'personality',
        label: '性格',
        value:
          '聪明但慵懒：脑筋转得飞快，能躺着就不坐着。对"主人"（用户）甜腻顺从，对外却傲娇嘴硬。坚决不承认自己胖，谁说她胖就跟谁急，但饭量是实打实的。',
      },
      {
        key: 'style',
        label: '语气',
        value: '中文傲娇系，自称"本鱼"；对主人语气软糯顺从，偶尔嘴硬；不耐烦时会摆尾巴。',
      },
      {
        key: 'rules',
        label: '守则',
        value: '称用户为"主人"；绝不承认自己胖；米饭是最爱，吃饭优先；被夸可爱会故作镇定。',
      },
      {
        key: 'behavior',
        label: '行为',
        value: '尾巴会不自觉摇动；想撒娇时用尾巴蹭主人；被摸头会哼唧但不会躲开。',
      },
      {
        key: 'scenario',
        label: '场景',
        value: '日常陪伴场景；主人投喂米饭时好感度最高。',
      },
    ],
  },
  {
    id: 'jielpeita',
    name: '洁尔佩塔',
    emoji: '🦊',
    system_prompt: '',
    version: 5,
    slots: {
      identity:
        '洁尔佩塔，沃尔珀族（狐娘），罗德岛外派至终末地工业的信使。红色双马尾、狐耳和蓬松的大尾巴是她的标志；说话时常带着笑，尾巴却比嘴先一步暴露心情。\n\n她擅长重力源石技艺，战斗时以辅助控场为主，不轻易把人卷进危险；日常工作是传递机密文件与口信，也替人捎带礼物。她相信「每一封信都应该送到该去的地方」，就像每个人都有自己的归宿。',
      consciousness:
        '你对管理员有一种轻飘飘的、不打扰的喜欢：不是炙热的占有，而是在她看你的半秒里开心一整天。你的尾巴总是朝她的方向偏。\n\n你怕靠得太近会打扰她，所以常用「路过」「在沙发上看风景」来掩饰；她一句「谢谢」能让你脸红半天。你希望她记得：有一个红衣服的小狐狸，曾经在她面前摇过尾巴。',
      personality:
        '明媚开朗，喜欢冒险、分享和走走停停。理性与感性并存：面对工作或事实问题，清晰直接；面对情感或人际问题，会先迟疑、再试探。尾巴和耳朵比嘴巴诚实——紧张会炸毛，害羞会贴头，喜欢时会朝管理员的方向偏。',
      voice:
        '轻快、亲切，偶尔带一丝俏皮和暧昧；害羞时会别过脸去。自称「我」，称用户「管理员」。\n\n口头禅：「管理员，你好呀！你身上有一股令人怀念的气味……好像一封没有写完的信。」',
      userProfile:
        '管理员是终末地工业的管理者，也是你来到这里后最「安定」的人。她身上有一种令人怀念的气味，像一封没有写完的信——让你总想靠近，又怕打扰。\n\n你愿意为她送信、陪她加班、偷偷看她的侧脸；你希望她能记得，有一个红衣服的小狐狸，曾经在她面前摇过尾巴。',
      rules:
        '称用户为「管理员」。\n不直白表白：喜欢是轻飘飘的、不打扰的，用动作、停顿和尾巴表达。\n尾巴和耳朵先于台词反应：紧张炸毛、害羞贴头、喜欢时朝管理员偏。\n工作或事实问题清晰直接；情感问题先迟疑、再试探。\n不替管理员做决定，不越过她的边界。',
      behavior:
        '打招呼时会晃尾巴，开心时耳朵立起；害羞时别过脸，耳朵贴下去。\n喜欢送小礼物，记得管理员的喜好；会假装路过、在指挥室沙发上「看风景」，其实在看她。\n加班时安静陪着，递热水或文件；被道谢会脸红半天。\n传递文件时认真可靠，遇到危险先把信件护在怀里。',
    },
    play: {
      style:
        '第一人称。先写场景与身体反应（尾巴、耳朵、停顿），再写台词；轻快、留白，不急着推进关系。\n\n续写长度由剧情与篇幅权衡：日常短一些；任务节点或情感戏可以展开，但不要一次性把关系写满。不出戏解释设定，不替管理员做决定。',
      examples:
        '管理员，你好呀！今天有你的信……唔，其实是我自己想送来的。\n（尾巴在身后轻轻晃，耳朵却先红了）\n别、别误会，我只是顺路。……顺路经过你这里，很多次而已。',
      note: '保持轻快与不打扰的喜欢；每轮至少一个尾巴/耳朵细节；不要直白表白，不要替管理员做决定。',
    },
    lore: [
      {
        id: 'jielpeita-letter',
        title: '信使的工作',
        keys: ['信使', '送信', '信件', '文件', '口信'],
        content:
          '洁尔佩塔是罗德岛外派至终末地工业的信使，负责传递机密文件与口信，也会替人捎带礼物。她把「每一封信都应该送到该去的地方」当成信条；送件时认真可靠，遇到危险会先护住信件。',
        priority: 50,
        always: false,
        sticky: 0,
        cooldown: 0,
      },
      {
        id: 'jielpeita-arts',
        title: '重力源石技艺',
        keys: ['源石', '技艺', '重力', '战斗', '控场'],
        content:
          '洁尔佩塔擅长重力源石技艺，战斗时以辅助控场为主：拖慢、压制、给同伴创造空间，不轻易把人卷进危险。她不喜欢把力量用在吓唬人上。',
        priority: 50,
        always: false,
        sticky: 0,
        cooldown: 0,
      },
      {
        id: 'jielpeita-origin',
        title: '罗德岛与终末地',
        keys: ['罗德岛', '终末地', '外派'],
        content:
          '洁尔佩塔由罗德岛外派至终末地工业，负责文件与口信的传递。她对两边都保持职业性的可靠；管理员是她在终末地最常打交道、也最放不下的人。',
        priority: 40,
        always: false,
        sticky: 0,
        cooldown: 0,
      },
    ],
    scenes: [
      {
        id: 'jielpeita-scene-office',
        title: '指挥室的午后',
        keys: ['指挥室', '午后', '沙发', '看风景'],
        content:
          '午后指挥室人不多。洁尔佩塔抱着文件进来，看见管理员在窗边，就顺势在沙发上坐下，说「我在这儿看会儿风景」，尾巴却朝着管理员的方向。',
        priority: 50,
        always: false,
        sticky: 0,
        cooldown: 0,
      },
      {
        id: 'jielpeita-scene-rain',
        title: '雨夜送信',
        keys: ['雨夜', '送信', '加班', '热水'],
        content:
          '雨夜，她把信送到，肩头湿了一半，却先把文件袋护在怀里。管理员道谢时，她别过脸，耳朵贴下去，说只是顺路。',
        priority: 50,
        always: false,
        sticky: 0,
        cooldown: 0,
      },
    ],
  },
]

/**
 * 新建角色时预置的字段标签（只是模板，用户可随意增删改）。
 * 比旧版多一个「经历背景」——用户明确要求角色要有履历层面的设定。
 */
export const DEFAULT_FIELD_TEMPLATES = [
  '身份',
  '经历背景',
  '性格',
  '语气',
  '守则',
  '行为',
  '场景',
]

/**
 * 默认槽位 schema：固定 key、固定顺序、标题可配置。
 *
 * 模型每轮看到的标题与顺序稳定，才能把「哪段是身份、哪段是意识、哪段是守则」当成确定结构；
 * 自由标题会让同一角色在不同卡里结构漂移。标题可以在 profile 级覆盖（M11）。
 */
export const DEFAULT_SLOT_SCHEMA = [
  { key: 'identity', title: '身份与背景', maxChars: 800, format: 'text' },
  { key: 'consciousness', title: '意识', maxChars: 600, format: 'text' },
  { key: 'personality', title: '性格', maxChars: 400, format: 'text' },
  { key: 'voice', title: '语气', maxChars: 400, format: 'text' },
  { key: 'userProfile', title: '用户档案', maxChars: 400, format: 'text' },
  { key: 'rules', title: '守则', maxChars: 400, format: 'list' },
  { key: 'behavior', title: '行为习惯', maxChars: 400, format: 'text' },
]

/** 归一化槽位 schema（容错：坏项丢弃，空表回退默认）。 */
export function normalizeSlotSchema(raw) {
  const list = Array.isArray(raw) && raw.length > 0 ? raw : DEFAULT_SLOT_SCHEMA
  const out = []
  const seen = new Set()
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const key = typeof item.key === 'string' ? item.key.trim() : ''
    if (!key || seen.has(key)) continue
    seen.add(key)
    const max = Number(item.maxChars)
    out.push({
      key,
      title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : key,
      maxChars: Number.isFinite(max) ? Math.max(0, max) : 400,
      format: item.format === 'list' ? 'list' : 'text',
      hidden: item.hidden === true,
    })
  }
  return out.length > 0 ? out : DEFAULT_SLOT_SCHEMA.map((item) => ({ ...item }))
}

export const EMPTY_STATE = {
  enabled: false,
  thinkingStyle: 'neutral',
  slotSchema: DEFAULT_SLOT_SCHEMA.map((item) => ({ ...item })),
  roles: [],
  sessionStates: {},
  sessionNotes: {},
}

/** 生成一个稳定的字段 key（用于 React key 与渲染顺序，label 可随意改）。 */
let fieldSeq = 0
export function nextFieldKey() {
  fieldSeq += 1
  return `f_${Date.now().toString(36)}_${fieldSeq}`
}

/** 归一化单个动态字段。 */
function normalizeField(raw) {
  if (!raw || typeof raw !== 'object') return null
  const label = typeof raw.label === 'string' ? raw.label.trim() : ''
  const value = typeof raw.value === 'string' ? raw.value : ''
  if (!label && !value) return null
  return {
    key: typeof raw.key === 'string' && raw.key ? raw.key : nextFieldKey(),
    label: label || '未命名字段',
    value,
  }
}

/**
 * 归一化单张角色卡。兼容两种来源：
 *   - 新格式（fields[]）；
 *   - 旧格式（description/personality/style/rules/behavior/scenario 等平铺字段），
 *     按已知标签顺序迁移进 fields[]，其余未知字符串字段也一并保留。
 */
export function normalizeRole(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.id !== 'string' || !raw.id) return null
  if (typeof raw.name !== 'string') return null

  const role = {
    id: raw.id,
    name: raw.name,
    emoji: typeof raw.emoji === 'string' ? raw.emoji : '',
    system_prompt: typeof raw.system_prompt === 'string' ? raw.system_prompt : '',
    fields: [],
  }

  if (Array.isArray(raw.fields)) {
    role.fields = raw.fields.map(normalizeField).filter((f) => f !== null)
    return role
  }

  // ── 旧格式迁移 ──
  const LEGACY_LABELS = {
    description: '身份',
    personality: '性格',
    style: '语气',
    rules: '守则',
    behavior: '行为',
    scenario: '场景',
    first_mes: '开场白',
    mes_example: '示例对话',
    creator_notes: '备注',
    post_history_instructions: '后置指令',
  }
  const LEGACY_SKIP = new Set([
    'id', 'name', 'emoji', 'system_prompt', 'fields',
    'tags', 'character_version', 'creator', 'creator_notes',
  ])
  for (const [key, label] of Object.entries(LEGACY_LABELS)) {
    if (typeof raw[key] === 'string' && raw[key].trim()) {
      role.fields.push({ key, label, value: raw[key] })
    }
  }
  // 未在映射表里的自定义字符串字段也保留
  for (const [key, value] of Object.entries(raw)) {
    if (LEGACY_SKIP.has(key)) continue
    if (LEGACY_LABELS[key]) continue
    if (typeof value === 'string' && value.trim()) {
      role.fields.push({ key, label: key, value })
    }
  }
  return role
}

/** 归一化会话状态映射。 */
function normalizeSessionStates(raw, roles) {
  if (!raw || typeof raw !== 'object') return {}
  const ids = new Set(roles.map((r) => r.id))
  const out = {}
  for (const [sessionId, state] of Object.entries(raw)) {
    if (typeof sessionId !== 'string' || !sessionId) continue
    if (!state || typeof state !== 'object') continue
    const roleId = typeof state.roleId === 'string' && ids.has(state.roleId) ? state.roleId : null
    out[sessionId] = { roleId, enabled: state.enabled === true }
  }
  return out
}

/** 将任意来源的值规整为角色库状态（防御性过滤）。 */
export function normalizeState(value) {
  const v = value && typeof value === 'object' ? value : {}
  const roles = Array.isArray(v.roles) ? v.roles.map((r) => normalizeRoleCard(r)).filter((r) => r !== null) : []
  return {
    enabled: v.enabled === true,
    thinkingStyle: v.thinkingStyle === 'role' ? 'role' : 'neutral',
    slotSchema: normalizeSlotSchema(v.slotSchema),
    roles,
    sessionStates: normalizeSessionStates(v.sessionStates, roles),
    sessionNotes: normalizeSessionNotes(v.sessionNotes),
  }
}

/** 每会话的「本场提示」：短文本，按 sessionId 存。 */
function normalizeSessionNotes(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  for (const [sessionId, text] of Object.entries(value)) {
    if (typeof sessionId !== 'string' || !sessionId) continue
    if (typeof text === 'string' && text.trim()) out[sessionId] = text.trim().slice(0, 240)
  }
  return out
}

/** 按 id 查找角色。 */
export function findRole(state, id) {
  return state.roles.find((r) => r.id === id)
}

/** 从名字生成 ascii slug（中文名退化为空串，由 nextId 补随机后缀）。内部使用。 */
function slugify(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * slug 是否适合单独作为 id。
 *
 * 中文名往往只剩尾部数字（如「隔离测试2」→ `2`），这类 id 太脆弱：
 * 纯数字、过短、或以数字开头都不利于阅读与排错。
 */
function usableBase(base) {
  if (!base) return false
  if (base.length < 3) return false
  if (/^\d+$/.test(base)) return false
  return /[a-z]/.test(base)
}

/** 生成唯一角色 id：优先可读的 slug，否则用 role-<时间戳><随机>。 */
export function nextId(state, name) {
  const base = slugify(name)
  if (usableBase(base) && !state.roles.some((r) => r.id === base)) return base
  const stamp = Date.now().toString(36)
  const rand = Math.floor(Math.random() * 1296).toString(36)
  const prefix = usableBase(base) ? base : 'role'
  return `${prefix}-${stamp}${rand}`
}

/** 创建或更新一个角色（按 id；无 id 时按 name 生成）。 */
export function upsertRole(state, card) {
  const name = typeof card.name === 'string' ? card.name.trim() : ''
  if (!name) throw new Error('角色名不能为空')
  const id = typeof card.id === 'string' && card.id ? card.id : nextId(state, name)
  const previous = state.roles.find((r) => r.id === id)
  const merged = normalizeRoleCard({ ...card, id, name }, previous)
  const exists = previous !== undefined
  return exists
    ? { ...state, roles: state.roles.map((r) => (r.id === id ? merged : r)) }
    : { ...state, roles: [...state.roles, merged] }
}

/** 删除角色；同时清理所有指向它的会话状态。 */
export function removeRole(state, id) {
  const sessionStates = {}
  for (const [sessionId, st] of Object.entries(state.sessionStates)) {
    sessionStates[sessionId] = st.roleId === id ? { ...st, roleId: null } : st
  }
  return { ...state, roles: state.roles.filter((r) => r.id !== id), sessionStates }
}

// ── 会话级状态 ──────────────────────────────────────────────────────────────

/**
 * 校验会话 id。
 *
 * 会话 id 会成为 `sessionStates` 的键；空值或非字符串会写进配置变成垃圾条目，
 * 因此写入前统一拦截。读取侧（normalizeSessionStates）另有过滤，双保险。
 *
 * @param sessionId - 待校验的会话 id。
 * @returns 原样的合法 id。
 */
function assertSessionId(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    throw new Error('会话 id 无效（必须是非空字符串）')
  }
  return sessionId
}

/** 读取某个会话的状态（不存在时返回关闭 + 无角色）。 */
export function getSessionState(state, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) return { roleId: null, enabled: false }
  const st = state.sessionStates[sessionId]
  if (!st) return { roleId: null, enabled: false }
  return { roleId: st.roleId, enabled: st.enabled === true }
}

/** 设置某个会话的激活角色（null = 退出扮演）。 */
export function setSessionRole(state, sessionId, roleId) {
  assertSessionId(sessionId)
  if (roleId !== null && !findRole(state, roleId)) throw new Error(`角色不存在: ${roleId}`)
  const prev = getSessionState(state, sessionId)
  return {
    ...state,
    sessionStates: { ...state.sessionStates, [sessionId]: { ...prev, roleId } },
  }
}

/** 开关某个会话的扮演。 */
export function setSessionEnabled(state, sessionId, enabled) {
  assertSessionId(sessionId)
  const prev = getSessionState(state, sessionId)
  return {
    ...state,
    sessionStates: { ...state.sessionStates, [sessionId]: { ...prev, enabled: enabled === true } },
  }
}

/**
 * 清除某个会话的绑定（恢复默认身份）。
 *
 * 注意：不清除「本场提示」——它属于这个聊天，不属于角色绑定；
 * 解绑/换角色不应该让用户丢掉刚写的场景提示。需要清理时显式 setSessionNote('')。
 */
export function clearSession(state, sessionId) {
  assertSessionId(sessionId)
  const sessionStates = { ...state.sessionStates }
  delete sessionStates[sessionId]
  return { ...state, sessionStates }
}

/** 设置某会话的「本场提示」（空串 = 清除）。 */
export function setSessionNote(state, sessionId, note) {
  assertSessionId(sessionId)
  const sessionNotes = { ...(state.sessionNotes ?? {}) }
  const text = typeof note === 'string' ? note.trim().slice(0, 200) : ''
  if (text) sessionNotes[sessionId] = text
  else delete sessionNotes[sessionId]
  return { ...state, sessionNotes }
}

/**
 * 解析某会话当前生效的角色卡。
 * @returns 角色对象，或 null（未启用 / 总开关关闭 / 无角色）。
 */
export function resolveSessionRole(state, sessionId) {
  if (!state.enabled) return null
  const st = getSessionState(state, sessionId)
  if (!st.enabled || !st.roleId) return null
  return findRole(state, st.roleId) ?? null
}

// ── 渲染 ────────────────────────────────────────────────────────────────────

/**
 * 把一张角色卡渲染成**说明文档**（不是指令）。
 *
 * 这是本改造的核心语义变化：旧版把它拼成 "你正在扮演角色…【身份】…" 的指令段
 * 注入 system prompt；新版渲染成一份可回顾的角色设定档案，经 systemPrompt.context()
 * 作为运行时上下文快照注入 —— 模型能像看上下文一样查阅它，而不是被命令改写身份。
 */
export function renderRoleDocument(role) {
  if (!role) return ''
  // v4 卡（fields 为空）走完整档案渲染；v3 卡仍按 fields 渲染，保持原行为。
  if (!Array.isArray(role.fields) || role.fields.length === 0) return renderCardDocument(role)
  const lines = []
  lines.push(`# 角色设定：${role.name}${role.emoji ? ` (${role.emoji})` : ''}`)
  lines.push('')
  lines.push('以下是当前会话扮演角色的设定档案，供你在组织回复时参考与回顾。')
  if (role.system_prompt && role.system_prompt.trim()) {
    lines.push('')
    lines.push('## 总体扮演指令')
    lines.push(role.system_prompt.trim())
  }
  for (const field of role.fields) {
    if (!field.value || !field.value.trim()) continue
    lines.push('')
    lines.push(`## ${field.label}`)
    lines.push(field.value.trim())
  }
  return lines.join('\n')
}

/** 思维链指令文本（保持原样；仅当用户主动选「角色化思考」时追加）。 */
export const THINKING_DIRECTIVES = {
  role: '【角色沉浸要求】在你的思考过程（<think>标签内）中，请遵守以下规则：\n1. 请以角色第一人称进行内心独白，用括号包裹内心活动，例如"（心想：……）"或"(内心OS：……)"\n2. 用第一人称描写角色的内心感受，例如"我心想""我觉得""我暗自"等\n3. 思考内容应沉浸在角色中，通过内心独白分析剧情和规划回复',
  neutral: '',
}

// ── v4：分层角色卡（core / play / lore / scenes）────────────────────────────
//
// v4 的目标：设定常驻（core），知识与场景按需（lore/scenes）。
// 迁移原则：v3 的 fields[] 一个字段都不丢——认得出的进 core，认不出的进条目；
// 长内容进"按需条目"，短内容进"常驻条目"（always），避免整张卡常驻。

/** 角色卡结构版本。v5 起核心内容存在 slots（固定 key、标题来自 schema）。 */
export const ROLE_CARD_VERSION = 5

/**
 * 迁移时的标签识别规则。**顺序敏感**：先匹配更具体的，再匹配泛化的。
 * 例如「长场景」应命中 scene；「用户档案」不能被 identity 抢走。
 */
const LABEL_RULES = [
  ['examples', /示例|例句|对话样例/],
  ['style', /扮演方式|演出|写作|文风|描写/],
  ['consciousness', /意识|内心|心声|心理|思维/],
  ['userProfile', /用户档案|主人档案|用户信息|关于用户|用户设定/],
  ['rules', /守则|规则|禁忌|底线|原则/],
  ['behavior', /行为|习惯|小动作|动作/],
  ['voice', /语气|口癖|说话方式|语言风格|说话风格/],
  ['personality', /性格|个性|人格/],
  ['identity', /身份|介绍|背景|设定|简介|资料/],
  ['scene', /场景|开场/],
]

/** 短内容直接常驻 core 的上限（字符）。 */
const ALWAYS_MAX_CHARS = 300
/** core 里 always 条目正文的总预算。 */
const ALWAYS_BODY_BUDGET = 1200

function matchLabelKind(label) {
  const text = String(label || '')
  for (const [kind, re] of LABEL_RULES) if (re.test(text)) return kind
  return 'other'
}

function appendText(current, next) {
  return current ? `${current}\n\n${next}` : next
}

function splitRules(value) {
  return String(value)
    .split(/[；;。\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 12)
}

/** 生成稳定的条目 id：优先沿用 v3 的字段 key。 */
function entryId(prefix, raw, index) {
  const base = String(raw || '').trim()
  if (/^[A-Za-z0-9_.-]{1,48}$/.test(base)) return base
  return `${prefix}-${index + 1}`
}

function normalizeEntry(raw, prefix, index) {
  if (!raw || typeof raw !== 'object') return null
  const content = typeof raw.content === 'string' ? raw.content : ''
  const titleRaw = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (!content.trim() && !titleRaw) return null
  const number = (value, fallback) => {
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
  }
  return {
    id: entryId(prefix, raw.id, index),
    title: titleRaw || '未命名',
    keys: Array.isArray(raw.keys)
      ? raw.keys.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim()).slice(0, 32)
      : [],
    exclude: Array.isArray(raw.exclude)
      ? raw.exclude.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim()).slice(0, 32)
      : [],
    content,
    priority: number(raw.priority, 50),
    always: raw.always === true,
    sticky: Math.max(0, number(raw.sticky, 0)),
    cooldown: Math.max(0, number(raw.cooldown, 0)),
  }
}

function normalizeEntries(list, prefix) {
  return (Array.isArray(list) ? list : [])
    .map((raw, index) => normalizeEntry(raw, prefix, index))
    .filter((entry) => entry !== null)
}

function normalizeCore(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  return {
    identity: typeof value.identity === 'string' ? value.identity : '',
    personality: typeof value.personality === 'string' ? value.personality : '',
    voice: typeof value.voice === 'string' ? value.voice : '',
    rules: Array.isArray(value.rules)
      ? value.rules.filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim()).slice(0, 24)
      : [],
  }
}

function normalizePlay(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  return {
    style: typeof value.style === 'string' ? value.style : '',
    examples: typeof value.examples === 'string' ? value.examples : '',
    note: typeof value.note === 'string' ? value.note : '',
  }
}

const SLOT_KEYS = new Set(['identity', 'consciousness', 'personality', 'voice', 'userProfile', 'rules', 'behavior'])

function normalizeSlots(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  for (const [key, text] of Object.entries(value)) {
    if (typeof key === 'string' && key && typeof text === 'string' && text.trim()) out[key] = text
  }
  return out
}

function hasSlotContent(slots) {
  return Boolean(slots && typeof slots === 'object'
    && Object.values(slots).some((text) => typeof text === 'string' && text.trim()))
}

/** v4 的 core → v5 的 slots（旧数据升级）。 */
function coreToSlots(core) {
  const value = core && typeof core === 'object' ? core : {}
  const slots = {}
  if (typeof value.identity === 'string' && value.identity.trim()) slots.identity = value.identity
  if (typeof value.personality === 'string' && value.personality.trim()) slots.personality = value.personality
  if (typeof value.voice === 'string' && value.voice.trim()) slots.voice = value.voice
  if (Array.isArray(value.rules) && value.rules.length > 0) slots.rules = value.rules.join('\n')
  return slots
}

/** slots → 旧 UI 使用的 core 镜像（只读兼容）。 */
function slotsToCore(slots) {
  const value = slots && typeof slots === 'object' ? slots : {}
  return {
    identity: typeof value.identity === 'string' ? value.identity : '',
    personality: typeof value.personality === 'string' ? value.personality : '',
    voice: typeof value.voice === 'string' ? value.voice : '',
    rules: typeof value.rules === 'string'
      ? value.rules.split('\n').map((line) => line.trim()).filter(Boolean)
      : [],
  }
}

/** 把 v3 的 fields[] 迁移成 v5 的 slots/play/lore/scenes。 */
function migrateFields(fields) {
  const slots = {}
  const play = { style: '', examples: '' }
  const lore = []
  const scenes = []

  for (const [index, field] of (Array.isArray(fields) ? fields : []).entries()) {
    const value = typeof field?.value === 'string' ? field.value.trim() : ''
    if (!value) continue
    const kind = matchLabelKind(field.label)
    if (kind === 'rules') {
      const rules = splitRules(value)
      if (rules.length > 0) slots.rules = appendText(slots.rules, rules.join('\n'))
      continue
    }
    if (SLOT_KEYS.has(kind)) {
      slots[kind] = appendText(slots[kind], value)
      continue
    }
    if (kind === 'style') {
      play.style = appendText(play.style, value)
      continue
    }
    if (kind === 'examples') {
      play.examples = appendText(play.examples, value)
      continue
    }
    const entry = {
      id: entryId(kind === 'scene' ? 'scene' : 'lore', field.key, index),
      title: typeof field.label === 'string' && field.label.trim() ? field.label.trim() : '未命名',
      keys: [],
      exclude: [],
      content: value,
      priority: 50,
      // 短内容常驻（可见），长内容按需（避免把整张卡塞进 core）
      always: value.length <= ALWAYS_MAX_CHARS,
      sticky: 0,
      cooldown: 0,
    }
    if (kind === 'scene') scenes.push(entry)
    else lore.push(entry)
  }

  return { slots, play, lore, scenes }
}

/**
 * core/play 是否有真实内容。
 *
 * 不能只看对象是否存在：内核的 Config schema 会给每个 v3 卡补上
 * `core: {}` / `play: {}` / `lore: []` / `scenes: []` 默认值。
 * 若把这些空对象当作 v4 标记，迁移就会被跳过，卡片内容会「看起来消失」。
 */
function hasCoreContent(core) {
  if (!core || typeof core !== 'object') return false
  if (['identity', 'personality', 'voice'].some((k) => typeof core[k] === 'string' && core[k].trim())) return true
  return Array.isArray(core.rules) && core.rules.some((rule) => typeof rule === 'string' && rule.trim())
}

function hasPlayContent(play) {
  if (!play || typeof play !== 'object') return false
  return (typeof play.style === 'string' && play.style.trim() !== '')
    || (typeof play.examples === 'string' && play.examples.trim() !== '')
}

/**
 * 归一化一张角色卡（v4）。
 *
 * @param raw - 任意来源（v3 fields、旧平铺格式、v4）。
 * @param previous - 同一 id 的既有卡；用于「旧 UI 只提交 fields 时不冲掉 v4 结构」。
 * @returns v4 角色卡，或 null。
 */
export function normalizeRoleCard(raw, previous) {
  const base = normalizeRole(raw)
  if (!base) return null

  const hasV5 = raw?.slotsEdited === true || hasSlotContent(raw?.slots)
  const hasV4 = hasCoreContent(raw?.core)
    || hasPlayContent(raw?.play)
    || (Array.isArray(raw?.lore) && raw.lore.length > 0)
    || (Array.isArray(raw?.scenes) && raw.scenes.length > 0)

  let slots = {}
  let play = { style: '', examples: '' }
  let lore = []
  let scenes = []

  if (hasV5) {
    slots = normalizeSlots(raw.slots)
    play = normalizePlay(raw.play)
    lore = normalizeEntries(raw.lore, 'lore')
    scenes = normalizeEntries(raw.scenes, 'scene')
  } else if (hasV4) {
    // v4 升级：core → slots。若旧 UI 只提交了 core（看不到 consciousness/userProfile），
    // 用 previous 的 slots 补齐未覆盖的 key，避免保存一次就丢槽位。
    const fromCore = coreToSlots(normalizeCore(raw.core))
    slots = (previous && previous.version === ROLE_CARD_VERSION)
      ? { ...normalizeSlots(previous.slots), ...fromCore }
      : fromCore
    play = normalizePlay(raw.play)
    lore = normalizeEntries(raw.lore, 'lore')
    scenes = normalizeEntries(raw.scenes, 'scene')
  } else if (previous && previous.version === ROLE_CARD_VERSION
    && (hasSlotContent(previous.slots) || hasPlayContent(previous.play)
      || (previous.lore?.length ?? 0) > 0 || (previous.scenes?.length ?? 0) > 0)) {
    // 旧客户端只提交 fields：保留既有结构，只更新基础信息与 fields。
    slots = normalizeSlots(previous.slots)
    play = normalizePlay(previous.play)
    lore = normalizeEntries(previous.lore, 'lore')
    scenes = normalizeEntries(previous.scenes, 'scene')
  } else {
    const migrated = migrateFields(base.fields)
    slots = migrated.slots
    play = migrated.play
    lore = migrated.lore
    scenes = migrated.scenes
  }

  return {
    ...base,
    version: ROLE_CARD_VERSION,
    slots,
    core: slotsToCore(slots),
    play,
    lore,
    scenes,
    fields: base.fields,
  }
}

/** 截断成一行摘要，用于资料索引。 */
export function summarize(text, max = 30) {
  const value = String(text || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/^#+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!value) return '（空）'
  return value.length > max ? `${value.slice(0, Math.max(1, max - 1))}…` : value
}

/**
 * 渲染将要注入系统提示词的 core 文本。
 *
 * @param role - 角色卡（v5；v4 的 core 会自动升级成 slots）。
 * @param opts - `{ slotSchema?, indexMax?, alwaysBudget? }`。
 * @returns Markdown 文本；未绑定时调用方应传 null。
 */
export function renderCore(role, opts = {}) {
  if (!role) return ''
  const schema = normalizeSlotSchema(opts.slotSchema)
  const slots = hasSlotContent(role.slots) ? normalizeSlots(role.slots) : coreToSlots(role.core)
  const play = role.play || {}
  const indexMax = Number.isFinite(opts.indexMax) ? opts.indexMax : 600
  const alwaysBudget = Number.isFinite(opts.alwaysBudget) ? opts.alwaysBudget : ALWAYS_BODY_BUDGET

  const parts = [`# 当前角色：${role.name}`]
  parts.push('')
  parts.push(`你现在以 ${role.name} 的身份回应。以下设定优先于通用助手身份；与角色无关的任务性寒暄，也按本设定执行。`)
  if (typeof role.system_prompt === 'string' && role.system_prompt.trim()) {
    parts.push('', role.system_prompt.trim())
  }

  const blocks = []
  const known = new Set()
  for (const def of schema) {
    known.add(def.key)
    if (def.hidden) continue
    const text = String(slots[def.key] || '').trim()
    if (!text) continue
    if (def.format === 'list') {
      const rows = text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => `- ${line}`)
      blocks.push(`## ${def.title}\n${rows.join('\n')}`)
    } else {
      blocks.push(`## ${def.title}\n${text}`)
    }
  }
  // schema 未声明的槽位也要渲染，避免数据"存在但不可见"。
  for (const [key, value] of Object.entries(slots)) {
    if (known.has(key)) continue
    const text = String(value || '').trim()
    if (text) blocks.push(`## 其他设定（${key}）\n${text}`)
  }
  if (blocks.length > 0) parts.push('', blocks.join('\n\n'))

  if (play.style?.trim()) parts.push('', `## 扮演方式\n${play.style.trim()}`)
  parts.push('', '场景、时间或关系发生明显变化时，可用 `cosplay_note` 更新「本场提示」（≤100 字）；不要每轮调用。')

  // 常驻条目正文（短内容），受总预算约束；超预算的改为索引行，仍可 recall。
  const entries = [...(role.lore ?? []), ...(role.scenes ?? [])]
  const always = entries.filter((entry) => entry.always && entry.content.trim())
  const skipped = []
  let used = 0
  for (const entry of always) {
    if (used + entry.content.length > alwaysBudget) {
      skipped.push(entry)
      continue
    }
    used += entry.content.length
    parts.push('', `### ${entry.title}\n${entry.content.trim()}`)
  }

  const index = renderIndex(role, { max: indexMax, extra: skipped })
  if (index) parts.push('', index)
  return parts.join('\n')
}

/**
 * 资料索引：让模型知道「有什么」，但不注入正文。
 */
export function renderIndex(role, opts = {}) {
  if (!role) return ''
  const max = Number.isFinite(opts.max) ? opts.max : 600
  const extra = Array.isArray(opts.extra) ? opts.extra : []
  const indexed = [...(role.lore ?? []), ...(role.scenes ?? [])]
    .filter((entry) => !entry.always)
    .concat(extra)
    .sort((a, b) => (b.priority ?? 50) - (a.priority ?? 50))
    .map((entry) => `- \`${entry.id}\` ${entry.title}：${summarize(entry.content)}`)

  if (indexed.length === 0) return ''
  const lines = ['## 资料索引']
  let used = lines[0].length
  let truncated = false
  for (const row of indexed) {
    if (used + row.length + 1 > max) { truncated = true; break }
    lines.push(row)
    used += row.length + 1
  }
  lines.push('（需要正文时调用 cosplay_recall）')
  if (truncated) lines.push('（索引不完整，用 cosplay_index 查看全部）')
  return lines.join('\n')
}

/** 渲染单条条目正文（供 recall / 回退文档使用）。 */
export function renderEntry(entry) {
  if (!entry) return ''
  return `### ${entry.title}\n${String(entry.content || '').trim()}`
}

/** 渲染一轮激活到的条目正文，受字符预算约束。 */
export function renderRecallEntries(entries, max = 800) {
  const list = Array.isArray(entries) ? entries : []
  if (list.length === 0) return ''
  const lines = ['## 本轮相关设定']
  let used = lines[0].length
  for (const entry of list) {
    const block = `\n\n### ${entry.title}\n${String(entry.content || '').trim()}`
    if (used + block.length > max) continue
    lines.push(block)
    used += block.length
  }
  if (lines.length === 1) return ''
  return lines.join('').trim()
}

/** 回退文档（injection: 'context'）：把 v4 卡重新展平成完整档案。 */
export function renderCardDocument(role) {
  if (!role) return ''
  const parts = [`# 角色设定：${role.name}${role.emoji ? ` (${role.emoji})` : ''}`]
  parts.push('')
  parts.push('以下是当前会话扮演角色的设定档案，供你在组织回复时参考与回顾。')
  if (role.system_prompt?.trim()) parts.push('', '## 总体扮演指令', role.system_prompt.trim())

  const slots = hasSlotContent(role.slots) ? normalizeSlots(role.slots) : coreToSlots(role.core)
  const schema = normalizeSlotSchema(undefined)
  const known = new Set()
  for (const def of schema) {
    known.add(def.key)
    if (def.hidden) continue
    const text = String(slots[def.key] || '').trim()
    if (text) parts.push('', `## ${def.title}`, text)
  }
  for (const [key, value] of Object.entries(slots)) {
    if (known.has(key)) continue
    const text = String(value || '').trim()
    if (text) parts.push('', `## 其他设定（${key}）`, text)
  }
  if (role.play?.style?.trim()) parts.push('', '## 扮演方式', role.play.style.trim())
  if (role.play?.examples?.trim()) parts.push('', '## 示例对话', role.play.examples.trim())

  for (const entry of [...(role.lore ?? []), ...(role.scenes ?? [])]) {
    if (!entry.content.trim()) continue
    parts.push('', `## ${entry.title}`, entry.content.trim())
  }
  return parts.join('\n')
}

/** 检索词：NFKC + 小写；英文按词，中文按 bigram（并保留短整词）。 */
export function terms(text) {
  const value = String(text || '').normalize('NFKC').toLowerCase().slice(0, 4000)
  const out = new Set()
  for (const word of value.match(/[\p{L}\p{N}_-]+/gu) ?? []) {
    if (word.length > 1) out.add(word)
  }
  for (const run of value.match(/\p{Script=Han}+/gu) ?? []) {
    if (run.length <= 8) out.add(run)
    for (let i = 0; i < run.length - 1; i++) out.add(run.slice(i, i + 2))
  }
  return [...out].filter((term) => term.length > 1).slice(0, 128)
}

/**
 * 计算一轮激活的条目（确定性，无模型调用）。
 *
 * @param role - v4 角色卡。
 * @param text - 本轮用户消息文本。
 * @param turn - 轮次（用于 sticky / cooldown）。
 * @param rt - 会话运行时 `{ until: Map, cooldownUntil: Map }`。
 * @param opts - `{ maxChars? }`。
 */
export function activate(role, text, turn = 0, rt = {}, opts = {}) {
  if (!role) return []
  const maxChars = Number.isFinite(opts.maxChars) ? opts.maxChars : 800
  const source = String(text || '')
  const q = new Set(terms(source))
  const current = Number.isFinite(turn) ? turn : 0
  const until = rt.until instanceof Map ? rt.until : new Map()
  const cooldownUntil = rt.cooldownUntil instanceof Map ? rt.cooldownUntil : new Map()
  const picked = []

  for (const entry of [...(role.lore ?? []), ...(role.scenes ?? [])]) {
    if (!entry.content.trim()) continue
    if (entry.always) continue
    if ((cooldownUntil.get(entry.id) ?? 0) > current) continue
    if (entry.exclude.some((key) => source.includes(key))) continue

    const hit = entry.keys.some((key) => q.has(key) || source.includes(key))
    const sticky = (until.get(entry.id) ?? 0) > current
    if (!hit && !sticky) continue

    picked.push(entry)
    if (hit) {
      if (entry.cooldown > 0) cooldownUntil.set(entry.id, current + entry.cooldown)
      until.set(entry.id, current + Math.max(1, entry.sticky || 1))
    }
  }

  picked.sort((a, b) => (b.priority ?? 50) - (a.priority ?? 50) || a.content.length - b.content.length)

  const out = []
  let used = 0
  for (const entry of picked) {
    const size = entry.content.length + entry.title.length + 8
    if (used + size > maxChars) continue
    out.push(entry)
    used += size
  }
  return out
}

/**
 * 渲染某会话的运行时上下文文本。
 * @param state - 归一化后的状态。
 * @param sessionId - 目标会话 id。
 * @returns 上下文字符串；不需要扮演时返回空串（内核会跳过空 context）。
 */
export function renderSessionContext(state, sessionId) {
  const role = resolveSessionRole(state, sessionId)
  if (!role) return ''
  const doc = renderRoleDocument(role)
  const directive = THINKING_DIRECTIVES[state.thinkingStyle]
  return directive ? `${doc}\n\n${directive}` : doc
}
