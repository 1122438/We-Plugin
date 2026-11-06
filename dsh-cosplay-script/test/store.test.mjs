/**
 * store.js 单测（零依赖，node --test 跑）。
 * 覆盖：动态字段归一化、旧格式迁移、会话级状态、渲染文档语义。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeState,
  normalizeRole,
  normalizeRoleCard,
  upsertRole,
  removeRole,
  nextId,
  getSessionState,
  setSessionRole,
  setSessionEnabled,
  setSessionNote,
  clearSession,
  resolveSessionRole,
  renderRoleDocument,
  renderSessionContext,
  renderCore,
  renderIndex,
  renderEntry,
  renderRecallEntries,
  activate,
  terms,
  ROLE_CARD_VERSION,
  DEFAULT_ROLES,
  EMPTY_STATE,
} from '../src/store.js'

test('DEFAULT_ROLES: 内置大肥鱼与洁尔佩塔', () => {
  assert.deepEqual(DEFAULT_ROLES.map((role) => role.name), ['蓝色大肥鱼', '洁尔佩塔'])
  const cards = DEFAULT_ROLES.map((role) => normalizeRoleCard(role))
  assert.ok(cards.every(Boolean), '两张默认卡都应通过归一化')
  assert.equal(cards[0].id, 'blue-fat-whale')
  assert.equal(cards[1].id, 'jielpeita')
  assert.match(cards[1].slots.identity, /终末地/)
  assert.equal(cards[1].lore.length, 3)
  assert.equal(cards[1].scenes.length, 2)
})

test('normalizeState: 空输入给出空状态', () => {
  const s = normalizeState(undefined)
  assert.equal(s.enabled, false)
  assert.equal(s.thinkingStyle, 'neutral')
  assert.deepEqual(s.roles, [])
  assert.deepEqual(s.sessionStates, {})
})

test('normalizeRole: 旧格式平铺字段迁移进 fields[]', () => {
  const legacy = {
    id: 'r1',
    name: '测试角色',
    emoji: '🎭',
    description: '身份内容',
    personality: '性格内容',
    style: '语气内容',
    rules: '守则内容',
    behavior: '行为内容',
    scenario: '场景内容',
    first_mes: '开场白',
    mes_example: '示例',
    creator_notes: '备注',
    unknownField: '自定义值',
  }
  const role = normalizeRole(legacy)
  assert.equal(role.name, '测试角色')
  assert.equal(role.emoji, '🎭')
  assert.equal(role.system_prompt, '')
  const labels = role.fields.map((f) => f.label)
  assert.deepEqual(labels, ['身份', '性格', '语气', '守则', '行为', '场景', '开场白', '示例对话', '备注', 'unknownField'])
  assert.equal(role.fields[0].value, '身份内容')
})

test('normalizeRole: 新格式 fields[] 原样保留', () => {
  const role = normalizeRole({
    id: 'r2',
    name: '新角色',
    fields: [
      { key: 'a', label: '身份', value: 'x' },
      { key: 'b', label: '经历背景', value: 'y' },
    ],
  })
  assert.equal(role.fields.length, 2)
  assert.deepEqual(role.fields.map((f) => f.label), ['身份', '经历背景'])
})

test('normalizeRole: 缺 id 或 name 返回 null', () => {
  assert.equal(normalizeRole({ name: 'x' }), null)
  assert.equal(normalizeRole({ id: 'x' }), null)
  assert.equal(normalizeRole(null), null)
})

test('normalizeField: 空 label 且空 value 被丢弃', () => {
  const role = normalizeRole({
    id: 'r3',
    name: 'n',
    fields: [
      { key: 'a', label: '', value: '' },
      { key: 'b', label: '有标签', value: '' },
      { key: 'c', label: '', value: '有内容' },
    ],
  })
  assert.equal(role.fields.length, 2)
  assert.equal(role.fields[0].label, '有标签')
  assert.equal(role.fields[1].label, '未命名字段')
})

test('upsertRole: 新建 + 更新', () => {
  let s = { ...EMPTY_STATE, roles: [] }
  s = upsertRole(s, { name: '角色A', fields: [{ key: 'k', label: '身份', value: 'v' }] })
  assert.equal(s.roles.length, 1)
  const id = s.roles[0].id
  s = upsertRole(s, { id, name: '角色A改名', fields: [] })
  assert.equal(s.roles.length, 1)
  assert.equal(s.roles[0].name, '角色A改名')
  assert.deepEqual(s.roles[0].fields, [])
})

test('upsertRole: 空名字抛错', () => {
  assert.throws(() => upsertRole(EMPTY_STATE, { name: '   ' }), /角色名不能为空/)
})

test('removeRole: 清理指向它的会话绑定', () => {
  let s = { ...EMPTY_STATE, roles: [] }
  s = upsertRole(s, { name: 'R' })
  const id = s.roles[0].id
  s = setSessionRole(s, 'session-x', id)
  s = setSessionEnabled(s, 'session-x', true)
  assert.equal(getSessionState(s, 'session-x').roleId, id)
  s = removeRole(s, id)
  assert.equal(s.roles.length, 0)
  assert.equal(getSessionState(s, 'session-x').roleId, null)
})

test('会话级状态：默认关闭无角色', () => {
  const st = getSessionState(EMPTY_STATE, 'session-a')
  assert.deepEqual(st, { roleId: null, enabled: false })
})

test('会话级状态：设置角色 / 开启 / 清除', () => {
  let s = { ...EMPTY_STATE, roles: [] }
  s = upsertRole(s, { name: 'R' })
  const id = s.roles[0].id
  s = setSessionRole(s, 'session-a', id)
  assert.equal(resolveSessionRole(s, 'session-a'), null, '总开关关闭时不应解析出角色')
  s = { ...s, enabled: true }
  assert.equal(resolveSessionRole(s, 'session-a'), null, '会话未开启时不应解析出角色')
  s = setSessionEnabled(s, 'session-a', true)
  assert.equal(resolveSessionRole(s, 'session-a')?.id, id)
  s = clearSession(s, 'session-a')
  assert.deepEqual(getSessionState(s, 'session-a'), { roleId: null, enabled: false })
})

test('会话级状态：不同会话互相隔离', () => {
  let s = { ...EMPTY_STATE, roles: [], enabled: true }
  s = upsertRole(s, { name: 'A' })
  s = upsertRole(s, { name: 'B' })
  const [a, b] = s.roles.map((r) => r.id)
  s = setSessionRole(s, 'session-1', a)
  s = setSessionEnabled(s, 'session-1', true)
  s = setSessionRole(s, 'session-2', b)
  s = setSessionEnabled(s, 'session-2', true)
  assert.equal(resolveSessionRole(s, 'session-1').name, 'A')
  assert.equal(resolveSessionRole(s, 'session-2').name, 'B')
  assert.equal(resolveSessionRole(s, 'session-3'), null)
})

test('setSessionRole: 不存在的角色抛错', () => {
  assert.throws(() => setSessionRole(EMPTY_STATE, 'session-a', 'nope'), /角色不存在/)
})

test('normalizeSessionStates: 过滤指向不存在角色的绑定', () => {
  const s = normalizeState({
    enabled: true,
    roles: [{ id: 'r1', name: 'R' }],
    sessionStates: {
      'session-1': { roleId: 'r1', enabled: true },
      'session-2': { roleId: 'ghost', enabled: true },
      'session-3': { roleId: 'r1', enabled: false },
    },
  })
  assert.equal(s.sessionStates['session-1'].roleId, 'r1')
  assert.equal(s.sessionStates['session-2'].roleId, null, '幽灵角色应被清空')
  assert.equal(s.sessionStates['session-3'].enabled, false)
})

test('renderRoleDocument: 渲染成 Markdown 档案，不是指令', () => {
  const role = normalizeRole({
    id: 'r',
    name: '庄方宜',
    emoji: '🌸',
    system_prompt: '',
    fields: [
      { key: 'a', label: '身份', value: '武陵科学发展区管代' },
      { key: 'b', label: '经历背景', value: '儿时父母离世，由叔叔抚养' },
    ],
  })
  const doc = renderRoleDocument(role)
  assert.match(doc, /^# 角色设定：庄方宜 \(🌸\)/)
  assert.match(doc, /## 身份\n武陵科学发展区管代/)
  assert.match(doc, /## 经历背景\n儿时父母离世/)
  assert.doesNotMatch(doc, /你正在扮演/, '不应再出现指令式措辞')
  assert.doesNotMatch(doc, /始终保持角色设定与口吻/, '不应再出现旧的强制指令尾巴')
})

test('renderRoleDocument: 空字段值被跳过', () => {
  const role = normalizeRole({
    id: 'r', name: 'N',
    fields: [
      { key: 'a', label: '有内容', value: 'v' },
      { key: 'b', label: '空内容', value: '   ' },
    ],
  })
  const doc = renderRoleDocument(role)
  assert.match(doc, /## 有内容/)
  assert.doesNotMatch(doc, /## 空内容/)
})

test('renderSessionContext: 未绑定返回空串', () => {
  const s = { ...EMPTY_STATE, enabled: true }
  assert.equal(renderSessionContext(s, 'session-none'), '')
})

test('renderSessionContext: 绑定后返回文档', () => {
  let s = { ...EMPTY_STATE, roles: [], enabled: true }
  s = upsertRole(s, { name: 'R', fields: [{ key: 'k', label: '身份', value: 'V' }] })
  const id = s.roles[0].id
  s = setSessionRole(s, 'session-a', id)
  s = setSessionEnabled(s, 'session-a', true)
  const ctx = renderSessionContext(s, 'session-a')
  assert.match(ctx, /# 角色设定：R/)
  assert.match(ctx, /## 身份\nV/)
})

test('renderSessionContext: 角色化思考追加指令', () => {
  let s = { ...EMPTY_STATE, roles: [], enabled: true, thinkingStyle: 'role' }
  s = upsertRole(s, { name: 'R', fields: [] })
  const id = s.roles[0].id
  s = setSessionRole(s, 'session-a', id)
  s = setSessionEnabled(s, 'session-a', true)
  assert.match(renderSessionContext(s, 'session-a'), /角色沉浸要求/)
})

test('DEFAULT_ROLES 结构合法', () => {
  const role = normalizeRole(DEFAULT_ROLES[0])
  assert.equal(role.id, 'blue-fat-whale')
  assert.ok(role.fields.length > 0)
})

test('nextId: 中文名退化为 role- 前缀（不产生纯数字 id）', () => {
  const a = nextId({ roles: [] }, '庄方宜')
  const b = nextId({ roles: [] }, '庄方宜')
  assert.notEqual(a, b, '两次应生成不同 id')
  assert.match(a, /^role-/, '中文名应退化为 role- 前缀')
  assert.doesNotMatch(a, /^\d+$/, '不应是纯数字')
})

test('nextId: 可读 slug 直接复用', () => {
  const id = nextId({ roles: [] }, 'Alice Wonderland')
  assert.equal(id, 'alice-wonderland', '可读的英文名应生成 slug')
})

test('nextId: 中文名+数字不产生纯数字 id', () => {
  const id = nextId({ roles: [] }, '隔离测试2')
  assert.doesNotMatch(id, /^\d+$/, `不应是纯数字（实际 ${id}）`)
  assert.match(id, /^role-/, '应退化为 role- 前缀')
})

test('会话 id 校验：空值/非字符串应抛错', () => {
  const s = { ...EMPTY_STATE, roles: [] }
  assert.throws(() => setSessionRole(s, '', null), /会话 id 无效/)
  assert.throws(() => setSessionRole(s, '   ', null), /会话 id 无效/)
  assert.throws(() => setSessionRole(s, undefined, null), /会话 id 无效/)
  assert.throws(() => setSessionRole(s, 123, null), /会话 id 无效/)
  assert.throws(() => setSessionEnabled(s, '', true), /会话 id 无效/)
  assert.throws(() => clearSession(s, ''), /会话 id 无效/)
})

test('getSessionState: 非法 id 安全返回默认值（不抛错）', () => {
  const s = { ...EMPTY_STATE, roles: [] }
  assert.deepEqual(getSessionState(s, ''), { roleId: null, enabled: false })
  assert.deepEqual(getSessionState(s, undefined), { roleId: null, enabled: false })
})

test('特殊字符 sessionId 可正常存取', () => {
  let s = { ...EMPTY_STATE, roles: [] }
  s = upsertRole(s, { name: 'R' })
  const rid = s.roles[0].id
  const weird = 'session:with space#hash{brace}'
  s = setSessionRole(s, weird, rid)
  s = setSessionEnabled(s, weird, true)
  assert.equal(s.sessionStates[weird].roleId, rid)
  s = clearSession(s, weird)
  assert.equal(s.sessionStates[weird], undefined)
})

// ── v4：分层卡 / 迁移 / 渲染 / 召回 ─────────────────────────────────────────

/** 把一张卡里所有可见文本拼起来，用于"内容不丢"断言。 */
function allCardText(role) {
  return [
    ...Object.values(role.slots ?? {}),
    role.core?.identity, role.core?.personality, role.core?.voice,
    ...(role.core?.rules ?? []),
    role.play?.style, role.play?.examples,
    ...(role.lore ?? []).map((e) => e.content),
    ...(role.scenes ?? []).map((e) => e.content),
  ].filter(Boolean).join('\n')
}

test('v4 迁移：v3 字段进入 core / 条目，内容不丢', () => {
  const fields = [
    { key: 'a', label: '身份', value: '身份内容' },
    { key: 'b', label: '性格', value: '性格内容' },
    { key: 'c', label: '语气', value: '语气内容' },
    { key: 'd', label: '守则', value: '称主人；不许说她胖' },
    { key: 'e', label: '行为', value: '尾巴会摇' },
    { key: 'f', label: '场景', value: '日常陪伴' },
  ]
  const role = normalizeRoleCard({ id: 'r', name: 'R', fields })
  assert.equal(role.version, ROLE_CARD_VERSION)
  assert.equal(role.core.identity, '身份内容')
  assert.equal(role.core.personality, '性格内容')
  assert.equal(role.core.voice, '语气内容')
  assert.deepEqual(role.core.rules, ['称主人', '不许说她胖'])
  assert.equal(role.slots.behavior, '尾巴会摇', '行为应进入 behavior 槽位')
  assert.match(role.slots.rules, /称主人/)
  assert.ok(role.scenes.some((e) => e.content === '日常陪伴' && e.always), '短场景应常驻')
  const text = allCardText(role)
  for (const field of fields) {
    const parts = String(field.value).split(/[；;。\n]+/).filter(Boolean)
    for (const part of parts) assert.ok(text.includes(part), `迁移后应保留「${field.label}」的「${part}」`)
  }
})

test('v4 迁移：长字段进按需条目，不进核心正文', () => {
  const long = '长'.repeat(1000)
  const role = normalizeRoleCard({
    id: 'r', name: 'R',
    fields: [{ key: 'scene', label: '长场景', value: long }],
  })
  assert.equal(role.scenes.length, 1)
  assert.equal(role.scenes[0].always, false, '长内容不应常驻')
  const core = renderCore(role)
  assert.doesNotMatch(core, /长{100}/, '核心正文不应包含长条目')
  assert.match(core, /资料索引/)
  assert.match(core, /长场景/)
  assert.match(renderEntry(role.scenes[0]), /长{10}/, 'recall 应能取回全文')
})

test('v4 迁移：旧平铺格式也走同一路径', () => {
  const role = normalizeRoleCard({
    id: 'r', name: 'R',
    description: '来自 description',
    personality: '来自 personality',
    scenario: '来自 scenario',
  })
  assert.equal(role.core.identity, '来自 description')
  assert.ok(role.scenes.some((e) => e.content === '来自 scenario'))
})

test('renderCore: 指令头 / 核心 / 索引，且索引不含常驻条目', () => {
  const role = normalizeRoleCard({
    id: 'r', name: '测试角色',
    core: { identity: '示例身份', personality: '冷静', voice: '自称"我"', rules: ['不许出戏'] },
    play: { style: '优先描写场景' },
    lore: [
      { id: 'lore-a', title: '老农场', content: '一座农场', priority: 80 },
      { id: 'lore-b', title: '常驻小事', content: '喜欢热饮', always: true },
    ],
  })
  const core = renderCore(role)
  assert.match(core, /^# 当前角色：测试角色/)
  assert.match(core, /你现在以 测试角色 的身份回应/)
  assert.match(core, /## 身份与背景\n示例身份/)
  assert.match(core, /## 扮演方式\n优先描写场景/)
  assert.match(core, /老农场/)
  assert.match(core, /喜欢热饮/, '常驻条目正文应出现')
  const index = renderIndex(role)
  assert.match(index, /lore-a/)
  assert.doesNotMatch(index, /lore-b/, '常驻条目不应重复进索引')
})

test('renderCore: 常驻正文超预算时转入索引，仍可 recall', () => {
  const fields = Array.from({ length: 5 }, (_, i) => ({
    key: `s${i}`, label: `补充${i}`, value: 'x'.repeat(300),
  }))
  const role = normalizeRoleCard({ id: 'r', name: 'R', fields })
  const core = renderCore(role, { alwaysBudget: 600 })
  // 600 预算只放得下 2 条（每条 300 字），其余进索引
  assert.match(core, /资料索引/)
  assert.match(core, /补充4/)
  assert.ok(renderEntry(role.lore.find((e) => e.title === '补充4')).includes('x'.repeat(10)))
})

test('v5 槽位：意识 / 用户档案 进入固定槽位，标题来自 schema', () => {
  const role = normalizeRoleCard({
    id: 'r', name: 'R',
    fields: [
      { key: 'a', label: '身份简介', value: '身份内容' },
      { key: 'b', label: '意识', value: '内心独白' },
      { key: 'c', label: '用户档案', value: '主人喜欢米饭' },
      { key: 'd', label: '长场景', value: '长'.repeat(1000) },
    ],
  })
  assert.equal(role.slots.identity, '身份内容')
  assert.equal(role.slots.consciousness, '内心独白')
  assert.equal(role.slots.userProfile, '主人喜欢米饭')
  assert.equal(role.scenes.length, 1, '长场景仍进按需条目')

  const schema = [
    { key: 'identity', title: '身份简介', maxChars: 800, format: 'text' },
    { key: 'consciousness', title: '意识', maxChars: 600, format: 'text' },
    { key: 'userProfile', title: '用户档案', maxChars: 400, format: 'text' },
    { key: 'rules', title: '守则', maxChars: 400, format: 'list' },
  ]
  const core = renderCore(role, { slotSchema: schema })
  assert.match(core, /## 身份简介\n身份内容/)
  assert.match(core, /## 意识\n内心独白/)
  assert.match(core, /## 用户档案\n主人喜欢米饭/)
  assert.doesNotMatch(core, /## 身份与背景/, '标题应使用调用方 schema')
})

test('v5 兼容：旧 UI 只提交 core 时不丢 consciousness/userProfile', () => {
  let s = { ...EMPTY_STATE, roles: [] }
  s = upsertRole(s, {
    name: 'R',
    slots: { identity: 'I', consciousness: 'C', userProfile: 'U' },
  })
  const id = s.roles[0].id
  s = upsertRole(s, {
    id,
    name: 'R',
    core: { identity: 'I2', personality: '', voice: '', rules: [] },
    lore: [],
    scenes: [],
  })
  assert.equal(s.roles[0].slots.identity, 'I2')
  assert.equal(s.roles[0].slots.consciousness, 'C', '未出现在旧 UI 的槽位应保留')
  assert.equal(s.roles[0].slots.userProfile, 'U')
})

test('v5：slotsEdited 允许清空槽位', () => {
  let s = { ...EMPTY_STATE, roles: [] }
  s = upsertRole(s, { name: 'R', slots: { identity: 'I', consciousness: 'C' } })
  const id = s.roles[0].id
  s = upsertRole(s, {
    id,
    name: 'R',
    slots: { identity: '' },
    slotsEdited: true,
    play: { style: '', examples: '' },
    lore: [],
    scenes: [],
  })
  assert.equal(s.roles[0].slots.identity, undefined, '清空后不应残留旧内容')
  assert.equal(s.roles[0].slots.consciousness, undefined, '客户端提交完整 slots 时，未出现的键应清空')
})

test('sessionNotes: 设置 / 清除 / 解绑保留', () => {
  let s = { ...EMPTY_STATE, roles: [] }
  s = setSessionNote(s, 'session-a', '  雨夜，门没锁  ')
  assert.equal(s.sessionNotes['session-a'], '雨夜，门没锁')
  s = clearSession(s, 'session-a')
  assert.equal(s.sessionNotes['session-a'], '雨夜，门没锁', '解绑不应删除本场提示')
  s = setSessionNote(s, 'session-a', '')
  assert.equal(s.sessionNotes['session-a'], undefined, '空串应清除')
  const long = 'x'.repeat(300)
  s = setSessionNote(s, 'session-b', long)
  assert.equal(s.sessionNotes['session-b'].length, 200, '应截断到 200 字')
})

test('normalizeState: 本场提示装载时同样截断到 200', () => {
  const s = normalizeState({ sessionNotes: { s1: 'x'.repeat(300) } })
  assert.equal(s.sessionNotes.s1.length, 200)
})

test('v5: 只有 play.note 的卡不会被迁移丢掉', () => {
  const role = normalizeRoleCard({ id: 'r', name: 'R', play: { note: '保持第一人称' } })
  assert.equal(role.play.note, '保持第一人称')
})

test('条目 id 重复时自动去重（保留两条内容）', () => {
  const role = normalizeRoleCard({
    id: 'r', name: 'R',
    lore: [
      { id: 'dup', title: 'A', content: '一' },
      { id: 'dup', title: 'B', content: '二' },
    ],
  })
  assert.deepEqual(role.lore.map((e) => e.id), ['dup', 'dup-2'])
  assert.equal(role.lore[0].content, '一')
  assert.equal(role.lore[1].content, '二')
})

test('条目 id 在 lore / scenes 之间也不重复', () => {
  const role = normalizeRoleCard({
    id: 'r', name: 'R',
    lore: [{ id: 'dup', title: 'L', content: '设定' }],
    scenes: [{ id: 'dup', title: 'S', content: '场景' }],
  })
  const ids = [...role.lore, ...role.scenes].map((e) => e.id)
  assert.equal(new Set(ids).size, 2, '跨数组也应唯一')
  assert.deepEqual(ids, ['dup', 'dup-2'])
})

test('terms: 中文按 bigram，英文按词', () => {
  const list = terms('我们去海边看海 Alice')
  assert.ok(list.includes('海边'))
  assert.ok(list.includes('看海'))
  assert.ok(list.includes('alice'))
})

test('activate: 关键词 / 排除词 / sticky / cooldown', () => {
  const role = normalizeRoleCard({
    id: 'r', name: 'R',
    lore: [
      { id: 'sea', title: '海边', keys: ['海边'], content: '海风', priority: 60, sticky: 2 },
      { id: 'fight', title: '战斗', keys: ['战斗'], exclude: ['和平'], content: '刀光', priority: 90, cooldown: 2 },
    ],
  })

  const rt = { until: new Map(), cooldownUntil: new Map() }
  assert.deepEqual(activate(role, '我们去海边', 1, rt).map((e) => e.id), ['sea'])
  assert.deepEqual(activate(role, '继续', 2, rt).map((e) => e.id), ['sea'], 'sticky 第 1 轮保持')
  assert.deepEqual(activate(role, '继续', 3, rt).map((e) => e.id), ['sea'], 'sticky 第 2 轮保持')
  assert.deepEqual(activate(role, '继续', 4, rt).map((e) => e.id), [], 'sticky 应过期')

  const rt2 = { until: new Map(), cooldownUntil: new Map() }
  assert.deepEqual(activate(role, '战斗开始', 1, rt2).map((e) => e.id), ['fight'])
  assert.deepEqual(activate(role, '战斗继续', 2, rt2).map((e) => e.id), [], 'cooldown 内不应重复')
  assert.deepEqual(activate(role, '战斗继续', 3, rt2).map((e) => e.id), ['fight'])

  assert.deepEqual(activate(role, '和平的战斗', 5, rt2).map((e) => e.id), [], '排除词应生效')
})

test('activate: 英文触发词大小写不敏感；sticky: 0 不额外保持', () => {
  const role = normalizeRoleCard({
    id: 'r', name: 'R',
    lore: [
      { id: 'api', title: 'API', keys: ['API'], content: '接口说明' },
      { id: 'zero', title: '零', keys: ['零'], content: '不延续', sticky: 0 },
    ],
  })
  const rt = { until: new Map(), cooldownUntil: new Map() }
  assert.deepEqual(activate(role, 'api 怎么用', 1, rt).map((e) => e.id), ['api'], '大写入参应命中小写 key')
  assert.deepEqual(activate(role, '零', 2, rt).map((e) => e.id), ['zero'])
  assert.deepEqual(activate(role, '继续', 3, rt).map((e) => e.id), [], 'sticky 0 不应延续')
})

test('activate: 优先级 + 预算', () => {
  const role = normalizeRoleCard({
    id: 'r', name: 'R',
    lore: [
      { id: 'low', title: '低', keys: ['触发'], content: 'a'.repeat(400), priority: 10 },
      { id: 'high', title: '高', keys: ['触发'], content: 'b'.repeat(400), priority: 90 },
    ],
  })
  const got = activate(role, '触发', 1, { until: new Map(), cooldownUntil: new Map() }, { maxChars: 450 })
  assert.deepEqual(got.map((e) => e.id), ['high'], '预算只够一条时优先高优先级')
})

test('v4 迁移：schema 注入的空 core/play 不应阻止 fields 迁移', () => {
  // 内核 Config 会给 v3 卡补默认值 core:{} / play:{} / lore:[] / scenes:[]；
  // 这些空对象不能被当成"已经是 v4"，否则卡片内容会看起来消失。
  const role = normalizeRoleCard({
    id: 'r',
    name: 'R',
    version: 4,
    core: { identity: '', personality: '', voice: '', rules: [] },
    play: { style: '', examples: '' },
    lore: [],
    scenes: [],
    fields: [
      { key: 'a', label: '身份', value: '身份内容' },
      { key: 'b', label: '场景', value: '场景内容' },
    ],
  })
  assert.equal(role.core.identity, '身份内容')
  assert.ok(role.scenes.some((entry) => entry.content === '场景内容'))
})

test('upsertRole: v4 结构不被旧客户端的 fields 冲掉', () => {
  let s = { ...EMPTY_STATE, roles: [] }
  s = upsertRole(s, {
    name: 'R',
    core: { identity: 'v4 身份' },
    lore: [{ id: 'e1', title: 'T', content: 'C' }],
  })
  const id = s.roles[0].id
  s = upsertRole(s, { id, name: 'R2', fields: [{ key: 'k', label: '身份', value: '旧字段' }] })
  assert.equal(s.roles[0].name, 'R2')
  assert.equal(s.roles[0].core.identity, 'v4 身份', 'v4 核心应保留')
  assert.equal(s.roles[0].lore.length, 1)
})

test('renderRecallEntries: 超出预算的条目不注入', () => {
  const entries = [
    { id: 'a', title: 'A', content: 'a'.repeat(500) },
    { id: 'b', title: 'B', content: 'b'.repeat(500) },
  ]
  const text = renderRecallEntries(entries, 520)
  assert.match(text, /### A/)
  assert.doesNotMatch(text, /### B/)
})
