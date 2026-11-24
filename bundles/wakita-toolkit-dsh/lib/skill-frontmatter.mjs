/**
 * 极简 SKILL.md frontmatter 解析器（DSH 运行时注册用）。
 *
 * 支持：
 *   - 标量：`key: value`，去掉成对引号；
 *   - 折叠块：`description: >` / `>-`，续行以空格连接；
 *   - 字面块：`description: |` / `|-`，续行以换行连接。
 * 不支持嵌套映射/列表（当前 wakita 技能没有用到）。
 */

import { readFileSync } from 'node:fs'

const TRUE_VALUES = new Set(['true', 'yes', 'on', '1'])
const FALSE_VALUES = new Set(['false', 'no', 'off', '0'])
const BLOCK_HEADER = /^([>|])[+-]?[ \t]*$/

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const normalized = String(value).trim().toLowerCase()
  if (TRUE_VALUES.has(normalized)) return true
  if (FALSE_VALUES.has(normalized)) return false
  return fallback
}

function stripQuotes(value) {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

export function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(text)
  if (!match) return { data: {}, body: text }

  const lines = match[1].split(/\r?\n/)
  const data = {}

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim() || /^\s*#/.test(line)) continue
    const pair = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line)
    if (!pair) continue

    const key = pair[1]
    const rawValue = pair[2]
    const block = BLOCK_HEADER.exec(rawValue.trim())

    if (block || rawValue.trim() === '') {
      const parts = []
      while (index + 1 < lines.length) {
        const next = lines[index + 1]
        if (next.trim() !== '' && !/^[ \t]/.test(next)) break
        index += 1
        parts.push(next.trim())
      }
      while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
      const literal = block && block[1] === '|'
      data[key] = literal ? parts.join('\n').trim() : parts.join(' ').replace(/\s+/g, ' ').trim()
    } else {
      data[key] = stripQuotes(rawValue)
    }
  }

  return { data, body: text.slice(match[0].length) }
}

export function parseSkillFile(file) {
  const text = readFileSync(file, 'utf8')
  const { data, body } = parseFrontmatter(text)
  const name = (data.name ?? '').trim()
  const description = (data.description ?? '').trim()
  if (!name || !description) return undefined
  return {
    name,
    description,
    whenToUse: (data.whenToUse ?? '').trim() || undefined,
    disableModelInvocation: parseBoolean(data['disable-model-invocation'], false),
    userInvocable: parseBoolean(data['user-invocable'], true),
    content: body.replace(/^\s+/, ''),
  }
}
