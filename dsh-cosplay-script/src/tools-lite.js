/**
 * 零依赖工具：替代 @deepseek-ai/dsh-tools 的 defineTool。
 *
 * 为什么不能 import：本插件以 link: 方式装在 plugin-src 下，pnpm 不为 link
 * 包安装 dependencies，且 plugin-src 解析不到 profile 的 node_modules。
 * 一旦 import 内核包就会在宿主加载阶段抛出 MODULE_NOT_FOUND，
 * 表现为「设置页整块消失」。
 *
 * defineTool 在上游只是把 spec 原样返回并做类型断言；DSH 注册工具时读取的是
 * 普通对象（name / description / parameters / output / execute），
 * 所以这里等价地原样返回即可。
 */

/**
 * @param {object} spec 工具定义。
 * @returns {object} 同一个对象（供 ctx.tools.register 使用）。
 */
export function defineTool(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new TypeError('defineTool: spec 必须是对象')
  }
  if (typeof spec.name !== 'string' || !spec.name) {
    throw new TypeError('defineTool: spec.name 必须是非空字符串')
  }
  if (spec.execute === undefined && spec.handler === undefined) {
    throw new TypeError(`defineTool: 工具 "${spec.name}" 缺少 execute`)
  }
  return spec
}
