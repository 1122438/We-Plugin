/**
 * dsh-cosplay-script — 浏览器侧（dsh.client 声明，包入口 dsh-cosplay-script/client）。
 *
 * 改造版（v1.0.1）。设置页「会话剧本」承载：
 *   - 总开关 / 思考风格；
 *   - 会话绑定 + 每会话「本场提示」；
 *   - 角色库：新建 / 编辑 / 删除；
 *   - 编辑器：核心（按 slotSchema 动态槽位）/ 扮演（style/examples/note）/ 条目；
 *   - 槽位设置（标题/顺序/建议字数/隐藏/删除）与注入预览。
 *   - 会话标题栏 / 新会话页的角色选择器。
 *
 * 数据通道：插件自有的 typert Remote 命名空间 `cosplay`。
 * 0.2.x 的三条硬约束（依据 dsh-api-gateway / dsh-typert-registry / dsh-client-modules
 * 的实现，勿凭 0.1.x 记忆修改）：
 *   1. 描述符的**参数** codec 必须是 `strict` 且带 `typeSymbol` 与 `create` 工厂，
 *      否则客户端 `requireStrictInputs` 会让 `$mount` 抛错；result 可用 `src-json`。
 *   2. 挂载必须由 async `apply` 自身 await 并 return disposer；**不要**包在
 *      `ctx.effect(async () => ...)` 里 —— 那里抛出的 rejection 会被 cordis 静默吞掉。
 *   3. 挂载后直接用 `ctx.remote.cosplay` 取命名空间；**不要**在本插件 inject
 *      `remote.cosplay`（自挂自取会自依赖死锁）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-cosplay-script',
  factory: (require) => {
    const React = require('react')
    const { useSyncExternalStore, useState, useCallback, useEffect } = React


    const styles = {
      page: { display: 'flex', flexDirection: 'column', gap: '16px', padding: '4px 0', maxWidth: '760px', margin: '0 auto', width: '100%', boxSizing: 'border-box' },
      card: { border: '1px solid var(--dsw-alias-border-strong, rgba(128,128,128,.3))', borderRadius: '12px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' },
      row: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
      title: { fontSize: '15px', fontWeight: 600 },
      subTitle: { fontSize: '13px', fontWeight: 600, opacity: 0.9 },
      hint: { fontSize: '13px', opacity: 0.72, lineHeight: '1.6' },
      switchTrack: { display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' },
      switchBox: { width: '38px', height: '22px', borderRadius: '11px', position: 'relative', transition: 'background .15s', background: 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.35))' },
      switchKnob: { width: '16px', height: '16px', borderRadius: '50%', background: '#fff', position: 'absolute', top: '3px', left: '3px', transition: 'left .15s' },
      button: { border: '1px solid var(--dsw-alias-border-strong, rgba(128,128,128,.3))', background: 'transparent', color: 'inherit', borderRadius: '8px', padding: '4px 10px', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' },
      buttonPrimary: { border: 'none', background: 'var(--dsw-specific-accent, #4d6bfe)', color: '#fff', borderRadius: '8px', padding: '5px 12px', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' },
      buttonDanger: { border: '1px solid rgba(239,68,68,.5)', background: 'transparent', color: 'rgb(239,68,68)', borderRadius: '8px', padding: '4px 10px', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' },
      input: { background: 'var(--dsw-alias-bg-layer-3, rgba(128,128,128,.08))', border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3))', borderRadius: '8px', padding: '5px 8px', color: 'var(--dsw-alias-label-primary, inherit)', fontSize: '13px', fontFamily: 'inherit', flex: 1, minWidth: '160px' },
      select: { background: 'var(--dsw-alias-bg-layer-3, rgba(128,128,128,.08))', border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3))', borderRadius: '8px', padding: '5px 8px', color: 'var(--dsw-alias-label-primary, inherit)', fontSize: '13px', fontFamily: 'inherit', flex: 1, minWidth: '220px' },
      textarea: { background: 'var(--dsw-alias-bg-layer-3, rgba(128,128,128,.08))', border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3))', borderRadius: '8px', padding: '6px 8px', color: 'var(--dsw-alias-label-primary, inherit)', fontSize: '13px', fontFamily: 'inherit', width: '100%', minHeight: '72px', resize: 'vertical', overflowY: 'auto', lineHeight: '1.5', boxSizing: 'border-box' },
      fieldBox: { border: '1px solid var(--dsw-alias-border-strong, rgba(128,128,128,.22))', borderRadius: '10px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' },
      badge: { fontSize: '12px', padding: '1px 8px', borderRadius: '99px', background: 'var(--dsw-specific-accent, #4d6bfe)', color: '#fff' },
      label: { fontSize: '12px', opacity: 0.6, minWidth: '64px' },
      iconBtn: { border: '1px solid var(--dsw-alias-border-strong, rgba(128,128,128,.3))', background: 'transparent', color: 'inherit', borderRadius: '6px', padding: '1px 7px', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit', lineHeight: '18px' },
    }

    // ── typert Remote 描述符 ──────────────────────────────────────────────────
    const strictCodec = (typeSymbol) => ({ mode: 'strict', typeSymbol, create: () => ({}) })
    const resultCodec = (typeSymbol) => ({ mode: 'src-json', typeSymbol })
    const p = (name) => ({ name, wire: name, source: 'json', codec: strictCodec(`dsh-cosplay-script#${name}`) })
    const COSPLAY_INVOCATIONS = [
      { id: 'dsh-cosplay-script#cosplay/getState', service: 'cosplay', namespace: 'cosplay', method: 'getState', invocation: { kind: 'direct' }, parameters: [], result: resultCodec('dsh-cosplay-script#CosplayState') },
      { id: 'dsh-cosplay-script#cosplay/listSessions', service: 'cosplay', namespace: 'cosplay', method: 'listSessions', invocation: { kind: 'direct' }, parameters: [], result: resultCodec('dsh-cosplay-script#SessionList') },
      { id: 'dsh-cosplay-script#cosplay/upsertRole', service: 'cosplay', namespace: 'cosplay', method: 'upsertRole', invocation: { kind: 'direct' }, parameters: [p('card')], result: resultCodec('dsh-cosplay-script#CosplayState') },
      { id: 'dsh-cosplay-script#cosplay/removeRole', service: 'cosplay', namespace: 'cosplay', method: 'removeRole', invocation: { kind: 'direct' }, parameters: [p('id')], result: resultCodec('dsh-cosplay-script#CosplayState') },
      { id: 'dsh-cosplay-script#cosplay/setEnabled', service: 'cosplay', namespace: 'cosplay', method: 'setEnabled', invocation: { kind: 'direct' }, parameters: [p('enabled')], result: resultCodec('dsh-cosplay-script#CosplayState') },
      { id: 'dsh-cosplay-script#cosplay/setThinkingStyle', service: 'cosplay', namespace: 'cosplay', method: 'setThinkingStyle', invocation: { kind: 'direct' }, parameters: [p('style')], result: resultCodec('dsh-cosplay-script#CosplayState') },
      { id: 'dsh-cosplay-script#cosplay/setSessionRole', service: 'cosplay', namespace: 'cosplay', method: 'setSessionRole', invocation: { kind: 'direct' }, parameters: [p('sessionId'), p('roleId')], result: resultCodec('dsh-cosplay-script#CosplayState') },
      { id: 'dsh-cosplay-script#cosplay/setSessionEnabled', service: 'cosplay', namespace: 'cosplay', method: 'setSessionEnabled', invocation: { kind: 'direct' }, parameters: [p('sessionId'), p('enabled')], result: resultCodec('dsh-cosplay-script#CosplayState') },
      { id: 'dsh-cosplay-script#cosplay/bindSession', service: 'cosplay', namespace: 'cosplay', method: 'bindSession', invocation: { kind: 'direct' }, parameters: [p('sessionId'), p('roleId'), p('enabled')], result: resultCodec('dsh-cosplay-script#CosplayState') },
      { id: 'dsh-cosplay-script#cosplay/clearSession', service: 'cosplay', namespace: 'cosplay', method: 'clearSession', invocation: { kind: 'direct' }, parameters: [p('sessionId')], result: resultCodec('dsh-cosplay-script#CosplayState') },
      { id: 'dsh-cosplay-script#cosplay/setSlotSchema', service: 'cosplay', namespace: 'cosplay', method: 'setSlotSchema', invocation: { kind: 'direct' }, parameters: [p('schema')], result: resultCodec('dsh-cosplay-script#CosplayState') },
      { id: 'dsh-cosplay-script#cosplay/preview', service: 'cosplay', namespace: 'cosplay', method: 'preview', invocation: { kind: 'direct' }, parameters: [p('roleId'), p('sampleText'), p('sessionId')], result: resultCodec('dsh-cosplay-script#Preview') },
      { id: 'dsh-cosplay-script#cosplay/setSessionNote', service: 'cosplay', namespace: 'cosplay', method: 'setSessionNote', invocation: { kind: 'direct' }, parameters: [p('sessionId'), p('note')], result: resultCodec('dsh-cosplay-script#CosplayState') },
    ]
    const COSPLAY_REMOTE = { package: 'dsh-cosplay-script', descriptors: COSPLAY_INVOCATIONS }

    function createCosplayStore(getRemote) {
      let snapshot = { status: 'loading', value: undefined }
      const listeners = new Set()
      const emit = () => { for (const l of [...listeners]) l() }
      const settle = (next) => { snapshot = next; emit() }
      const call = async (fn) => {
        const remote = getRemote()
        if (remote === undefined) {
          settle({ status: 'unavailable', value: undefined, error: 'cosplay Remote 未挂载' })
          return undefined
        }
        try { return await fn(remote) } catch (error) {
          settle({ status: 'unavailable', value: undefined, error: String(error && error.message ? error.message : error) })
          return undefined
        }
      }
      return {
        subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
        getSnapshot: () => snapshot,
        fail(error) {
          settle({ status: 'unavailable', value: undefined, error: String(error && error.message ? error.message : error) })
        },
        async load() {
          const res = await call((r) => r.getState())
          if (res === undefined) return
          if (res.ok) settle({ status: 'ready', value: res.value })
          else settle({ status: 'unavailable', value: undefined, error: res.error?.message ?? '读取失败' })
        },
        async mutate(fn) {
          const res = await call(fn)
          if (res === undefined) return undefined
          if (res.ok) { settle({ status: 'ready', value: res.value }); return res.value }
          throw new Error(res.error?.message ?? '写入失败')
        },
        /**
         * 发起一次调用但**不改写快照**（用于 listSessions 这类只读附属数据，
         * 避免把主状态的 status 打回 loading）。
         * @returns 原始响应对象（含 ok / value / error），或 undefined。
         */
        async callRaw(fn) {
          const remote = getRemote()
          if (remote === undefined) return undefined
          try { return await fn(remote) } catch { return undefined }
        },
      }
    }

    /**
     * 会话列表：走插件自己的 Remote `listSessions`（主机侧调 ctx.sessionQuery）。
     * 拿不到时退化为「手动粘贴 session id」，并显示原因。
     *
     * 常见失败：安装/更新插件后**没重启 DSH** —— 浏览器端（本文件）会随插件包自动
     * 重新加载，但主机端仍在跑旧代码，新加的 Remote 方法没有注册到网关上，
     * 于是请求落到 /api/cosplay/<method> 时得到 HTTP 404。重启即恢复。
     *
     * 列表会缓存一次；新建对话后可点「刷新」或在窗口重新获得焦点时自动重取，
     * 否则下拉里看不到刚建的会话。
     */
    function useSessionOptions(store) {
      const [sessions, setSessions] = useState([])
      const [error, setError] = useState(null)
      const [tick, setTick] = useState(0)

      useEffect(() => {
        let cancelled = false
        async function load() {
          try {
            const res = await store.callRaw((r) => r.listSessions())
            if (cancelled) return
            if (!res) { setError('会话列表接口未就绪，请重启 DSH'); return }
            if (res.ok && res.value && res.value.ok) {
              setSessions(res.value.sessions ?? [])
              setError(null)
            } else {
              const reason = res.value?.reason || res.error?.message || '无法枚举会话'
              setError(/HTTP 404/.test(reason)
                ? '主机端还没有加载新版本（HTTP 404）。请完全退出并重启 DSH 后再打开本页。'
                : reason)
            }
          } catch (e) {
            const msg = String(e && e.message ? e.message : e)
            if (!cancelled) setError(/HTTP 404/.test(msg) ? '主机端还没有加载新版本（HTTP 404）。请完全退出并重启 DSH。' : msg)
          }
        }
        void load()
        return () => { cancelled = true }
      }, [store, tick])

      // 窗口重新获得焦点时静默重取一次（切回来就能看到新建的对话）
      useEffect(() => {
        const onFocus = () => setTick((n) => n + 1)
        window.addEventListener('focus', onFocus)
        return () => window.removeEventListener('focus', onFocus)
      }, [])

      return { sessions, error, reload: () => setTick((n) => n + 1) }
    }

    // 兜底 schema：正常情况下来自 host 的 state.slotSchema（标题可按 profile 覆盖）。
    const DEFAULT_SLOT_SCHEMA = [
      { key: 'identity', title: '身份与背景', maxChars: 800, format: 'text' },
      { key: 'consciousness', title: '意识', maxChars: 600, format: 'text' },
      { key: 'personality', title: '性格', maxChars: 400, format: 'text' },
      { key: 'voice', title: '语气', maxChars: 400, format: 'text' },
      { key: 'userProfile', title: '用户档案', maxChars: 400, format: 'text' },
      { key: 'rules', title: '守则', maxChars: 400, format: 'list' },
      { key: 'behavior', title: '行为习惯', maxChars: 400, format: 'text' },
    ]

    const SLOT_HINTS = {
      identity: '身份、来历、外貌中会影响言行的部分；事件经历可放条目。',
      consciousness: '内心声音、自我认知、思考方式；语气写在这里也可以。',
      personality: '性格要点。',
      voice: '自称、对用户的称呼、口癖。',
      userProfile: '关于用户的稳定信息。',
      rules: '硬规则，一行一条。',
      behavior: '习惯性动作与小动作。',
    }

    // ⚠ 本 factory 在这里 return：函数声明会被提升，所以 apply 仍能引用下面的组件；
    // 但 `const` / `let` 不会执行 —— 任何组件运行时要用的值都必须定义在这个 return 之前。
    return {
      name: 'cosplay-client',
      inject: ['remote', 'slots', 'connection'],
      async apply(ctx) {
        let cosplayRemote = undefined
        const unregisters = []
        const store = createCosplayStore(() => cosplayRemote)
        const report = (error) => {
          const message = String(error && error.message ? error.message : error)
          store.fail(`Remote 挂载失败：${message}`)
          console.error('[dsh-cosplay-script] Remote 挂载失败:', message, error)
          return new Error(`COSPLAY_MOUNT_FAILED: ${message}`)
        }
        try {
          const disposeRemote = await ctx.remote.$mount(COSPLAY_REMOTE)
          const ui = ctx.inject(['remote.cosplay', 'slots'], (child) => {
            const remote = child.remote?.cosplay
            if (remote === undefined) throw new Error('the cosplay Remote namespace did not resolve after mount')
            cosplayRemote = remote
            unregisters.push(child.slots.inject('settings.section', () =>
              child.slots.register(
                { name: 'settings.section', id: 'cosplay', priority: 100, label: '会话剧本' },
                () => React.createElement(CosplaySectionV4, { store }),
              ),
            ))
            // 会话标题栏：为当前会话直接选角色（解决"新建会话还要回设置页绑定"）。
            unregisters.push(child.slots.inject('conversation.session.header.actions', () =>
              child.slots.register(
                { name: 'conversation.session.header.actions', id: 'cosplay-role-switcher', order: 41 },
                (props) => React.createElement(RoleSwitcher, {
                  key: props?.sessionId,
                  store,
                  sessionId: props?.sessionId,
                }),
              ),
            ))
            // 新会话页：创建前就能选角色。
            unregisters.push(child.slots.inject('conversation.hero.options', () =>
              child.slots.register(
                { name: 'conversation.hero.options', id: 'cosplay-role-hero', order: 41 },
                (props) => React.createElement(RoleSwitcher, {
                  key: props?.sessionId,
                  store,
                  sessionId: props?.sessionId,
                  hero: true,
                }),
              ),
            ))
            void store.load()
          })
          try { await ui } catch (error) {
            await ui.dispose()
            await disposeRemote()
            throw error
          }
          return async () => {
            for (const unregister of unregisters) {
              try { if (typeof unregister === 'function') unregister() } catch { /* ignore */ }
            }
            await ui.dispose()
            await disposeRemote()
          }
        } catch (error) {
          throw report(error)
        }
      },
    }
    // ── v4 编辑器 ────────────────────────────────────────────────────────────
    // 设置页改为 v4 结构：核心 / 扮演 / 条目 / 绑定。

    function slotsFromRole(role) {
      const slots = role.slots && typeof role.slots === 'object' ? { ...role.slots } : {}
      if (Object.keys(slots).length === 0 && role.core) {
        if (role.core.identity) slots.identity = role.core.identity
        if (role.core.personality) slots.personality = role.core.personality
        if (role.core.voice) slots.voice = role.core.voice
        if (Array.isArray(role.core.rules) && role.core.rules.length > 0) slots.rules = role.core.rules.join('\n')
      }
      return slots
    }

    function makeEmptyV4Form() {
      return {
        name: '',
        system_prompt: '',
        slots: {},
        play: { style: '', examples: '', note: '' },
        lore: [],
        scenes: [],
      }
    }

    function splitList(text) {
      return String(text || '')
        .split(/[,，、\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
    }

    function newEntry() {
      return {
        id: `e_${Date.now().toString(36)}_${Math.floor(Math.random() * 1296).toString(36)}`,
        title: '',
        keysText: '',
        excludeText: '',
        content: '',
        priority: 50,
        always: false,
        sticky: 0,
        cooldown: 0,
      }
    }

    function entryToForm(entry) {
      return {
        id: entry.id,
        title: entry.title || '',
        keysText: (entry.keys || []).join(', '),
        excludeText: (entry.exclude || []).join(', '),
        content: entry.content || '',
        priority: entry.priority ?? 50,
        always: entry.always === true,
        sticky: entry.sticky ?? 0,
        cooldown: entry.cooldown ?? 0,
      }
    }

    function toCardEntry(entry) {
      return {
        id: entry.id,
        title: entry.title,
        keys: splitList(entry.keysText),
        exclude: splitList(entry.excludeText),
        content: entry.content,
        priority: Number(entry.priority) || 0,
        always: entry.always === true,
        sticky: Number(entry.sticky) || 0,
        cooldown: Number(entry.cooldown) || 0,
      }
    }

    function formFromRole(role) {
      return {
        name: role.name || '',
        system_prompt: role.system_prompt || '',
        slots: slotsFromRole(role),
        play: {
          style: role.play?.style || '',
          examples: role.play?.examples || '',
          note: role.play?.note || '',
        },
        lore: (role.lore || []).map(entryToForm),
        scenes: (role.scenes || []).map(entryToForm),
      }
    }

    /**
     * 会话内的角色选择器（标题栏 / 新会话页）。
     * 只改当前会话的绑定，不影响其它会话。
     */
    function RoleSwitcher({ store, sessionId, hero }) {
      const h = React.createElement
      const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
      const [busy, setBusy] = useState(false)
      if (!sessionId || snapshot.status !== 'ready') return null
      const value = snapshot.value
      if (!value || value.enabled !== true) return null
      const roles = value.roles || []
      if (roles.length === 0) return null
      const state = value.sessionStates?.[sessionId] || {}
      const current = state.enabled ? (state.roleId || '') : ''
      const onChange = async (event) => {
        const roleId = event.target.value
        setBusy(true)
        try {
          await store.mutate((remote) => remote.bindSession(sessionId, roleId, Boolean(roleId)))
        } catch (error) {
          console.error('[dsh-cosplay-script] 会话绑定失败:', error)
        } finally {
          setBusy(false)
        }
      }
      return h('label', {
        style: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary, inherit)' },
        title: '会话剧本：为当前会话选择角色（只影响这个会话）',
      },
        h('span', null, '🎭'),
        h('select', {
          style: {
            background: 'var(--dsw-alias-bg-layer-3, rgba(128,128,128,.08))',
            border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3))',
            color: 'var(--dsw-alias-label-primary, inherit)',
            borderRadius: '8px',
            padding: '3px 6px',
            fontSize: '12px',
            fontFamily: 'inherit',
            maxWidth: hero ? '140px' : '180px',
          },
          value: current,
          disabled: busy,
          onChange,
        },
          h('option', { value: '' }, '不扮演'),
          roles.map((role) => h('option', { key: role.id, value: role.id }, role.name)),
        ),
      )
    }

    function CosplaySectionV4({ store }) {
      const h = React.createElement
      const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
      const value = snapshot.value
      const { sessions, error: sessionError, reload: reloadSessions } = useSessionOptions(store)

      const [openSections, setOpenSections] = useState({ core: true, play: false, entries: false })
      const [editingId, setEditingId] = useState(null)
      const [form, setForm] = useState(makeEmptyV4Form)
      const [pickedSessionId, setPickedSessionId] = useState('')
      const [manualSessionId, setManualSessionId] = useState('')
      const [notice, setNotice] = useState('')
      const [pendingDelete, setPendingDelete] = useState(null)
      const [showSchema, setShowSchema] = useState(false)
      const [schemaDraft, setSchemaDraft] = useState(null)
      const [showHidden, setShowHidden] = useState(false)
      const [pendingSchemaDelete, setPendingSchemaDelete] = useState(null)
      const [preview, setPreview] = useState(null)
      const [previewSample, setPreviewSample] = useState('')
      const [noteDraft, setNoteDraft] = useState('')

      // 自动选中最新的会话，让「本场提示」一进页面就能看到。
      useEffect(() => {
        if (pickedSessionId || manualSessionId) return
        if (!Array.isArray(sessions) || sessions.length === 0) return
        const first = sessions[0].id
        setPickedSessionId(first)
        setNoteDraft(value?.sessionNotes?.[first] ?? '')
      }, [sessions, pickedSessionId, manualSessionId, value])

      // 状态晚于会话列表加载时，补一次本场提示（不覆盖用户正在输入的内容）。
      useEffect(() => {
        if (!pickedSessionId) return
        const saved = value?.sessionNotes?.[pickedSessionId] ?? ''
        setNoteDraft((current) => (current ? current : saved))
      }, [value, pickedSessionId])

      const update = useCallback((patch) => setForm((f) => ({ ...f, ...patch })), [])
      const updatePlay = useCallback((patch) => setForm((f) => ({ ...f, play: { ...f.play, ...patch } })), [])
      const setSlot = useCallback((key, text) => setForm((f) => ({ ...f, slots: { ...f.slots, [key]: text } })), [])
      const updateEntry = useCallback((kind, id, patch) => setForm((f) => ({
        ...f,
        [kind]: f[kind].map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
      })), [])
      const addEntry = useCallback((kind) => setForm((f) => ({ ...f, [kind]: [...f[kind], newEntry()] })), [])
      const moveEntry = useCallback((kind, id, delta) => setForm((f) => {
        const list = [...f[kind]]
        const index = list.findIndex((entry) => entry.id === id)
        const next = index + delta
        if (index < 0 || next < 0 || next >= list.length) return f
        const [item] = list.splice(index, 1)
        list.splice(next, 0, item)
        return { ...f, [kind]: list }
      }), [])
      const removeEntry = useCallback((kind, id) => setForm((f) => ({
        ...f,
        [kind]: f[kind].filter((entry) => entry.id !== id),
      })), [])

      const beginEdit = useCallback((role) => {
        setEditingId(role ? role.id : null)
        setForm(role ? formFromRole(role) : makeEmptyV4Form())
        setNotice('')
        setOpenSections({ core: true, play: false, entries: false })
        setPendingDelete(null)
      }, [])

      const save = useCallback(async () => {
        if (!form.name.trim()) { setNotice('角色名不能为空'); return }
        const slots = {}
        for (const [key, text] of Object.entries(form.slots)) {
          if (typeof text === 'string' && text.trim()) slots[key] = text
        }
        const card = {
          name: form.name.trim(),
          system_prompt: form.system_prompt,
          slots,
          slotsEdited: true,
          play: { style: form.play.style, examples: form.play.examples, note: form.play.note },
          lore: form.lore.map(toCardEntry),
          scenes: form.scenes.map(toCardEntry),
        }
        if (editingId) card.id = editingId
        try {
          const next = await store.mutate((remote) => remote.upsertRole(card))
          const saved = (next?.roles || []).find((role) => role.id === card.id || role.name === card.name)
          if (saved) {
            setEditingId(saved.id)
            setForm(formFromRole(saved))
          }
          setNotice('已保存')
        } catch (error) {
          setNotice(String(error && error.message ? error.message : error))
        }
      }, [form, editingId, store])

      const removeRole = useCallback((role) => {
        if (pendingDelete !== role.id) {
          setPendingDelete(role.id)
          setNotice(`再次点击「删除」确认删除「${role.name}」`)
          return
        }
        setPendingDelete(null)
        setNotice('')
        store.mutate((remote) => remote.removeRole(role.id)).catch((error) => {
          setNotice(String(error && error.message ? error.message : error))
        })
      }, [pendingDelete, store])

      const toggleGlobal = useCallback(() => {
        store.mutate((remote) => remote.setEnabled(!(value?.enabled === true))).catch((error) => {
          setNotice(String(error && error.message ? error.message : error))
        })
      }, [store, value])

      const setThinkingStyle = useCallback((style) => {
        store.mutate((remote) => remote.setThinkingStyle(style)).catch((error) => {
          setNotice(String(error && error.message ? error.message : error))
        })
      }, [store])

      const bindSession = useCallback((sessionId, roleId) => {
        if (!sessionId) { setNotice('请先选择一个会话'); return }
        store.mutate((remote) => remote.bindSession(sessionId, roleId || '', Boolean(roleId))).catch((error) => {
          setNotice(String(error && error.message ? error.message : error))
        })
      }, [store])

      const toggleSession = useCallback((sessionId, enabled) => {
        if (!sessionId) { setNotice('请先选择一个会话'); return }
        const roleId = value?.sessionStates?.[sessionId]?.roleId ?? ''
        store.mutate((remote) => remote.bindSession(sessionId, roleId, enabled)).catch((error) => {
          setNotice(String(error && error.message ? error.message : error))
        })
      }, [store, value])

      const clearBinding = useCallback((sessionId) => {
        if (!sessionId) return
        store.mutate((remote) => remote.clearSession(sessionId)).catch((error) => {
          setNotice(String(error && error.message ? error.message : error))
        })
      }, [store])

      if (snapshot.status === 'loading') return h('div', { style: styles.hint }, '会话剧本设置加载中…')
      if (snapshot.status === 'unavailable') {
        return h('div', { style: styles.hint }, `角色库不可用：${snapshot.error ?? '未知原因'}`)
      }

      const enabled = value?.enabled === true
      const thinkingStyle = value?.thinkingStyle ?? 'neutral'
      const roles = value?.roles ?? []
      const slotSchema = Array.isArray(value?.slotSchema) && value.slotSchema.length > 0
        ? value.slotSchema
        : DEFAULT_SLOT_SCHEMA
      const visibleSchema = slotSchema.filter((def) => def.hidden !== true)
      const hiddenSlotKeys = new Set(slotSchema.filter((def) => def.hidden === true).map((def) => def.key))
      const sessionStates = value?.sessionStates ?? {}
      const currentSessionId = pickedSessionId || manualSessionId
      const currentState = currentSessionId ? (sessionStates[currentSessionId] ?? { roleId: '', enabled: false }) : null
      const sessionRows = Object.entries(sessionStates).filter(([, st]) => st && (st.enabled || st.roleId))
      const deadBindings = sessions.length > 0
        ? sessionRows.filter(([sid]) => !sessions.some((session) => session.id === sid))
        : []
      const cleanupDead = useCallback(async () => {
        for (const [sid] of deadBindings) {
          try { await store.mutate((remote) => remote.clearSession(sid)) } catch { /* ignore */ }
          // 会话已删除：连同本场提示一起清掉（解绑本身会保留提示）。
          try { await store.mutate((remote) => remote.setSessionNote(sid, '')) } catch { /* ignore */ }
        }
        setNotice(`已清理 ${deadBindings.length} 条失效绑定`)
      }, [deadBindings, store])
      const coreChars = Object.entries(form.slots)
        .filter(([key]) => !hiddenSlotKeys.has(key))
        .reduce((sum, [, text]) => sum + String(text || '').length, 0)
      const entryChars = [...form.lore, ...form.scenes].reduce((sum, entry) => sum + entry.content.length, 0)
      const qualityIssues = (() => {
        const issues = []
        const instructionLike = /请|要求|必须|不要|禁止|规则|注意|务必/
        const entries = [...form.lore, ...form.scenes]
        for (const entry of entries) {
          if (instructionLike.test(entry.title)) {
            issues.push(`「${entry.title}」标题像行为指令；建议把行为要求放进「扮演」页的扮演方式`)
          }
          if (entry.always && entry.content.length > 300) {
            issues.push(`「${entry.title}」常驻且 ${entry.content.length} 字，建议取消常驻或拆成短条目`)
          }
          if (!entry.always && splitList(entry.keysText).length === 0) {
            issues.push(`「${entry.title}」没有触发词，永远不会被召回`)
          }
        }
        if (!form.play.style.trim()) {
          issues.push('没有填写「扮演方式」：场景优先、篇幅权衡、视角都靠它')
        }
        const coreText = Object.entries(form.slots)
          .filter(([key]) => !hiddenSlotKeys.has(key))
          .map(([, text]) => text)
          .join('\n')
        for (const entry of entries) {
          const snippet = entry.content.trim().slice(0, 40)
          if (snippet.length >= 20 && coreText.includes(snippet)) {
            issues.push(`「${entry.title}」与核心内容重复`)
          }
        }
        return issues
      })()

      const label = (text) => h('span', { style: styles.label }, text)
      const hint = (text) => h('div', { style: styles.hint }, text)
      const row = (...children) => h('div', { style: styles.row }, ...children)
      const textarea = (val, onChange, placeholder, minHeight) => h('textarea', {
        style: { ...styles.textarea, minHeight: minHeight || '76px' },
        value: val,
        onChange: (e) => onChange(e.target.value),
        placeholder,
      })
      const tabButton = (id, text) => h('button', {
        style: {
          ...styles.button,
          ...(openSections[id] ? { borderColor: 'var(--dsw-specific-accent, #4d6bfe)', fontWeight: 600 } : {}),
        },
        onClick: () => setOpenSections({ core: false, play: false, entries: false, [id]: true }),
      }, text)

      const effectiveSchema = schemaDraft ?? slotSchema
      const schemaRows = effectiveSchema.filter((def) => showHidden || !def.hidden)
      const setSchemaRow = (key, patch) => setSchemaDraft((prev) => (prev ?? effectiveSchema).map((def) => (def.key === key ? { ...def, ...patch } : def)))
      const moveSchemaRow = (key, delta) => setSchemaDraft((prev) => {
        const list = (prev ?? effectiveSchema).map((def) => ({ ...def }))
        const index = list.findIndex((def) => def.key === key)
        const next = index + delta
        if (index < 0 || next < 0 || next >= list.length) return prev
        const [item] = list.splice(index, 1)
        list.splice(next, 0, item)
        return list
      })
      const addSchemaRow = () => setSchemaDraft((prev) => [
        ...(prev ?? effectiveSchema),
        { key: `slot-${Date.now().toString(36)}`, title: '新槽位', maxChars: 400, format: 'text', hidden: false },
      ])
      const removeSchemaRow = (key) => {
        if (pendingSchemaDelete !== key) {
          const used = (value?.roles ?? []).some((role) => String(role.slots?.[key] || '').trim())
          setPendingSchemaDelete(key)
          setNotice(used
            ? `「${key}」在角色里有内容：移除后内容会以标识作为标题继续渲染。再次点击确认删除。`
            : `再次点击删除槽位「${key}」`)
          return
        }
        setPendingSchemaDelete(null)
        setSchemaDraft((prev) => (prev ?? effectiveSchema).filter((def) => def.key !== key))
      }
      const saveSchema = async () => {
        try {
          await store.mutate((remote) => remote.setSlotSchema(schemaDraft ?? effectiveSchema))
          setSchemaDraft(null)
          setPendingSchemaDelete(null)
          setNotice('槽位设置已保存')
        } catch (error) {
          setNotice(String(error && error.message ? error.message : error))
        }
      }
      const runPreview = async () => {
        if (!editingId) { setNotice('先保存角色，再预览注入'); return }
        const res = await store.callRaw((remote) => remote.preview(editingId, previewSample, currentSessionId))
        if (!res) { setNotice('预览失败：Remote 未就绪'); return }
        if (res.ok) setPreview(res.value)
        else setNotice(String(res.error?.message ?? '预览失败'))
      }
      const selectSession = (sessionId) => {
        setPickedSessionId(sessionId)
        setNoteDraft(value?.sessionNotes?.[sessionId] ?? '')
      }
      const saveNote = async (sessionId, text = noteDraft) => {
        if (!sessionId) { setNotice('请先选择一个会话'); return }
        try {
          await store.mutate((remote) => remote.setSessionNote(sessionId, text))
          setNotice(text ? '本场提示已保存' : '本场提示已清除')
        } catch (error) {
          setNotice(String(error && error.message ? error.message : error))
        }
      }

      const renderEntry = (entry, kind, index, total) => h('div', { key: entry.id, style: styles.fieldBox },
        row(
          h('input', {
            style: { ...styles.input, flex: '0 0 160px' },
            value: entry.title,
            placeholder: kind === 'scenes' ? '场景标题' : '条目标题',
            onChange: (e) => updateEntry(kind, entry.id, { title: e.target.value }),
          }),
          h('button', { style: styles.iconBtn, disabled: index === 0, title: '上移', onClick: () => moveEntry(kind, entry.id, -1) }, '↑'),
          h('button', { style: styles.iconBtn, disabled: index === total - 1, title: '下移', onClick: () => moveEntry(kind, entry.id, 1) }, '↓'),
          h('label', { style: { ...styles.hint, display: 'inline-flex', alignItems: 'center', gap: '4px' } },
            h('input', { type: 'checkbox', checked: entry.always, onChange: (e) => updateEntry(kind, entry.id, { always: e.target.checked }) }),
            '常驻（正文一起注入）'),
          label('优先级'),
          h('input', { type: 'number', style: { ...styles.input, flex: '0 0 72px' }, value: entry.priority, onChange: (e) => updateEntry(kind, entry.id, { priority: Number(e.target.value) }) }),
          h('button', { style: styles.buttonDanger, onClick: () => removeEntry(kind, entry.id) }, '✕ 删除'),
        ),
        row(
          h('input', { style: { ...styles.input, flex: 1 }, value: entry.keysText, placeholder: '触发词（逗号分隔）', onChange: (e) => updateEntry(kind, entry.id, { keysText: e.target.value }) }),
          h('input', { style: { ...styles.input, flex: 1 }, value: entry.excludeText, placeholder: '排除词（可选）', onChange: (e) => updateEntry(kind, entry.id, { excludeText: e.target.value }) }),
          label('保持'),
          h('input', { type: 'number', style: { ...styles.input, flex: '0 0 60px' }, value: entry.sticky, onChange: (e) => updateEntry(kind, entry.id, { sticky: Number(e.target.value) }) }),
          label('冷却'),
          h('input', { type: 'number', style: { ...styles.input, flex: '0 0 60px' }, value: entry.cooldown, onChange: (e) => updateEntry(kind, entry.id, { cooldown: Number(e.target.value) }) }),
        ),
        textarea(entry.content, (v) => updateEntry(kind, entry.id, { content: v }), '条目正文（命中触发词时注入）', '96px'),
      )

      return h('div', { style: styles.page },
        // 总开关
        h('div', { style: styles.card },
          h('div', { style: styles.row },
            h('div', { style: styles.title }, '🎭 会话剧本'),
            h('label', { style: styles.switchTrack, onClick: toggleGlobal },
              h('span', { style: { ...styles.switchBox, background: enabled ? 'var(--dsw-specific-accent, #4d6bfe)' : styles.switchBox.background } },
                h('span', { style: { ...styles.switchKnob, left: enabled ? '19px' : '3px' } })),
              h('span', null, enabled ? '总开关：开启' : '总开关：关闭'),
            ),
          ),
          hint(enabled ? '只有下方「已绑定角色的会话」会扮演；其它会话保持默认助手身份。' : '总开关关闭时，所有会话都不扮演。'),
          row(
            label('思考风格'),
            h('button', { style: { ...styles.button, ...(thinkingStyle !== 'role' ? { borderColor: 'var(--dsw-specific-accent, #4d6bfe)' } : {}) }, onClick: () => setThinkingStyle('neutral') }, '中立'),
            h('button', { style: { ...styles.button, ...(thinkingStyle === 'role' ? { borderColor: 'var(--dsw-specific-accent, #4d6bfe)' } : {}) }, onClick: () => setThinkingStyle('role') }, '角色化'),
            hint(thinkingStyle === 'role' ? '思考过程也用角色口吻（仅对支持 <think> 的模型有意义）。' : '推荐：只在正文里扮演。'),
          ),
          notice ? h('div', { style: { ...styles.hint, color: 'rgb(239,68,68)' } }, notice) : null,
          deadBindings.length > 0
            ? h('div', { style: { ...styles.hint, color: 'rgb(239,68,68)' } },
                `检测到 ${deadBindings.length} 条失效绑定（对应会话已删除），建议在下方「会话绑定」里清理。`)
            : null,
        ),

        // 角色库
        h('div', { style: styles.card },
          row(
            h('div', { style: styles.title }, '角色库'),
            h('button', { style: styles.buttonPrimary, onClick: () => beginEdit(null) }, '＋ 新建角色'),
          ),
          roles.length === 0
            ? hint('角色库为空。')
            : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
                roles.map((role) => row(
                  h('span', { key: `${role.id}-name`, style: { minWidth: '96px' } }, role.name),
                  h('span', {
                    key: `${role.id}-meta`,
                    style: { ...styles.hint, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                  }, `核心${role.core?.identity ? '✓' : '—'} · ${(role.lore || []).length} 设定 · ${(role.scenes || []).length} 场景`),
                  h('button', { key: `${role.id}-edit`, style: styles.button, onClick: () => beginEdit(role) }, '编辑'),
                  h('button', { key: `${role.id}-del`, style: styles.buttonDanger, onClick: () => removeRole(role) },
                    pendingDelete === role.id ? '确认删除' : '删除'),
                )),
              ),
        ),

        // 编辑器
        h('div', { style: styles.card },
          h('div', { style: styles.title }, editingId ? `编辑角色：${form.name || editingId}` : '新建角色'),
          row(label('名称 *'), h('input', { style: styles.input, value: form.name, placeholder: '角色名', onChange: (e) => update({ name: e.target.value }) })),
          h('div', { style: styles.row }, tabButton('core', '核心'), tabButton('play', '扮演'), tabButton('entries', '条目')),
          hint(`核心约 ${coreChars} 字（常驻系统提示词）；条目共 ${entryChars} 字（按需召回）。`),
          h('div', {
            style: {
              ...styles.fieldBox,
              borderColor: qualityIssues.length > 0 ? 'rgba(239,68,68,.4)' : 'rgba(34,197,94,.4)',
            },
          },
            h('div', { style: styles.subTitle }, qualityIssues.length > 0 ? `质量检查：${qualityIssues.length} 项` : '质量检查：通过'),
            qualityIssues.length > 0
              ? h('div', { style: { ...styles.hint, whiteSpace: 'pre-line' } }, qualityIssues.map((issue) => `· ${issue}`).join('\n'))
              : hint('核心 / 扮演 / 条目结构正常。'),
          ),

          openSections.core
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '4px' } },
                hint('空槽不会注入，也不影响性能；字数是建议值，超出只标红、不截断。'),
                visibleSchema.map((def) => {
                  const text = form.slots[def.key] || ''
                  const over = def.maxChars > 0 && text.length > def.maxChars
                  return h('div', { key: def.key, style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                    row(
                      label(def.title + (def.format === 'list' ? '（一行一条）' : '')),
                      h('span', {
                        style: { ...styles.hint, marginLeft: 'auto', color: over ? 'rgb(239,68,68)' : undefined },
                      }, `约 ${text.length} 字 · 建议 ≤${def.maxChars}`),
                    ),
                    textarea(text, (v) => setSlot(def.key, v), SLOT_HINTS[def.key] || '', def.format === 'list' ? '92px' : '88px'),
                    over
                      ? h('div', { style: { ...styles.hint, color: 'rgb(239,68,68)' } },
                          `超出建议 ${text.length - def.maxChars} 字；不会截断，但会稀释后面的内容`)
                      : null,
                  )
                }),
                (() => {
                  const known = new Set(slotSchema.map((def) => def.key))
                  const extra = Object.keys(form.slots).filter((key) => !known.has(key) && String(form.slots[key] || '').trim())
                  return extra.map((key) => h('div', { key, style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                    label(`${key}（未在 schema 中）`),
                    textarea(form.slots[key], (v) => setSlot(key, v), '未声明的槽位，仍会渲染', '88px'),
                  ))
                })(),
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                  label('附加指令（可选）'),
                  textarea(form.system_prompt, (v) => update({ system_prompt: v }), '放在核心文本开头，例如「回复不少于 500 字」', '72px'),
                ),
              )
            : null,

          openSections.play
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '4px' } },
                hint('决定「怎么写」；示例对话比任何形容词都有效。'),
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                  label('扮演方式'),
                  textarea(form.play.style, (v) => updatePlay({ style: v }), '例如：优先描写用户给出的场景；续写长度由剧情与篇幅权衡；保持第一人称；不出戏解释设定。', '120px'),
                ),
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                  label('示例对话（可选）'),
                  textarea(form.play.examples, (v) => updatePlay({ examples: v }), '给 2–4 句语气样例，模型模仿样例比听指令更有效。', '120px'),
                ),
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                  label('深度提示（每轮末尾·可选）'),
                  textarea(form.play.note, (v) => updatePlay({ note: v }), '每轮末尾注入的短提示，例如：保持第一人称、句子短、不要总结。建议 ≤200 字。', '88px'),
                ),
              )
            : null,

          openSections.entries
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', paddingTop: '4px' } },
                row(
                  h('div', { style: styles.subTitle }, `设定条目（${form.lore.length}）`),
                  h('button', { style: styles.buttonPrimary, onClick: () => addEntry('lore') }, '＋ 设定条目'),
                ),
                hint('触发词命中时才注入正文；常驻条目直接进核心。标题只用于索引和小标题，行为要求请写进「扮演方式」。'),
                form.lore.length === 0 ? hint('没有设定条目。') : form.lore.map((entry, index) => renderEntry(entry, 'lore', index, form.lore.length)),
                row(
                  h('div', { style: styles.subTitle }, `剧情场景（${form.scenes.length}）`),
                  h('button', { style: styles.buttonPrimary, onClick: () => addEntry('scenes') }, '＋ 场景条目'),
                ),
                hint('长场景放这里，不要塞进核心；用触发词或「常驻」控制注入。'),
                form.scenes.length === 0 ? hint('没有场景条目。') : form.scenes.map((entry, index) => renderEntry(entry, 'scenes', index, form.scenes.length)),
              )
            : null,

          row(
            h('button', { style: styles.buttonPrimary, onClick: save }, '保存'),
            editingId ? h('button', { style: styles.button, onClick: runPreview }, '预览注入') : null,
            editingId ? h('button', { style: styles.button, onClick: () => beginEdit(null) }, '新建') : null,
          ),
          editingId
            ? h('input', {
                style: styles.input,
                value: previewSample,
                placeholder: '示例消息（测试召回用，可选）',
                onChange: (e) => setPreviewSample(e.target.value),
              })
            : null,
          preview
            ? h('div', { style: styles.fieldBox },
                row(
                  h('div', { style: styles.subTitle },
                    `注入预览：section ${preview.coreChars} 字${preview.recallChars ? ` · 召回 ${preview.recallChars} 字` : ''}`),
                  h('button', { style: styles.iconBtn, onClick: () => setPreview(null) }, '关闭'),
                ),
                hint('预览的是已保存版本；改动后请先保存。'),
                h('textarea', { readOnly: true, style: { ...styles.textarea, minHeight: '220px' }, value: preview.core }),
                preview.recall
                  ? h('textarea', { readOnly: true, style: { ...styles.textarea, minHeight: '120px' }, value: preview.recall })
                  : null,
              )
            : null,
        ),

        // 槽位设置（profile 级）
        h('div', { style: styles.card },
          row(
            h('div', { style: styles.title }, '槽位设置'),
            h('button', { style: styles.button, onClick: () => setShowSchema((v) => !v) }, showSchema ? '收起' : '编辑'),
          ),
          hint('profile 级配置。左侧固定标识（key）只用于迁移与渲染，不会出现在提示词里；模型看到的是「标题」。隐藏＝保留内容但不注入；删除＝从 schema 移除（内容仍留在卡片里）。'),
          showSchema
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
                row(
                  h('button', { style: styles.button, onClick: () => setShowHidden((v) => !v) }, showHidden ? '不显示隐藏项' : '显示隐藏项'),
                  h('button', { style: styles.button, onClick: addSchemaRow }, '＋ 添加槽位'),
                  h('button', { style: styles.buttonPrimary, onClick: saveSchema }, '保存槽位'),
                  schemaDraft ? h('button', { style: styles.button, onClick: () => setSchemaDraft(null) }, '取消修改') : null,
                ),
                schemaRows.map((def) => h('div', { key: def.key, style: styles.fieldBox },
                  row(
                    h('span', {
                      style: {
                        ...styles.hint,
                        fontFamily: 'ui-monospace, Consolas, monospace',
                        minWidth: '96px',
                      },
                      title: '内部标识：用于迁移与渲染，不会出现在提示词里',
                    }, def.key),
                    h('input', {
                      style: styles.input,
                      value: def.title,
                      placeholder: '模型看到的标题',
                      onChange: (e) => setSchemaRow(def.key, { title: e.target.value }),
                    }),
                    h('span', { style: styles.hint }, '建议'),
                    h('input', {
                      type: 'number',
                      style: { ...styles.input, flex: '0 0 80px' },
                      value: def.maxChars,
                      onChange: (e) => setSchemaRow(def.key, { maxChars: Number(e.target.value) }),
                    }),
                    h('label', { style: { ...styles.hint, display: 'inline-flex', alignItems: 'center', gap: '4px' } },
                      h('input', { type: 'checkbox', checked: def.hidden === true, onChange: (e) => setSchemaRow(def.key, { hidden: e.target.checked }) }),
                      '隐藏'),
                    h('button', { style: styles.iconBtn, title: '上移', onClick: () => moveSchemaRow(def.key, -1) }, '↑'),
                    h('button', { style: styles.iconBtn, title: '下移', onClick: () => moveSchemaRow(def.key, 1) }, '↓'),
                    h('button', {
                      style: pendingSchemaDelete === def.key ? styles.buttonDanger : styles.iconBtn,
                      title: '删除该槽位',
                      onClick: () => removeSchemaRow(def.key),
                    }, pendingSchemaDelete === def.key ? '确认删除' : '✕'),
                  ),
                )),
              )
            : null,
        ),

        // 会话绑定
        h('div', { style: styles.card },
          h('div', { style: styles.title }, '会话绑定'),
          hint('选中一个会话，指定角色并开启。只有被开启的会话会扮演。'),
          sessionError ? h('div', { style: { ...styles.hint, color: 'rgb(239,68,68)' } }, `无法自动枚举会话（${sessionError}）。可手动粘贴会话 ID。`) : null,
          row(
            label('选择会话'),
            sessions.length > 0
              ? h('select', { style: styles.select, value: pickedSessionId, onChange: (e) => selectSession(e.target.value) },
                  h('option', { value: '' }, '— 请选择 —'),
                  sessions.map((s) => h('option', { key: s.id, value: s.id }, `${s.title || '新对话'}  (${s.id})`)))
              : h('input', {
                  style: styles.input,
                  placeholder: '手动粘贴 session id',
                  value: manualSessionId,
                  onChange: (e) => {
                    const next = e.target.value.trim()
                    setManualSessionId(next)
                    setNoteDraft(value?.sessionNotes?.[next] ?? '')
                  },
                }),
            h('button', { style: styles.button, onClick: reloadSessions }, '刷新'),
          ),
          row(
            label('指定角色'),
            h('select', {
              style: styles.select,
              value: currentState?.roleId ?? '',
              onChange: (e) => bindSession(currentSessionId, e.target.value || null),
            },
              h('option', { value: '' }, '— 不扮演 —'),
              roles.map((r) => h('option', { key: r.id, value: r.id }, r.name))),
            h('button', { style: styles.button, onClick: () => toggleSession(currentSessionId, !(currentState?.enabled === true)) },
              currentState?.enabled ? '关闭该会话' : '开启该会话'),
            h('button', { style: styles.buttonDanger, onClick: () => clearBinding(currentSessionId) }, '清除绑定'),
          ),
          currentSessionId
            ? hint(`当前：${currentSessionId} — ${currentState?.enabled ? '已开启' : '未开启'}${currentState?.roleId ? `，角色 ${roles.find((r) => r.id === currentState.roleId)?.name ?? currentState.roleId}` : ''}`)
            : null,
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' } },
            row(
              label('本场提示'),
              h('span', { style: { ...styles.hint, marginLeft: 'auto' } },
                currentSessionId ? `${noteDraft.length}/200` : '先选择会话'),
            ),
            currentSessionId
              ? textarea(noteDraft, (v) => setNoteDraft(v.slice(0, 200)), '这一场的方向：节奏、氛围、禁忌；AI 也可用 cosplay_note 更新。', '72px')
              : hint('先在上方选择一个会话，再编辑这一场的提示。'),
            currentSessionId
              ? row(
                  h('button', { style: styles.buttonPrimary, onClick: () => saveNote(currentSessionId) }, '保存本场提示'),
                  h('button', { style: styles.button, onClick: () => { setNoteDraft(''); saveNote(currentSessionId, '') } }, '清除'),
                  h('button', { style: styles.button, onClick: () => setNoteDraft(value?.sessionNotes?.[currentSessionId] ?? '') }, '读取当前'),
                )
              : null,
            currentSessionId && value?.sessionNotes?.[currentSessionId]
              ? hint(`当前已保存：${value.sessionNotes[currentSessionId]}`)
              : currentSessionId
                ? hint('当前没有本场提示；AI 在场景变化时可用 cosplay_note 写入。')
                : null,
          ),
          sessionRows.length > 0
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' } },
                h('div', { style: styles.row },
                  h('div', { style: styles.subTitle }, '已绑定角色的会话'),
                  deadBindings.length > 0
                    ? h('button', { style: styles.buttonDanger, onClick: cleanupDead }, `清理 ${deadBindings.length} 条失效绑定`)
                    : null,
                ),
                sessionRows.map(([sid, st]) => {
                  const role = roles.find((r) => r.id === st.roleId)
                  const info = sessions.find((session) => session.id === sid)
                  const dead = sessions.length > 0 && !info
                  return h('div', {
                    key: sid,
                    style: {
                      border: `1px solid ${dead ? 'rgba(239,68,68,.45)' : 'var(--dsw-alias-border-l2, rgba(128,128,128,.22))'}`,
                      borderRadius: '10px',
                      padding: '8px 10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    },
                  },
                    h('div', { style: styles.row },
                      h('span', { style: { fontWeight: 600 } }, role ? role.name : '未指定'),
                      h('span', { style: styles.badge }, st.enabled ? '已开启' : '已关闭'),
                      h('span', { style: { ...styles.hint, flex: 1 } }, dead ? '会话已不存在' : (info?.title || '新对话')),
                    ),
                    h('div', { style: { fontSize: '11px', fontFamily: 'monospace', opacity: 0.6, wordBreak: 'break-all' } }, sid),
                    h('div', { style: styles.row },
                      h('button', { style: styles.button, onClick: () => selectSession(sid) }, '选中'),
                      h('button', { style: styles.buttonDanger, onClick: () => clearBinding(sid) }, '解绑'),
                    ),
                  )
                }),
              )
            : hint('还没有任何会话绑定角色。'),
        ),

        hint('会话剧本 v1.0.1 · 本场提示 / 深度提示 / 预览'),
      )
    }
  },
})
