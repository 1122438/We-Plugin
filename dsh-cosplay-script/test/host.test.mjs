/**
 * 主机侧集成测试（零外部依赖，无需真实 DSH）。
 *
 * 用最小 stub ctx 加载 `src/index.js` 的 `apply()`，验证：
 *   - 注册 1 个 system prompt section（core）+ 1 个运行时 context（recall）
 *   - 会话级隔离（不同 sessionId 取到不同角色）
 *   - 总开关 / 会话开关的联动
 *   - 服务通过 reflect.provide 注册（Gateway 能发现的前提）
 *   - 10 个 Remote 端点已标记
 *   - **并发写入不丢失更新**（串行写队列）
 *   - 会话 id 校验
 *
 * 运行：node test/host.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_DIR = join(HERE, '..', 'src')

// ── 构造 stub ctx ────────────────────────────────────────────────────────────
const registered = { sections: [], contexts: [], tools: [], services: [] }
const reflectProps = {}
const services = new Map()

const reflect = {
  props: reflectProps,
  provide(name, value) {
    reflectProps[name] = { type: 'service' }
    services.set(name, value)
    return async () => { delete reflectProps[name]; services.delete(name) }
  },
}

/** 写盘记录（用于验证并发与序列化）。 */
const writes = []

const baseCtx = {
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
  inject: (_deps, cb) => cb({
    effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
    settings: { configure: () => () => {} },
  }),
  systemPrompt: {
    context: (entry) => { registered.contexts.push(entry); return () => {} },
    section: (entry) => { registered.sections.push(entry); return () => {} },
  },
  on: () => () => {},
  tools: { register: (t) => { registered.tools.push(t); return () => {} } },
  typert: { register: () => () => {} },
  settings: { update: async () => { throw new Error('No configurable plugin entry') } },
  reflect,
  get: (k) => services.get(k),
  fiber: {},
  // 仅测试用：把写盘替换成可观测的内存操作
  __test: {
    applyConfigPatch(patch) {
      writes.push(JSON.parse(JSON.stringify(patch)))
    },
  },
}

const config = {
  enabled: true,
  thinkingStyle: 'neutral',
  roles: [
    { id: 'role-a', name: '角色A', system_prompt: '', fields: [{ key: 'f1', label: '身份', value: 'A 的身份' }] },
    { id: 'role-b', name: '角色B', system_prompt: '', fields: [{ key: 'f2', label: '身份', value: 'B 的身份' }] },
  ],
  sessionStates: {
    'session-A': { roleId: 'role-a', enabled: true },
    'session-B': { roleId: 'role-b', enabled: true },
  },
}

const mod = await import(`file:///${SRC_DIR.replace(/\\/g, '/')}/index.js`)
mod.apply(baseCtx, config)

// ── 1. 注册形态 ──────────────────────────────────────────────────────────────
assert.equal(registered.sections.length, 1, '应注册恰好 1 个 system prompt section')
assert.equal(registered.sections[0].name, 'cosplay:core')
assert.equal(registered.sections[0].order, 5)
assert.equal(registered.sections[0].interpolate, false, '用户内容必须关闭插值')
assert.equal(typeof registered.sections[0].text, 'function', 'text 必须是函数（按会话求值）')
assert.equal(registered.contexts.length, 1, '应注册恰好 1 个运行时 context（召回）')
assert.equal(registered.contexts[0].name, 'cosplay:recall')
assert.equal(registered.contexts[0].interpolate, false)
assert.equal(registered.tools.length, 8, '应注册 8 个工具')

// ── 2. 会话级隔离 ────────────────────────────────────────────────────────────
const textOf = registered.sections[0].text
assert.match(textOf({ scope: { id: 'session-A' } }), /# 当前角色：角色A/)
assert.match(textOf({ scope: { id: 'session-B' } }), /# 当前角色：角色B/)
assert.equal(textOf({ scope: { id: 'session-unknown' } }), '', '未绑定会话应返回空串')
assert.equal(textOf({}), '', '无 scope 应安全返回空串')
assert.equal(textOf(undefined), '', 'undefined context 应安全返回空串')

// ── 3. 服务注册（Gateway 发现的前提）─────────────────────────────────────────
assert.ok(reflectProps.cosplay, '应通过 reflect.provide 注册 cosplay')
assert.equal(reflectProps.cosplay.type, 'service')
const svc = services.get('cosplay')
assert.ok(svc, 'ctx.get("cosplay") 应能取到实例')
assert.equal(svc.typertRemote?.namespace, 'cosplay')
assert.equal(svc.typertRemote?.service, svc, 'binding.service 必须是实例本身')

// ── 4. 13 个 Remote 端点 ────────────────────────────────────────────────────
const MARKERS = '@deepseek-ai/dsh-typert-protocol/remote-methods'
const marked = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(svc), MARKERS)?.value?.methods ?? []
const methods = marked.map((m) => m.method).sort()
assert.deepEqual(methods, [
  'bindSession', 'clearSession', 'getState', 'listSessions', 'preview', 'removeRole',
  'setEnabled', 'setSessionEnabled', 'setSessionNote', 'setSessionRole', 'setSlotSchema', 'setThinkingStyle', 'upsertRole',
])

// ── 5. 并发写入不丢更新 ─────────────────────────────────────────────────────
const sids = ['c1', 'c2', 'c3', 'c4', 'c5']
await Promise.all(sids.map((sid) => svc.bindSession(sid, 'role-a', true)))
const after = svc.getState()
for (const sid of sids) {
  assert.ok(after.sessionStates[sid], `并发绑定 ${sid} 不应丢失`)
  assert.equal(after.sessionStates[sid].enabled, true)
}
assert.ok(after.sessionStates['session-A'], '原有绑定应保留')

// ── 6. 会话 id 校验 ────────────────────────────────────────────────────────
await assert.rejects(() => svc.bindSession('', 'role-a', true), /会话 id 无效/)
await assert.rejects(() => svc.clearSession(''), /会话 id 无效/)

// ── 7. 总开关关闭时不注入 ──────────────────────────────────────────────────
await svc.setEnabled(false)
assert.equal(textOf({ scope: { id: 'session-A' } }), '', '总开关关闭应停止注入')
await svc.setEnabled(true)

// ── 8. 会话开关关闭时不注入，且不影响其它会话 ──────────────────────────────
await svc.bindSession('session-A', 'role-a', false)
assert.equal(textOf({ scope: { id: 'session-A' } }), '', '会话关闭应返回空串')
assert.match(textOf({ scope: { id: 'session-B' } }), /# 当前角色：角色B/, '其它会话不受影响')

// ── 9. 角色 CRUD ───────────────────────────────────────────────────────────
const created = await svc.upsertRole({ name: '新角色', system_prompt: '', fields: [{ key: 'k', label: '身份', value: 'V' }] })
const newRole = created.roles.find((r) => r.name === '新角色')
assert.ok(newRole, '应创建新角色')
assert.ok(newRole.fields.some((f) => f.label === '身份'))
assert.equal(newRole.core.identity, 'V', 'v3 字段应迁移进 core')

// ── 9.5 槽位 schema 与预览 ────────────────────────────────────────────────
const withSchema = await svc.setSlotSchema([
  { key: 'identity', title: '身份简介', maxChars: 800, format: 'text' },
  { key: 'voice', title: '语气', maxChars: 400, format: 'text', hidden: true },
])
assert.equal(withSchema.slotSchema[0].title, '身份简介')
assert.equal(withSchema.slotSchema[1].hidden, true)
const preview = await svc.preview('role-a', 'A 的身份')
assert.equal(typeof preview.core, 'string')
assert.ok(preview.core.includes('# 当前角色：角色A'))
assert.equal(typeof preview.coreChars, 'number')

// ── 9.6 本场提示（session note）─────────────────────────────────────────────
const noted = await svc.setSessionNote('session-B', '雨夜，门没锁')
assert.equal(noted.sessionNotes['session-B'], '雨夜，门没锁')
const clearedNote = await svc.setSessionNote('session-B', '')
assert.equal(clearedNote.sessionNotes['session-B'], undefined, '空串应清除本场提示')

// ── 10. 客户端/主机 Remote 方法必须对齐（否则 404）──────────────────────────
const clientSrc = readFileSync(join(SRC_DIR, 'client.js'), 'utf8')
const hostSrc = readFileSync(join(SRC_DIR, 'index.js'), 'utf8')
const idRe = /id: '([^']+#cosplay\/[A-Za-z]+)'/g
const hostIds = [...new Set([...hostSrc.matchAll(idRe)].map((m) => m[1]))].sort()
const clientIds = [...new Set([...clientSrc.matchAll(idRe)].map((m) => m[1]))].sort()
assert.deepEqual(clientIds, hostIds, '客户端与主机的 Remote invocation id 必须完全一致')

// ── 11. client 的 __ModuleLoader__ id 必须等于包名 ──────────────────────────
const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'))
assert.ok(clientSrc.includes(`id: '${pkg.name}'`), 'client.js 的 module id 必须等于包名')

// ── 12. 状态文件编解码（v4.1 JSON 持久化）──────────────────────────────────
const sampleState = {
  enabled: true,
  thinkingStyle: 'role',
  roles: [{
    id: 'r1',
    name: 'R',
    core: { identity: 'I', personality: '', voice: '', rules: [] },
    play: { style: '', examples: '' },
    lore: [{ id: 'e1', title: 'T', keys: ['k'], content: 'C' }],
    scenes: [],
  }],
  sessionStates: { 'session-a': { roleId: 'r1', enabled: true } },
  sessionNotes: { 'session-a': '雨夜，门没锁' },
}
const parsedState = mod.parseStateFile(mod.serializeStateFile(sampleState))
assert.equal(parsedState.enabled, true)
assert.equal(parsedState.thinkingStyle, 'role')
assert.equal(parsedState.roles[0].name, 'R')
assert.equal(parsedState.roles[0].core.identity, 'I')
assert.ok(Array.isArray(parsedState.slotSchema) && parsedState.slotSchema.length >= 5, '应带默认槽位 schema')
assert.equal(parsedState.roles[0].lore[0].keys[0], 'k')
assert.equal(parsedState.sessionStates['session-a'].enabled, true)
assert.equal(parsedState.sessionNotes['session-a'], '雨夜，门没锁')
const serializedWithFields = JSON.parse(mod.serializeStateFile({
  ...sampleState,
  roles: [{ ...sampleState.roles[0], fields: [{ key: 'f', label: '身份', value: 'I' }] }],
}))
assert.equal(serializedWithFields.roles[0].fields, undefined, '落盘不应再保存 fields（与 slots/entries 重复）')
// YAML 序列化的边界：会话 id 含 `:`/`#`、数组项首键为空对象/空数组。
const yamlLines = mod.serializeConfig({
  sessionStates: { 'a:b': { roleId: 'r' }, 'x#y': { roleId: 'r' } },
  roles: [{ meta: {}, list: [], name: 'x' }],
})
assert.ok(yamlLines.some((line) => line.includes('"a:b":')), '含冒号的键必须加引号')
assert.ok(yamlLines.some((line) => line.includes('"x#y":')), '含 # 的键必须加引号')
assert.ok(yamlLines.some((line) => line.includes('- meta: {}')), '数组项首键空对象应写成一行')
assert.ok(yamlLines.some((line) => line.includes('list: []')), '空数组应写成一行')
assert.equal(yamlLines.some((line) => line.trim() === '{}'), false, '不应出现裸 {} 行')
// patch 回读校验：不只看 id 行，还要看整块与缩进。
const goodBlock = [
  '- id: cosplay-core',
  '  name: dsh-cosplay-script',
  '  config:',
  '    enabled: true',
  '    roles: []',
]
assert.equal(mod.validatePatchBlock(goodBlock.join('\n'), goodBlock), true)
assert.equal(mod.validatePatchBlock(goodBlock.join('\n').replace('    enabled: true', '  enabled: true'), goodBlock), false, '缩进坏了应失败')
assert.equal(mod.validatePatchBlock(goodBlock.slice(0, 1).join('\n'), goodBlock), false, '只剩 id 行应失败')
assert.equal(mod.parseStateFile('not json'), undefined, '坏文件应安全返回 undefined')

console.log('✓ 主机侧集成测试全部通过')
console.log(`  section: ${registered.sections.length} 个 | context: ${registered.contexts.length} 个 | tools: ${registered.tools.length} 个 | Remote 端点: ${methods.length} 个`)
console.log(`  并发写入: ${sids.length}/5 全部保留 | 写盘次数: ${writes.length}`)
