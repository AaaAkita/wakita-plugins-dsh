# Wakita governance（DSH 版）

把 ZCode 版的「行为管控 + 子智能体」改写为 DSH 原生扩展点。

## 提供什么

| 能力 | 原 ZCode 实现 | DSH 实现 |
|---|---|---|
| 危险操作拦截 | PreToolUse hook（Python 子进程） | `ctx.tools.guard()`：同步、单调，在审批之后仍必达 |
| 写操作审计 | PostToolUse hook → `audit.log` | 监听 `tools/result` → `$DSH_HOME/wakita/audit.log` |
| 工作规范注入 | UserPromptSubmit hook 每条 prompt 注入 | `ctx.systemPrompt.section()` 常驻系统提示（只注入一次） |
| `/audit` | `commands/audit.md` 提示词 | `ctx.commands.register()` 原生命令 |
| `/lock` | `commands/lock.md` 提示词 | `ctx.commands.register()` 原生命令 |
| 4 个角色 | `~/.zcode/agents/*.md` | 4 个 agent preset + 4 个委派工具 |
| 模型注入脚本 | `inject-agent-model.py` | 不需要；改 patch 的 `agentOptions` 或 DSH 设置 |

## 拦截规则

来自 `hooks/rules.py` 的规则快照（`data/rules.json`，同步脚本生成）：

- 递归删除根目录 / 家目录 / 盘符根、`%USERPROFILE%`；
- 强推 `main`/`master`；
- 裸 `git reset --hard`；
- `DROP TABLE/DATABASE/SCHEMA`、`TRUNCATE TABLE`；
- `chmod -R 777 /`、`mkfs`、`dd of=/dev/*`、fork bomb；
- 受保护文件（`.env*`、lock 文件、`.git/config`、`.git/HEAD`、`.gitignore` 等）的 `write`/`edit`/`apply_patch`。

覆盖的 DSH 工具：`pwsh`、`bash`（命令参数 `command`）、`write`、`edit`（`file_path`）、`apply_patch`（补丁内的 `*** Add/Update/Delete File:` 行）。

## 运行数据

默认目录：`$DSH_HOME/wakita/`（可用环境变量覆盖）

| 文件 | 内容 | 覆盖变量 |
|---|---|---|
| `audit.log` | 每行一条 JSON：`ts` / `tool` / `summary` / `path` / `command` | `WAKITA_AUDIT_LOG` |
| `protected.json` | `/lock` 追加的保护清单 | `WAKITA_PROTECTED_FILE` |
| 目录本身 | 可用 `WAKITA_STATE_DIR` 整体改位置 | `WAKITA_STATE_DIR` |

写日志失败一律静默降级（fail-open），不阻塞工具调用。

## 命令

- `/audit [行数]`：读取 `audit.log` 最近 N 条（默认 50，上限 500）。
- `/lock <文件路径>`：把仓库内相对路径加入保护清单；下一条写入即被拦截。只接受相对路径，拒绝 `..` 与绝对路径。

## 子代理角色

| 工具 | preset | 工具集 | 用途 |
|---|---|---|---|
| `wakita_scout` | `wakita-scout` | 只读（read/glob/grep/pwsh 或 bash/todo_write/skill） | 编码前探索 |
| `wakita_builder` | `wakita-builder` | 读写（read/write/edit/…） | 按 Spec/Plan 实现 + 自验证 |
| `wakita_auditor` | `wakita-auditor` | 只读 | 代码审查，带文件:行号 |
| `wakita_ace` | `wakita-ace` | 只读 | 深水区 Bug 根因分析与最小变更方案 |

- 角色正文来自 `roles/*.md`（从 ZCode 模板生成，工具名已本地化）。
- 子代理继承父会话模型；要固定某角色模型，在 `cordis.patch.yml` 对应工具行加 `agentOptions`。
- 子代理会话延续用 `send_message` + 原子代理名（工具返回 `started subagent <name>`）。
- 「只读」是工具级裁剪，不是硬沙箱：DSH 的沙箱模式按会话解析，preset 层没有 read-only 开关。

## 已知差异 / 限制

1. DSH 没有 hook 进程协议：本插件是 Host 插件，不是 `hooks.json`；不要在 DSH 里装 ZCode 版插件。
2. `git commit` 中文提醒（原 PostToolUse 的 systemMessage）v0.1 未实现；工作规范里仍保留该要求。
3. UserPromptSubmit 的关键词提示（打包 / clean-home）v0.1 只保留常驻规范；动态提示留待后续用 `agent/pre-step` 实现。
4. `apply_patch` 只按补丁头里的文件路径做保护检查，不解析补丁语义。
