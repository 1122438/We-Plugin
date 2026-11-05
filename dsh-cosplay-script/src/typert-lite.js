/**
 * 极简 typert-protocol 兼容层（零外部依赖）。
 *
 * 为什么需要它：本插件以 link: 方式装在 plugin-src 下，pnpm 不为 link 包安装
 * dependencies，且 plugin-src 解析不到 profile 的 node_modules。任何对内核包
 * （@deepseek-ai/dsh-typert-protocol 等）的 import 都会在宿主加载阶段抛
 * MODULE_NOT_FOUND，表现为「设置页整块消失 / apply 从不执行」。
 *
 * 复刻依据（读自宿主实现 @deepseek-ai/dsh-typert-protocol）：
 *   - `REMOTE_METHOD_DESCRIPTOR` 是**字符串常量**
 *     `"@deepseek-ai/dsh-typert-protocol/remote-methods"`，不是 symbol。
 *   - 描述符形状：`{ version: 1, methods: [marker...] }`，挂在类原型上。
 *   - marker 形状：`{ method, [exportName], [mode], invocation, [resources] }`。
 *   - `remoteMethods(service)` 从原型读该描述符并返回 markers。
 *   - `TypertRemoteService` = `super(ctx, key)` + 绑定 typertRemote。
 *
 * 因为用的是**字符串** key，宿主读到的就是同一个描述符 —— 无需共享 symbol。
 *
 * ⚠ 服务注册必须走 `ctx.reflect.provide()`（不是 ctx.set）：
 *   宿主 Gateway 的 collectSrcClaims / resolveSrcDescriptor 都遍历
 *   `ctx.reflect.props` 里 `type === 'service'` 的条目。ctx.set 不留条目。
 */

/** 与宿主一致的描述符 key（字符串）。 */
const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods'

const SEGMENT = /^[A-Za-z0-9_$.-]+$/

function validateSegment(subject, value) {
  if (typeof value !== 'string' || value === '.' || value === '..' || !SEGMENT.test(value)) {
    throw new TypeError(`typert-protocol: ${subject} must contain only RPC endpoint segment characters`)
  }
}

/** 读原型上的描述符（形状校验与宿主一致）。 */
function readDescriptor(prototype) {
  const property = Object.getOwnPropertyDescriptor(prototype, REMOTE_METHOD_DESCRIPTOR)
  if (property === undefined) return undefined
  const descriptor = property.value
  if (descriptor === null || typeof descriptor !== 'object') {
    throw new TypeError('typert-protocol: Remote method descriptor must be an object')
  }
  if (Reflect.get(descriptor, 'version') !== 1) {
    throw new TypeError(`typert-protocol: unsupported Remote method descriptor version ${String(Reflect.get(descriptor, 'version'))}`)
  }
  if (!Array.isArray(Reflect.get(descriptor, 'methods'))) {
    throw new TypeError('typert-protocol: Remote method descriptor methods must be an array')
  }
  return descriptor
}

/** 把一个方法标记为 Remote（等价于宿主的 mark()）。 */
function mark(prototype, method, invocation) {
  const descriptor = readDescriptor(prototype)
  const marker = Object.freeze({ method, invocation: Object.freeze(invocation) })
  const current = descriptor?.methods.find((candidate) => candidate.method === method)
  if (current !== undefined) {
    if (current.invocation?.kind === invocation.kind) return
    throw new Error(`typert-protocol: Remote method "${method}" has conflicting invocation markers`)
  }
  Object.defineProperty(prototype, REMOTE_METHOD_DESCRIPTOR, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze([...(descriptor?.methods ?? []), marker]),
    }),
  })
}

/** 手工把方法标记为 Remote（替代 @Remote 装饰器）。 */
export function markRemoteMethod(prototype, method) {
  validateSegment('Remote method', method)
  if (typeof prototype?.[method] !== 'function') {
    throw new TypeError(`typert-protocol: cannot mark "${method}" on an object without that method`)
  }
  mark(prototype, method, { kind: 'direct' })
}

/** 批量标记。 */
export function markRemoteMethods(prototype, methods) {
  for (const method of methods) markRemoteMethod(prototype, method)
}

/**
 * `@Remote` 装饰器的最小等价物（兼容手工调用形态）。
 */
export function Remote(_methodOrOptions, context) {
  if (context === undefined) {
    throw new TypeError('typert-protocol: Remote decorator context is missing')
  }
  if (typeof context !== 'object' || typeof context.name !== 'string') {
    throw new TypeError('typert-protocol: Remote decorators require a public instance method with a string name')
  }
  const method = context.name
  if (typeof context.addInitializer === 'function') {
    context.addInitializer(function () {
      const prototype = Object.getPrototypeOf(this)
      if (prototype === null) throw new TypeError(`typert-protocol: cannot mark Remote method "${method}" on an object without a prototype`)
      mark(prototype, method, { kind: 'direct' })
    })
  }
}

/**
 * Remote Service 基类的最小等价物。
 *
 * 关键：**必须走 `ctx.reflect.provide()`** 注册服务，不能只是 `ctx.set()`。
 * 与 cordis 真实 Service 构造函数的等价行为：
 *   this.ctx = ctx; this.name = name; ctx.reflect.provide(name, this, check)
 */
export class TypertRemoteService {
  /**
   * @param ctx - 拥有该服务的 cordis Context。
   * @param serviceKey - 服务 key，同时作为默认 wire namespace。
   * @param options - 可选 { namespace }。
   */
  constructor(ctx, serviceKey, options = {}) {
    validateSegment('service key', serviceKey)
    const namespace = options.namespace ?? serviceKey
    validateSegment('namespace', namespace)

    this.ctx = ctx
    this.name = serviceKey

    // 与 bindTypertRemote 等价：冻结的、可被 Gateway 读取的绑定。
    // 宿主 readBinding 会断言 binding.service === originalOf(receiver)。
    this.typertRemote = Object.freeze({ service: this, serviceKey, namespace })

    // 真正的服务注册（走 reflect.provide，形成 type === 'service' 条目）。
    const reflect = ctx?.reflect
    if (reflect !== undefined && typeof reflect.provide === 'function') {
      reflect.provide(serviceKey, this, undefined)
    } else if (typeof ctx?.set === 'function') {
      ctx.set(serviceKey, this)
    }
  }
}

/** 读回某原型上已标记的 Remote 方法（测试与自检用）。 */
export function remoteMethodsOf(service) {
  const prototype = Object.getPrototypeOf(service)
  if (prototype === null) return []
  return (readDescriptor(prototype)?.methods ?? []).map((marker) => ({ ...marker }))
}

export { REMOTE_METHOD_DESCRIPTOR }
