#!/usr/bin/env python3
"""从 wakita-plugins（ZCode/Codex 版）同步内容到 DSH 专用版。

同步内容：
  1. wakita-toolkit 的 39 个 skill  -> bundles/wakita-toolkit-dsh/skills/
     - frontmatter `when_to_use:` -> `whenToUse:`
  2. wakita-governance 的 using-wakita skill -> bundles/wakita-governance-dsh/skills/using-wakita/
     - 正文按 DSH 环境改写（工具名、子代理延续、模型切换、环境说明）
  3. 4 个角色模板 -> bundles/wakita-governance-dsh/roles/*.md
     - 去掉 ZCode frontmatter，工具名替换为 DSH 工具名
  4. hooks/rules.py 的危险命令/保护清单 -> bundles/wakita-governance-dsh/data/rules.json
  5. hooks/wakita-userpromptsubmit.py 的工作规范与关键词提示 -> .../data/prompt.json
  6. 图标 -> 两个 bundle 的 icon.png

用法（在仓库根目录或任意目录）：
  python scripts/sync_from_zcode.py
环境变量：
  WAKITA_ZCODE_ROOT  源仓库路径，默认 <repo>/../wakita-plugins
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC = Path(os.environ.get("WAKITA_ZCODE_ROOT", REPO.parent / "wakita-plugins")).resolve()

GOV = REPO / "bundles" / "wakita-governance-dsh"
TOOLKIT = REPO / "bundles" / "wakita-toolkit-dsh"

# ---------------------------------------------------------------- helpers


def die(msg: str) -> None:
    print(f"[sync] ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        die(f"无法加载模块: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


def copy_tree(src: Path, dst: Path) -> None:
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)


def replace_all(text: str, pairs: list[tuple[str, str]]) -> str:
    for old, new in pairs:
        if old not in text:
            print(f"[sync]   WARN 未命中替换: {old[:60]!r}")
        text = text.replace(old, new)
    return text

# ---------------------------------------------------------------- toolkit skills

TOOLKIT_BODY_REPLACEMENTS: list[tuple[str, str]] = [
    # 目前 toolkit 正文没有 ZCode 专有工具名；保留占位以便后续维护
]


def sync_toolkit_skills() -> int:
    src = SRC / "plugins" / "wakita-toolkit" / "skills"
    dst_root = TOOLKIT / "skills"
    if not src.is_dir():
        die(f"找不到 toolkit skills: {src}")
    dst_root.mkdir(parents=True, exist_ok=True)

    count = 0
    for skill_dir in sorted(p for p in src.iterdir() if p.is_dir()):
        if not (skill_dir / "SKILL.md").is_file():
            continue
        dst = dst_root / skill_dir.name
        copy_tree(skill_dir, dst)
        md = dst / "SKILL.md"
        text = md.read_text(encoding="utf-8")
        # DSH 只认驼峰 whenToUse
        text = re.sub(r"(?m)^when_to_use:", "whenToUse:", text)
        text = replace_all(text, TOOLKIT_BODY_REPLACEMENTS)
        md.write_text(text, encoding="utf-8")
        count += 1
    print(f"[sync] toolkit skills: {count}")
    return count

# ---------------------------------------------------------------- using-wakita

USING_WAKITA_REPLACEMENTS: list[tuple[str, str]] = [
    (
        "**两条线**：spec（`docs/specs/`，留档） + plan（EnterPlanMode，一次性执行文件）。",
        "**两条线**：spec（`docs/specs/`，留档） + plan（DSH Plan 模式，一次性执行文件）。",
    ),
    (
        "→ Plan：大任务必走 EnterPlanMode，中任务可选，小任务不走",
        "→ Plan：大任务必走 DSH Plan 模式（`/plan`），中任务可选，小任务不走",
    ),
    ("## 第五步：Plan（EnterPlanMode）", "## 第五步：Plan（DSH Plan 模式）"),
    ("4. **大任务走 Plan**。不跳 EnterPlanMode。", "4. **大任务走 Plan**。不跳 DSH Plan 模式。"),
    (
        "| **小** | MasterAgent直接 Read/Edit/Write → 自检。触发高风险集合 → 至少过 auditor |",
        "| **小** | MasterAgent 直接 read/edit/write → 自检。触发高风险集合 → 至少过 auditor |",
    ),
    (
        """```markdown
派 wakita-scout 探索 xxx，定位相关文件+调用链，输出带文件:行号的报告

派 wakita-builder 按以下 Plan 实现：
[改动文件/行号/目标代码/验证命令]

派 wakita-auditor 审查最近改动，对照项目规范

派 wakita-ace 攻坚 xxx：现象=...，已尝试=...，证据=...，要求输出根因+最小变更方案
```""",
        """DSH 里四个角色是四个工具（spawn 子代理，各自带独立 preset）：

```text
wakita_scout    { description, prompt }   # 只读探索，输出带文件:行号的报告
wakita_builder  { description, prompt }   # 按 Plan 实现 + 自验证
wakita_auditor  { description, prompt }   # 代码审查，对照项目规范
wakita_ace      { description, prompt }   # 攻坚：现象+已尝试+证据，输出根因+最小变更方案
```

调用示例：`wakita_scout(description="探索 cookie 处理链路", prompt="定位所有处理 Cookie 的代码路径…")`。""",
    ),
    (
        "**同一任务、同一阶段、同一角色，必须延续已有子会话，禁止重新新开。**",
        "**同一任务、同一阶段、同一角色，必须延续已有子会话，禁止重新新开。**",
    ),
    (
        "- ZCode 用 `SendMessage` 带原 `agentId` 继续；Codex 用其 multi-agent 的 resume/继续能力。\n- 主智能体在调度后**必须记下每个子智能体的 `agentId`**（记在阶段性总结或 Plan 里），下次追加指令、补充证据、追问结论时直接复用。",
        "- DSH 用 `send_message` 带原**子代理名**继续（工具返回 `started subagent <name>`，名字如 `agent-1`）。\n- 主智能体在调度后**必须记下每个子智能体的名字**（记在阶段性总结或 Plan 里），下次追加指令、补充证据、追问结论时直接复用。",
    ),
    (
        "2. 原子会话不可用（会话被清理、agent 文件被删除或重生成）",
        "2. 原子会话不可用（会话被清理、子代理已结束且无法恢复）",
    ),
    (
        "10. **同阶段复用子会话**：同一任务/阶段/角色必须用 `SendMessage` + 原 `agentId` 延续，禁止无理由新开；新开需说明原因（贵模型重开会丢失缓存，成本高）。",
        "10. **同阶段复用子会话**：同一任务/阶段/角色必须用 `send_message` + 原子代理名延续，禁止无理由新开；新开需说明原因（贵模型重开会丢失缓存，成本高）。",
    ),
]

# 整段替换：模型切换 + Codex 环境 -> DSH 环境
MODEL_AND_ENV_SECTION = """## 模型切换（DSH）

四个角色 preset 随 `wakita-governance-dsh` 插件安装，**不需要生成任何用户级 agent 文件**。

- 想换某个角色的模型/思考强度：改插件 patch 里对应委派工具行的 `agentOptions`（`provider` / `model` / `reasoningEffort`），或直接删掉该字段让子代理继承父会话路由。
- 想换推理强度：在 DSH 的 Agent 设置里改父会话模型即可；子代理未显式配置时跟随父会话。
- 角色工具名固定：`wakita_scout` / `wakita_builder` / `wakita_auditor` / `wakita_ace`。

## DSH 环境

本工作流运行在 **DSH**（DeepSeek Harness）上，与 ZCode / Codex 版的差异只有传输层，分级与调度流程不变：

1. **角色调遣**：用 `wakita_scout` / `wakita_builder` / `wakita_auditor` / `wakita_ace` 四个工具（spawn 子代理，各自独立 preset）。
2. **子会话延续**：用 `send_message` 带原子代理名，而不是 `SendMessage` + `agentId`。
3. **命令**：`/audit`（审计日志）与 `/lock`（保护清单）是 DSH 原生斜杠命令，由插件注册；`/subagent-create` 不存在——角色已随插件安装。
4. **拦截与留痕**：危险命令拦截、写操作审计由 Host 插件实现（`tools.guard` + `tools/result`），运行数据在 `$DSH_HOME/wakita/`。
5. **Plan**：DSH 用 Plan 模式（`/plan` 或 `exit_plan_mode`），不是 `EnterPlanMode`。
6. **工具名**：Windows 上是 `pwsh` 而不是 `Bash`；读写文件用 `read` / `write` / `edit`。"""


def sync_using_wakita() -> None:
    src = SRC / "plugins" / "wakita-governance" / "skills" / "using-wakita" / "SKILL.md"
    text = src.read_text(encoding="utf-8")
    text = replace_all(text, USING_WAKITA_REPLACEMENTS)

    start = text.find("## 模型切换")
    end = text.find("## 验证工具")
    if start == -1 or end == -1 or end < start:
        die("using-wakita: 找不到「模型切换/验证工具」段落，源文件结构可能已变化")
    text = text[:start] + MODEL_AND_ENV_SECTION + "\n\n---\n\n" + text[end:]

    dst = GOV / "skills" / "using-wakita"
    dst.mkdir(parents=True, exist_ok=True)
    (dst / "SKILL.md").write_text(text, encoding="utf-8")
    print("[sync] using-wakita: 已改写")

# ---------------------------------------------------------------- roles

ROLE_TOOL_REPLACEMENTS: list[tuple[str, str]] = [
    ("Read/Glob/Grep/Bash/TodoWrite", "read / glob / grep / pwsh（Windows）/ bash（POSIX）/ todo_write"),
    ("Read/Write/Edit/Glob/Grep/Bash/TodoWrite", "read / write / edit / glob / grep / pwsh（Windows）/ bash（POSIX）/ todo_write"),
]

# 短语替换后再按整词替换残留的工具名（如 "用 Glob 找…"、"先 Read 目标文件"）
ROLE_WORD_REPLACEMENTS: list[tuple[str, str]] = [
    (r"\bTodoWrite\b", "todo_write"),
    (r"\bGlob\b", "glob"),
    (r"\bGrep\b", "grep"),
    (r"\bRead\b", "read"),
    (r"\bEdit\b", "edit"),
    (r"\bWrite\b", "write"),
    (r"\bBash\b", "pwsh（Windows）/bash（POSIX）"),
]


def sync_roles() -> int:
    src_dir = SRC / "plugins" / "wakita-governance" / "templates" / "agents"
    dst_dir = GOV / "roles"
    if dst_dir.exists():
        shutil.rmtree(dst_dir)
    dst_dir.mkdir(parents=True, exist_ok=True)

    count = 0
    for md in sorted(src_dir.glob("wakita-*.md")):
        text = md.read_text(encoding="utf-8")
        fm = re.match(r"^---\r?\n.*?\r?\n---\r?\n?", text, re.S)
        body = text[fm.end():] if fm else text
        body = replace_all(body, ROLE_TOOL_REPLACEMENTS)
        for pattern, replacement in ROLE_WORD_REPLACEMENTS:
            body = re.sub(pattern, replacement, body)
        header = (
            f"<!-- 由 scripts/sync_from_zcode.py 从 wakita-plugins 的 "
            f"templates/agents/{md.name} 生成；DSH 下工具名已本地化。 -->\n\n"
        )
        role_name = md.stem.removeprefix("wakita-")
        (dst_dir / f"{role_name}.md").write_text(header + body, encoding="utf-8")
        count += 1
    print(f"[sync] roles: {count}")
    return count

# ---------------------------------------------------------------- data

def sync_data() -> None:
    data_dir = GOV / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    rules = load_module(SRC / "plugins" / "wakita-governance" / "hooks" / "rules.py", "wakita_rules")
    rules_json = {
        "dangerousCommands": [[pattern, reason] for pattern, reason in rules.DANGEROUS_COMMANDS],
        "defaultProtectedFiles": list(rules.DEFAULT_PROTECTED_FILES),
        "protectedFileMsg": rules.PROTECTED_FILE_MSG,
    }
    (data_dir / "rules.json").write_text(
        json.dumps(rules_json, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"[sync] rules.json: {len(rules_json['dangerousCommands'])} 条危险命令")

    prompt = load_module(
        SRC / "plugins" / "wakita-governance" / "hooks" / "wakita-userpromptsubmit.py",
        "wakita_prompt",
    )
    prompt_json = {
        "norms": prompt._NORMS,
        "hints": [
            {
                "id": "packaging",
                "keywords": list(prompt._PACK_KEYWORDS),
                "text": prompt._PACK_HINT,
            },
            {
                "id": "clean-home",
                "keywords": list(prompt._REVIEW_KEYWORDS),
                "text": prompt._REVIEW_HINT,
            },
        ],
    }
    (data_dir / "prompt.json").write_text(
        json.dumps(prompt_json, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"[sync] prompt.json: {len(prompt_json['hints'])} 组关键词提示")

# ---------------------------------------------------------------- icons

def sync_icons() -> None:
    pairs = [
        (SRC / "plugins" / "wakita-governance" / "assets" / "icon.png", GOV / "icon.png"),
        (SRC / "plugins" / "wakita-toolkit" / "assets" / "icon.png", TOOLKIT / "icon.png"),
    ]
    for src, dst in pairs:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        print(f"[sync] icon -> {dst.relative_to(REPO)} ({dst.stat().st_size} bytes)")


def main() -> None:
    if not SRC.is_dir():
        die(f"源仓库不存在: {SRC}")
    print(f"[sync] 源: {SRC}")
    print(f"[sync] 目标: {REPO}")
    sync_toolkit_skills()
    sync_using_wakita()
    sync_roles()
    sync_data()
    sync_icons()
    print("[sync] 完成")


if __name__ == "__main__":
    main()
