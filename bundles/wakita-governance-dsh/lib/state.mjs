/**
 * wakita 运行态数据：审计日志与保护清单。
 *
 * 数据目录优先级：
 *   WAKITA_STATE_DIR  >  $DSH_HOME/wakita  >  ~/.dsh/wakita
 *
 * 不放插件包目录：DSH 的本地目录安装是 link，但插件升级/重装/打包方式变化时
 * 包目录不保证是持久数据位置（ZCode/Codex 版曾因写入插件缓存副本而在升级后丢日志）。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

export function resolveStateDir() {
  if (process.env.WAKITA_STATE_DIR) return process.env.WAKITA_STATE_DIR
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(dshHome, 'wakita')
}

function ensureDir(dir) {
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* 目录创建失败时后续写入会各自降级 */
  }
}

function normalizePath(filePath) {
  return String(filePath).replace(/\\/g, '/').replace(/^\.\//, '')
}

function isSafeRelativePath(rawPath) {
  if (!rawPath) return false
  if (isAbsolute(rawPath) || /^[A-Za-z]:/.test(rawPath) || rawPath.startsWith('/')) return false
  const segments = rawPath.replace(/\\/g, '/').split('/').filter((segment) => segment && segment !== '.')
  if (segments.length === 0) return false
  return !segments.includes('..')
}

export function createState({ stateDir, dataDir }) {
  ensureDir(stateDir)

  const auditLogPath = process.env.WAKITA_AUDIT_LOG || join(stateDir, 'audit.log')
  const protectedFilePath = process.env.WAKITA_PROTECTED_FILE || join(stateDir, 'protected.json')

  const rules = JSON.parse(readFileSync(join(dataDir, 'rules.json'), 'utf8'))
  const compiledCommands = []
  for (const [pattern, reason] of rules.dangerousCommands ?? []) {
    try {
      compiledCommands.push({ regex: new RegExp(pattern, 'i'), reason })
    } catch {
      /* 单条规则编译失败只影响该规则，不影响插件加载 */
    }
  }

  let protectedCache
  let protectedCacheMtime = -1

  function readProtectedOverrides() {
    let mtime = -1
    try {
      mtime = statSync(protectedFilePath).mtimeMs
    } catch {
      mtime = -1
    }
    if (protectedCache !== undefined && mtime === protectedCacheMtime) return protectedCache
    protectedCacheMtime = mtime
    if (mtime === -1) {
      protectedCache = []
      return protectedCache
    }
    try {
      const parsed = JSON.parse(readFileSync(protectedFilePath, 'utf8'))
      protectedCache = Array.isArray(parsed?.protectedFiles) ? parsed.protectedFiles.filter(Boolean) : []
    } catch {
      protectedCache = []
    }
    return protectedCache
  }

  function loadProtectedFiles() {
    const merged = []
    const seen = new Set()
    for (const item of [...(rules.defaultProtectedFiles ?? []), ...readProtectedOverrides()]) {
      const normalized = normalizePath(item).trim()
      if (!normalized || seen.has(normalized)) continue
      seen.add(normalized)
      merged.push(normalized)
    }
    return merged
  }

  function persistProtectedOverrides(entries) {
    try {
      writeFileSync(
        protectedFilePath,
        `${JSON.stringify({ protectedFiles: entries }, null, 2)}\n`,
        'utf8',
      )
      protectedCache = entries
      try {
        protectedCacheMtime = statSync(protectedFilePath).mtimeMs
      } catch {
        protectedCacheMtime = -1
      }
      return true
    } catch {
      return false
    }
  }

  return {
    stateDir,
    auditLogPath,
    protectedFilePath,
    rules,

    matchDangerousCommand(command) {
      if (!command) return undefined
      for (const { regex, reason } of compiledCommands) {
        if (regex.test(command)) return reason
      }
      return undefined
    },

    findProtectedPath(filePath) {
      const normalized = normalizePath(filePath)
      if (!normalized) return undefined
      for (const candidate of loadProtectedFiles()) {
        if (normalized === candidate || normalized.endsWith(`/${candidate}`)) return candidate
      }
      return undefined
    },

    addProtectedFile(rawPath) {
      const cleaned = String(rawPath ?? '').trim().replace(/^["']|["']$/g, '')
      if (!isSafeRelativePath(cleaned)) return false
      const normalized = normalizePath(cleaned)
      const defaults = new Set((rules.defaultProtectedFiles ?? []).map(normalizePath))
      if (defaults.has(normalized)) return false
      const overrides = readProtectedOverrides()
      if (overrides.includes(normalized)) return false
      return persistProtectedOverrides([...overrides, normalized])
    },

    appendAudit(entry) {
      try {
        appendFileSync(auditLogPath, `${JSON.stringify(entry)}\n`, 'utf8')
      } catch {
        /* fail-open：写日志失败绝不能影响工具结果 */
      }
    },

    readAudit(limit = 50) {
      if (!existsSync(auditLogPath)) return []
      try {
        const lines = readFileSync(auditLogPath, 'utf8').split(/\r?\n/).filter(Boolean)
        return lines.slice(-limit)
      } catch {
        return []
      }
    },
  }
}
