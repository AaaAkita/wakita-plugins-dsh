# wakita-plugins-dsh

wakita 插件的 **DSH（DeepSeek Harness）专用版本**。

原仓库 [wakita-plugins](../wakita-plugins) 面向 ZCode / Codex，靠 `hooks.json` + Python hook 脚本 + `~/.zcode/agents/` 实现管控与子智能体。DSH 的插件协议完全不同（没有 hook 进程协议），所以这里不是「换皮」，而是**把同一套能力用 DSH 原生扩展点重写**。

## 两个 bundle

| 目录 | 包名 | 作用 |
|---|---|---|
| `bundles/wakita-governance-dsh` | `wakita-governance-dsh` | 危险操作拦截、写操作审计、工作规范注入、`/audit`、`/lock`、`using-wakita` 技能、4 个角色 preset + 4 个委派工具 |
| `bundles/wakita-toolkit-dsh` | `wakita-toolkit-dsh` | 39 个领域技能，注册进 DSH 技能目录 |

## 安装

前置：DSH `0.2.3-alpha.2`（`engines.dsh` 已锁 `^0.2.3-alpha.2`）。本地目录安装需要 Full access 或审批。

1. 打开 DSH → **Plugins**（插件）→ **Add plugin**（添加插件）
2. 选择 `bundles/wakita-governance-dsh` 目录，安装并启用
3. 同样方式安装 `bundles/wakita-toolkit-dsh`
4. 安装后检查插件页有两条记录、图标/标题/描述正常

也可以用 `plugin_manager` 工具安装（target 传上面两个目录的绝对路径）。

本地目录安装是 **link** 模式：改文件后，在插件页对对应行执行一次启用/重载即可生效；升级 = 重装。

## 装完后怎么验证

1. **插件页**：两个 bundle 行 `enabled`，无失败诊断。
2. **技能**：新会话里模型能看到 39 个 wakita 技能；加载 `clean-home` 返回正文。
3. **危险拦截**：让模型执行 `git push --force origin main` 或读写 `.env`，应被拒绝，提示带 `[wakita 拦截]`。
4. **审计**：任意 write/edit/pwsh 调用后，`$DSH_HOME/wakita/audit.log`（默认 `C:\Users\<你>\.dsh\wakita\audit.log`）新增一行 JSON。
5. **命令**：`/audit`、`/lock` 出现在斜杠命令列表并可用。
6. **角色**：工具列表出现 `wakita_scout` / `wakita_builder` / `wakita_auditor` / `wakita_ace`；`wakita_scout` 的子会话没有 write/edit 工具。

## 为什么 DSH 没有 hook

> 这是「设计选择」，不是「功能缺失」。

- **ZCode / Codex 的 hook** 是外部进程协议：宿主在工具调用前后，把 JSON 从 stdin 喂给一段 shell/Python 命令，读 stdout 的 JSON 决定放行/拦截。它简单通用，但每个 hook 都是独立进程：慢（每次几十到几百毫秒）、拿不到 UI 状态、无法感知同一进程里的业务对象。
- **DSH 的扩展模型**是「Cordis 插件」：插件在 Host 进程内注册到具体的扩展点，用类型化服务/事件拿数据。工具管道是 `tools/pre-execute`（可改写/询问）→ `ctx.tools.guard()`（单调拒绝，审批后仍必达）→ `tools/execute` → `tools/post-execute` → `tools/result`（只读观察）。提示词、命令、技能、子代理也各有服务（`systemPrompt`、`commands`、`skills`、`subagents`/`agentPresets`）。
- 所以 DSH 里没有名为 "hook" 的东西，但有**等价甚至更强的替代**：拦截用 guard，留痕用 `tools/result`，规范注入用 `systemPrompt.section`，命令用 `commands.register`。本仓库就是把 ZCode 的三类 hook 逐条映射过去的产物。
- 另外，DSH 的发行包里确实存在一个 **兼容桥**（`@deepseek-ai/dsh-hooks-claude-code`，experimental，用来跑 Claude Code 的 `hooks.json`），但它不在当前 Desktop 发行版中（本机安装包里没有该包目录），所以不能依赖它。即使有，也建议用原生插件：更快、可拿上下文、能被插件页统一启停。
- 一句话：**ZCode 用「外挂进程」扩展，DSH 用「进程内插件」扩展**。外挂进程那套在 DSH 里没有对应实现，因为 DSH 把每个扩展点都做成了带类型的服务。

## 目录结构

```
wakita-plugins-dsh/
├── bundles/
│   ├── wakita-governance-dsh/
│   │   ├── package.json          # dsh.bundle.patch + engines.dsh
│   │   ├── cordis.patch.yml      # Host 插件 + 4 preset + 4 委派工具
│   │   ├── index.js              # guard / 审计 / 规范 / 命令 / using-wakita
│   │   ├── preset-role.mjs       # 角色 preset 的 persona 行
│   │   ├── lib/                  # frontmatter 解析、运行态数据
│   │   ├── data/                 # rules.json、prompt.json（脚本生成）
│   │   ├── roles/                # 4 个角色正文（脚本生成）
│   │   ├── skills/using-wakita/
│   │   ├── locale/               # 插件页标题/描述
│   │   ├── docs/DETAIL.md
│   │   └── icon.png
│   └── wakita-toolkit-dsh/
│       ├── package.json
│       ├── cordis.patch.yml
│       ├── index.js              # ctx.skills.register() × 39
│       ├── lib/skill-frontmatter.mjs
│       ├── skills/               # 39 个技能（脚本生成）
│       ├── locale/
│       ├── docs/DETAIL.md
│       └── icon.png
├── scripts/sync_from_zcode.py    # 从原仓库同步技能/角色/规则
└── README.md
```

## 与原仓库的关系

- **内容单一事实源**仍是原仓库：技能正文、角色正文、危险命令规则都由 `scripts/sync_from_zcode.py` 生成到这里。
- 原仓库文件可以继续按 ZCode / Codex 方式维护；改完跑一次同步脚本即可同步到 DSH 版（改完记得重载插件）。
- 同步时做的转换：`when_to_use` → `whenToUse`；角色正文工具名本地化（`Read/Glob/Grep/Bash/TodoWrite` → `read/glob/grep/pwsh/bash/todo_write`）；`using-wakita` 的 ZCode/Codex 章节替换为 DSH 章节。

```bash
# 默认读取 ../wakita-plugins，可用环境变量覆盖源路径
python scripts/sync_from_zcode.py
```

## 已知限制

- 角色「只读」是工具级裁剪（不注册 write/edit），不是硬沙箱；DSH 沙箱模式按会话解析，preset 层没有 read-only 开关。
- `git commit` 中文提醒（原 PostToolUse）v0.1 未实现；工作规范中保留要求。
- UserPromptSubmit 的关键词提示（打包 / clean-home）v0.1 只保留常驻规范，动态提示待后续用 `agent/pre-step` 实现。
- 委派工具在 Host 层注册，对所有会话可见（等价 ZCode 的全局 agent 列表）；会占用 4 个工具条目的上下文。
- `apply_patch` 只按补丁头里的文件路径做保护检查，不解析补丁语义。

## 已验证（2026-11-23，本机 DSH 0.2.3-alpha.2）

| 验证项 | 结果 |
|---|---|
| 危险命令拦截 | `git push --force origin main` 被拒绝，提示 `🛑 [wakita 拦截] 禁止强制推送到 main/master 分支` |
| 保护文件 | 写 `.env` 被拒绝：`该文件受 wakita-governance 保护` |
| 锁定清单生效 | 向 `protected.json` 写入 `docs/lock-test.md` 后，写该文件立即被拒 |
| 审计日志 | `$DSH_HOME/wakita/audit.log` 记录 write / pwsh；被拒调用额外带 `"error": true` |
| 工作规范 | 会话系统提示出现 `[wakita 工作规范]` |
| 技能注册 | 39 + 1（using-wakita）个技能进入会话目录，`skill` 工具可加载，资源基路径指向包内技能目录 |
| 子代理角色 | `wakita_scout` 启动成功；子会话无 write/edit 工具，按结果回传协议返回 `success` |

未在本会话验证：`/audit`、`/lock` 的 UI 执行（需要在对话框手工敲一次）、插件页图标与详情页渲染（需要你在 GUI 里确认）。

> 说明：`audit.log` 里会留有本次验证产生的记录，属正常测试数据，可忽略。

## 维护提示

- 当前 DSH 版本里 `@deepseek-ai/dsh-tool-fs-search` 的 `sampleOverCapGlobResults` 与 `@deepseek-ai/dsh-tool-todo` 的 `allowParallelInProgress` 是**必填** Config，改 preset 时不要丢，否则子代理 preset 激活失败。
- 改完代码/角色/技能后，用 `plugin_manager` 的 `set_bundle`（`enabled: true`）对对应 bundle 触发重组，或在插件页重载；本地目录安装是 link，不需要重装。
- 卸载：在插件页删除两个 bundle 即可；`$DSH_HOME/wakita/` 下的运行数据可保留（重装后继续使用）或手动删除。

