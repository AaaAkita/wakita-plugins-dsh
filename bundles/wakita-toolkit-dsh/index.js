/**
 * wakita-toolkit-dsh —— Host 插件入口。
 *
 * 把包内 `skills/<name>/SKILL.md` 全部注册到 DSH 的 `ctx.skills` 注册表。
 * 技能正文随插件安装/卸载，技能根路径由 import.meta.url 自解析，不依赖绝对路径。
 */

import { readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseSkillFile } from './lib/skill-frontmatter.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const SKILLS_DIR = join(here, 'skills')
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const inject = ['skills']

function warn(ctx, message) {
  ctx.logger?.warn?.(`[wakita-toolkit] ${message}`)
}

export function apply(ctx) {
  const registered = []
  const skipped = []

  for (const entry of readdirSync(SKILLS_DIR).sort()) {
    const dir = join(SKILLS_DIR, entry)
    let isDir = false
    try {
      isDir = statSync(dir).isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue

    const file = join(dir, 'SKILL.md')
    let skill
    try {
      skill = parseSkillFile(file)
    } catch (error) {
      skipped.push(`${entry}: ${error?.message ?? error}`)
      continue
    }
    if (!skill) {
      skipped.push(`${entry}: 缺少 name 或 description`)
      continue
    }
    if (!SKILL_NAME.test(skill.name)) {
      skipped.push(`${entry}: 技能名不是 kebab-case（${skill.name}）`)
      continue
    }

    ctx.skills.register({
      name: skill.name,
      description: skill.description,
      ...(skill.whenToUse ? { whenToUse: skill.whenToUse } : {}),
      content: skill.content,
      path: file,
      source: 'runtime',
      invocation: {
        modelInvocable: !skill.disableModelInvocation,
        userInvocable: skill.userInvocable,
      },
      resourceBase: { kind: 'directory', path: dir },
    })
    registered.push(skill.name)
  }

  for (const message of skipped) warn(ctx, `跳过技能 ${message}`)
  ctx.logger?.info?.(`[wakita-toolkit] 已注册 ${registered.length} 个技能`)
}
