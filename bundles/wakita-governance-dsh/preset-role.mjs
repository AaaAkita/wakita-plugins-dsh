/**
 * preset-role —— 子代理角色 preset 的 persona 行。
 *
 * 每个角色 preset 挂一行：
 *   - id: persona
 *     name: wakita-governance-dsh/preset-role
 *     config: { role: scout }
 *
 * 角色正文放在包内 roles/<role>.md（由 scripts/sync_from_zcode.py 从 ZCode 模板生成），
 * 以 `deployment:persona-prefix` section 注册到该 preset 的作用域，等价于 @deepseek-ai/dsh-persona 的 prefix。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROLE_PATTERN = /^[a-z0-9-]+$/

export const inject = ['systemPrompt']

export function apply(ctx, config) {
  const role = typeof config?.role === 'string' ? config.role.trim() : ''
  if (!ROLE_PATTERN.test(role)) {
    throw new Error(`wakita preset-role: config.role 非法（${JSON.stringify(config?.role)}）`)
  }

  const text = readFileSync(join(here, 'roles', `${role}.md`), 'utf8').trim()
  if (!text) throw new Error(`wakita preset-role: roles/${role}.md 为空`)

  ctx.systemPrompt.section({
    name: 'deployment:persona-prefix',
    order: 0,
    text,
    interpolate: false,
    replacement: '[wakita] 角色设定已更新。',
    retirement: '[wakita] 角色设定不再生效。',
  })

  ctx.logger?.info?.(`[wakita-role] 已注册角色设定: ${role}`)
}
