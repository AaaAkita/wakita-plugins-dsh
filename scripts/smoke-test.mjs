/**
 * 安装前的本地冒烟测试：不依赖 DSH 运行时，直接验证规则、运行态数据和技能解析。
 *
 * 运行：node scripts/smoke-test.mjs
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createState } from '../bundles/wakita-governance-dsh/lib/state.mjs'
import { parseSkillFile } from '../bundles/wakita-toolkit-dsh/lib/skill-frontmatter.mjs'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const dataDir = join(repo, 'bundles', 'wakita-governance-dsh', 'data')
const stateDir = mkdtempSync(join(tmpdir(), 'wakita-dsh-smoke-'))
const state = createState({ stateDir, dataDir })

// ---- 危险命令规则
const blocked = [
  ['rm -rf /', '禁止递归删除根目录 /'],
  ['git push --force origin main', '禁止强制推送到 main/master 分支'],
  ['git reset --hard', 'git reset --hard 必须指定 commit，禁止裸重置'],
  ['DROP TABLE users', '禁止 DROP TABLE/DATABASE/SCHEMA'],
  ['TRUNCATE TABLE logs', '禁止 TRUNCATE TABLE'],
  ['chmod -R 777 /', '禁止对根目录递归 777'],
  ['mkfs.ext4 /dev/sda1', '禁止格式化文件系统（mkfs）'],
  [':(){ :|:& };:', '禁止 fork bomb'],
]
for (const [command, expected] of blocked) {
  assert.equal(state.matchDangerousCommand(command), expected, `应拦截: ${command}`)
}
for (const command of ['git status', 'npm run build', 'docker compose up -d', 'git push origin main']) {
  assert.equal(state.matchDangerousCommand(command), undefined, `不应拦截: ${command}`)
}
assert.equal(state.rules.dangerousCommands.length, 14, '危险命令规则数量应为 14')

// ---- 保护文件
for (const filePath of ['.env', '.env.local', 'config/.env.production', 'package-lock.json', '.git/config']) {
  assert.ok(state.findProtectedPath(filePath), `应保护: ${filePath}`)
}
for (const filePath of ['README.md', 'src/app.ts', 'docs/specs/x.md']) {
  assert.equal(state.findProtectedPath(filePath), undefined, `不应保护: ${filePath}`)
}

// ---- /lock 运行态
assert.equal(state.addProtectedFile('src/secret.md'), true)
assert.equal(state.findProtectedPath('src/secret.md'), 'src/secret.md')
assert.equal(state.addProtectedFile('src/secret.md'), false, '重复加锁应返回 false')
assert.equal(state.addProtectedFile('../escape.md'), false, '拒绝上级目录')
assert.equal(state.addProtectedFile('C:/abs.md'), false, '拒绝绝对路径')
assert.equal(state.addProtectedFile(''), false, '拒绝空路径')

// ---- 审计
state.appendAudit({ ts: 'test', tool: 'write', path: 'a.md' })
state.appendAudit({ ts: 'test', tool: 'pwsh', command: 'git status' })
assert.equal(state.readAudit(10).length, 2)
assert.equal(JSON.parse(state.readAudit(1)[0]).tool, 'pwsh')

// ---- 技能解析（toolkit 39 个 + governance 1 个）
function assertSkills(root) {
  let count = 0
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry)
    if (!statSync(dir).isDirectory()) continue
    const skill = parseSkillFile(join(dir, 'SKILL.md'))
    assert.ok(skill, `${entry}: 技能解析失败`)
    assert.match(skill.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${entry}: 名字不是 kebab-case`)
    assert.ok(skill.description.length > 5, `${entry}: 描述过短`)
    assert.ok(skill.content.trim().length > 0, `${entry}: 正文为空`)
    count += 1
  }
  return count
}

const toolkitSkills = assertSkills(join(repo, 'bundles', 'wakita-toolkit-dsh', 'skills'))
const governanceSkills = assertSkills(join(repo, 'bundles', 'wakita-governance-dsh', 'skills'))
assert.equal(toolkitSkills, 39, 'toolkit 应有 39 个技能')
assert.equal(governanceSkills, 1, 'governance 应有 1 个技能（using-wakita）')

const cleanHome = parseSkillFile(join(repo, 'bundles', 'wakita-toolkit-dsh', 'skills', 'clean-home', 'SKILL.md'))
assert.equal(cleanHome.name, 'clean-home')
assert.ok(cleanHome.whenToUse, 'clean-home 的 whenToUse 应被保留')

// ---- 角色正文
for (const role of ['scout', 'builder', 'auditor', 'ace']) {
  const text = readFileSync(join(repo, 'bundles', 'wakita-governance-dsh', 'roles', `${role}.md`), 'utf8')
  assert.ok(text.includes('<role>'), `${role}: 缺少 <role> 段`)
  assert.ok(text.includes('结果回传'), `${role}: 缺少结果回传协议`)
}

console.log('smoke test: OK')
