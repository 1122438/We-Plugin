/**
 * 客户端渲染冒烟测试（无需浏览器）。
 *
 * 目的：捕获「factory return 之后的 const 未初始化」这类只在运行期才炸的问题。
 * 做法：用最小 React 桩 + fake ctx 调用 apply()，拿到 settings.section 的渲染函数，
 * 直接执行组件函数，确认它返回一棵 div 树而不是抛异常。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT = join(HERE, '..', 'src', 'client.js')

test('client: 设置页 section 能渲染（无 TDZ / 空返回）', async () => {
  let captured
  globalThis.window = { __ModuleLoader__: { load: (def) => { captured = def } } }

  const hooks = { list: [], index: 0 }
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: (init) => {
      const index = hooks.index++
      if (!(index in hooks.list)) hooks.list[index] = typeof init === 'function' ? init() : init
      return [hooks.list[index], (value) => {
        hooks.list[index] = typeof value === 'function' ? value(hooks.list[index]) : value
      }]
    },
    useCallback: (fn) => fn,
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }

  const state = {
    enabled: true,
    thinkingStyle: 'neutral',
    slotSchema: [
      { key: 'identity', title: '身份简介', maxChars: 800, format: 'text' },
      { key: 'consciousness', title: '意识', maxChars: 600, format: 'text' },
      { key: 'rules', title: '守则', maxChars: 400, format: 'list' },
    ],
    roles: [{
      id: 'r1',
      name: 'R',
      version: 5,
      slots: { identity: 'I' },
      core: { identity: 'I', personality: '', voice: '', rules: [] },
      play: { style: '', examples: '' },
      lore: [],
      scenes: [],
    }],
    sessionStates: {},
  }

  let sectionRender = null
  const remote = {
    getState: async () => ({ ok: true, value: state }),
    listSessions: async () => ({ ok: true, value: { ok: true, sessions: [] } }),
    upsertRole: async () => ({ ok: true, value: state }),
    setEnabled: async () => ({ ok: true, value: state }),
    setThinkingStyle: async () => ({ ok: true, value: state }),
    bindSession: async () => ({ ok: true, value: state }),
    clearSession: async () => ({ ok: true, value: state }),
    removeRole: async () => ({ ok: true, value: state }),
  }
  const slots = {
    inject: (_name, cb) => { cb(); return () => {} },
    register: (meta, render) => {
      if (meta && meta.name === 'settings.section') sectionRender = render
      return () => {}
    },
  }
  const child = { remote: { cosplay: remote }, slots }
  const ctx = {
    remote: { $mount: async () => () => {} },
    inject: (deps, cb) => {
      if (deps.length > 1) cb(child)
      else cb({ effect: (fn) => fn(), settings: { configure: () => () => {} } })
      return Object.assign(Promise.resolve(), { dispose: async () => {} })
    },
    effect: (fn) => { fn(); return () => {} },
    typert: { register: () => () => {} },
    settings: { update: async () => {} },
    get: () => undefined,
    on: () => () => {},
    fiber: {},
  }

  await import(pathToFileURL(CLIENT).href)
  assert.ok(captured, 'client.js 应调用 __ModuleLoader__.load')
  const mod = captured.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })
  await mod.apply(ctx)
  await new Promise((resolve) => setTimeout(resolve, 30))

  assert.equal(typeof sectionRender, 'function', '应注册 settings.section')
  const element = sectionRender()
  hooks.index = 0
  const tree = element.type(element.props)
  assert.ok(tree && tree.type === 'div', 'section 应返回 div，而不是 null / 抛错')
  const text = JSON.stringify(tree)
  assert.ok(text.includes('身份简介'), '应按 slotSchema 渲染槽位标题')
})
