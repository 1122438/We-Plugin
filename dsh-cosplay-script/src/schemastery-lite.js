/**
 * 极简 schemastery 兼容层（零外部依赖）—— 实现 Standard Schema 契约。
 *
 * 为什么需要它：本插件以 `link:` 方式安装在 plugin-src 下，pnpm 不会为 link
 * 包安装 dependencies，且 plugin-src 解析不到 profile 的 node_modules。
 *
 * ⚠ 关键契约（`Cannot read properties of undefined (reading 'validate')` 的成因）：
 *   cordis 的 resolveConfig 实现是：
 *
 *     function resolveConfig(runtime, config) {
 *       if (!runtime.Config) return config
 *       const result = runtime.Config['~standard'].validate(config)   // ← 这里
 *       if ('then' in result) throw new TypeError('Async config validation is not supported')
 *       if (result.issues) throw new ValidationError(result.issues)
 *       else return result.value
 *     }
 *
 *   所以 `Config` 必须带 `~standard.validate()`（Standard Schema v1）且**同步**返回
 *   `{ value }` 或 `{ issues }`。缺少它就抛 TypeError，插件在加载阶段被拒，
 *   表现为「设置页整页消失 / apply() 从不执行」。
 *
 * 行为：容忍式校验 —— 类型不对就用默认值兜底，绝不 reject。
 * 因为本插件的 Config 只用于承载用户角色库，宁可降级也不要拦加载。
 */

/** 标记为 Standard Schema v1 兼容。 */
const STANDARD = '~standard'

/** 构造一个节点。 */
function node(kind, extra = {}) {
  const self = {
    _kind: kind,
    _default: undefined,
    ...extra,
  }

  // 链式方法：全部返回自身
  for (const method of ['default', 'required', 'volatile', 'description', 'optional']) {
    self[method] = (value) => {
      if (method === 'default') self._default = value
      if (method === 'description') self._description = value
      return self
    }
  }

  // ── Standard Schema v1 接口 ──
  self[STANDARD] = {
    version: 1,
    vendor: 'dsh-cosplay-script/schemastery-lite',
    validate: (value) => {
      try {
        return { value: coerce(self, value) }
      } catch {
        // 容忍：任何异常都回退默认值，绝不拦插件加载
        return { value: self._default }
      }
    },
  }

  return self
}

/** 把任意输入按 schema 规整成合法值（宽容策略）。 */
function coerce(schema, value) {
  if (schema === undefined) return value

  const fallback = schema._default

  if (value === undefined || value === null) {
    return fallback !== undefined ? fallback : inferEmpty(schema)
  }

  switch (schema._kind) {
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) {
        return fallback !== undefined ? fallback : inferEmpty(schema)
      }
      const out = {}
      for (const [key, child] of Object.entries(schema._shape ?? {})) {
        out[key] = coerce(child, value[key])
      }
      // 保留 schema 未声明但用户已有的键（如 sessionStates 的动态键）
      for (const key of Object.keys(value)) {
        if (!(key in out)) out[key] = value[key]
      }
      return out
    }
    case 'array': {
      if (!Array.isArray(value)) return fallback !== undefined ? fallback : []
      return value.map((item) => coerce(schema._inner, item))
    }
    case 'string':
      return typeof value === 'string' ? value : String(value)
    case 'boolean':
      return value === true
    case 'number': {
      const n = Number(value)
      return Number.isFinite(n) ? n : (fallback ?? 0)
    }
    case 'any':
      return value
    case 'union': {
      const options = Array.isArray(schema._values) ? schema._values : []
      return options.includes(value) ? value : (fallback ?? options[0])
    }
    default:
      return value
  }
}

/** 没有默认值时的类型空值。 */
function inferEmpty(schema) {
  switch (schema._kind) {
    case 'object': {
      const out = {}
      for (const [key, child] of Object.entries(schema._shape ?? {})) {
        const v = inferEmpty(child)
        if (v !== undefined) out[key] = v
      }
      return out
    }
    case 'array': return []
    case 'string': return ''
    case 'boolean': return false
    case 'number': return 0
    case 'union': return Array.isArray(schema._values) ? schema._values[0] : undefined
    default: return undefined
  }
}

export function object(shape = {}) { return node('object', { _shape: shape }) }
export function string() { return node('string') }
export function boolean() { return node('boolean') }
export function number() { return node('number') }
export function any() { return node('any') }
export function array(inner) { return node('array', { _inner: inner }) }
export function union(values) { return node('union', { _values: values }) }

/** 取默认值树（测试/自检用）。 */
export function resolveDefaults(schema) { return coerce(schema, undefined) }

const z = { object, string, boolean, number, any, array, union }
export default z
