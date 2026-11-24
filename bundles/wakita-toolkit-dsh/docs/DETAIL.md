# Wakita toolkit（DSH 版）

把原 wakita-toolkit 的 39 个领域技能注册进 DSH，让所有会话的模型都能按需加载。

## 提供什么

- 39 个 `skills/<name>/SKILL.md`，覆盖：MySQL / Docker / 部署验证 / 迁移收敛 / 前端规范 / 代码审查 / 测试质量 / 打包 / 中文提交等。
- 技能按需加载：只有描述进入模型目录，正文在模型调用 `skill` 工具时才读取，不占常驻上下文。

## 与 ZCode 版的差异

| 项 | ZCode 版 | DSH 版 |
|---|---|---|
| 发现方式 | `.claude-plugin` 插件协议 | Host 插件在 `apply()` 中调用 `ctx.skills.register()` |
| frontmatter | `when_to_use`（下划线） | `whenToUse`（驼峰，DSH 只认这个） |
| 启停 | 插件开关 | 插件页开关（整包技能一起启停） |
| 路径 | 插件安装目录 | `import.meta.url` 自解析，随包版本一致 |

## 数据与行为

- 不写任何文件、不联网、不注入 prompt 文本。
- 技能正文里的 `references/`、`scripts/`、`assets/` 保持原样，注册时提供 `resourceBase` 目录，模型可以继续按路径读取这些资源。
- 技能名全部为 kebab-case，与 DSH 的校验规则一致。

## 验证

1. 安装后在**新会话**里问模型“你现在有哪些 skill”，应能看到 39 个。
2. 让它加载 `clean-home` 或 `mysql-expert`，应返回对应正文。
3. 在插件页禁用本 bundle 后，技能应从目录消失。
