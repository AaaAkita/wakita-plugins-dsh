/**
 * wakita-governance-dsh —— Host 插件入口。
 *
 * 把 ZCode 版的三类 hook 改写成 DSH 原生扩展点：
 *   - PreToolUse 危险拦截        -> ctx.tools.guard()（审批之后仍必达）
 *   - PostToolUse 写操作留痕     -> 'tools/result' 事件 -> $DSH_HOME/wakita/audit.log
 *   - UserPromptSubmit 工作规范  -> ctx.systemPrompt.section() 常驻系统提示
 * 另注册 /audit、/lock 两个原生斜杠命令，以及 using-wakita 技能。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseSkillFile } from './lib/skill-frontmatter.mjs'
import { createState, resolveStateDir } from './lib/state.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, 'data')

const SHELL_TOOLS = new Set(['bash', 'pwsh'])
const FILE_TOOLS = new Set(['write', 'edit'])
const PATCH_TOOLS = new Set(['apply_patch'])
const AUDITED_TOOLS = new Set(['bash', 'pwsh', 'write', 'edit', 'apply_patch'])
const PATCH_FILE_LINE = /^\*\*\*\s+(?:Add|Update|Delete)\s+File:\s*(.+?)\s*$/

export const inject = ['tools', 'systemPrompt', 'skills']

function toolArguments(execution) {
  const args = execution?.arguments
  return args && typeof args === 'object' ? args : {}
}

function collectTargetPaths(name, args) {
  const paths = []
  const filePath = typeof args.file_path === 'string' ? args.file_path.trim() : ''
  if (filePath) paths.push(filePath)

  if (PATCH_TOOLS.has(name) && typeof args.input === 'string') {
    for (const line of args.input.split(/\r?\n/)) {
      const match = PATCH_FILE_LINE.exec(line)
      if (match) paths.push(match[1].replace(/^["']|["']$/g, '').trim())
    }
  }
  return paths
}

function clampLines(raw, fallback = 50, max = 500) {
  const parsed = Number.parseInt(String(raw ?? '').trim(), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, 1), max)
}

function registerGuard(ctx, state) {
  ctx.tools.guard((execution) => {
    const name = execution?.name
    if (!name) return undefined
    const args = toolArguments(execution)

    if (SHELL_TOOLS.has(name)) {
      const command = typeof args.command === 'string' ? args.command : ''
      if (!command) return undefined
      const reason = state.matchDangerousCommand(command)
      return reason ? `🛑 [wakita 拦截] ${reason}` : undefined
    }

    if (FILE_TOOLS.has(name) || PATCH_TOOLS.has(name)) {
      for (const target of collectTargetPaths(name, args)) {
        const protectedEntry = state.findProtectedPath(target)
        if (protectedEntry) {
          const message = state.rules.protectedFileMsg.replace('{path}', protectedEntry)
          return `🛑 [wakita 拦截] ${message}`
        }
      }
    }

    return undefined
  })
}

function registerAudit(ctx, state) {
  ctx.on('tools/result', (execution, result) => {
    const name = execution?.name
    if (!AUDITED_TOOLS.has(name)) return
    const args = toolArguments(execution)
    const entry = { ts: new Date().toISOString(), tool: name }
    if (result?.isError) entry.error = true

    if (SHELL_TOOLS.has(name)) {
      const command = typeof args.command === 'string' ? args.command : ''
      entry.command = command.slice(0, 200)
      if (command.includes('git commit')) entry.summary = 'git-commit'
      else if (/^(rm|mv|cp|mkdir|touch|del|rmdir)\s/i.test(command)) entry.summary = 'fs-write'
    } else {
      const path = collectTargetPaths(name, args)[0]
      if (path) entry.path = path
      entry.summary = 'file-write'
    }

    state.appendAudit(entry)
  })
}

function registerNorms(ctx, promptData) {
  const text = String(promptData?.norms ?? '').trim()
  if (!text) return
  ctx.systemPrompt.section({
    name: 'wakita:work-norms',
    order: 1000,
    text,
    replacement: '[wakita] 工作规范已更新。',
    retirement: '[wakita] 工作规范不再生效。',
  })
}

function registerCommands(ctx, state) {
  const commands = ctx.get('commands')
  if (!commands) return

  commands.register({
    name: 'audit',
    description: '查看最近的 wakita 审计日志',
    input: { hint: '[行数，默认 50]' },
    handler: ({ rawInput }) => {
      const lines = state.readAudit(clampLines(rawInput))
      return {
        kind: 'success',
        text: lines.length > 0 ? lines.join('\n') : '暂无审计记录',
      }
    },
  })

  commands.register({
    name: 'lock',
    description: '把文件加入 wakita 保护清单，禁止后续写入',
    input: { hint: '<文件路径>' },
    handler: ({ rawInput }) => {
      const target = String(rawInput ?? '').trim()
      if (!target) return { kind: 'error', text: '用法：/lock <文件路径>' }
      const added = state.addProtectedFile(target)
      if (!added) {
        return {
          kind: 'success',
          text: `未新增：${target}（已在清单中，或路径不合法：只接受仓库内相对路径）`,
        }
      }
      return { kind: 'success', text: `已加锁：${target}` }
    },
  })
}

function registerUsingWakitaSkill(ctx) {
  const file = join(here, 'skills', 'using-wakita', 'SKILL.md')
  const skill = parseSkillFile(file)
  if (!skill) {
    ctx.logger?.warn?.('[wakita-governance] using-wakita 技能缺少 frontmatter，未注册')
    return
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
    resourceBase: { kind: 'directory', path: dirname(file) },
  })
}

export function apply(ctx) {
  const promptData = JSON.parse(readFileSync(join(dataDir, 'prompt.json'), 'utf8'))
  const state = createState({ stateDir: resolveStateDir(), dataDir })

  registerGuard(ctx, state)
  registerAudit(ctx, state)
  registerNorms(ctx, promptData)
  registerCommands(ctx, state)
  registerUsingWakitaSkill(ctx)

  ctx.logger?.info?.(
    `[wakita-governance] 已启用：拦截 + 审计(${state.auditLogPath}) + 规范 + 命令 + using-wakita`,
  )
}
