# DSH 技能 / MCP 面板

dsh-skill-mcp-panel 是一个 DSH 插件：在侧栏面板和 `dsh-panel` 命令行里管理技能与 MCP 服务器。本文件只记录这个项目**独有**的说法；通用编程概念不进这里。

## Language

**技能包（skill bundle）**：
顶层含 `SKILL.md` 的目录；整棵树是**一个**技能，其余文件都是载荷。
_Avoid_: 目录束、技能文件夹、skill.md、目录型技能

**技能容器（skill container）**：
自身没有顶层 `SKILL.md`、直属子项是技能的目录；它只是选择的包装，本身不是技能。
_Avoid_: 技能根、父目录、分类目录、嵌套技能目录

**载荷文件（payload）**：
技能包里除顶层 `SKILL.md` 之外的一切——`references/`、`scripts/`、与 `SKILL.md` 平铺的依赖 .md、以及子目录里的 `SKILL.md`。
_Avoid_: 依赖 skill、参考技能、附属技能

**散装选择（loose selection）**：
一次选中的若干文件，彼此没有共同的文件夹层级；每个 `.md` 各自是一个单文件技能。
_Avoid_: 平铺 skill、裸文件、散装技能

**选择范围（selection）**：
一次添加操作里用户交出来的全部文件，被归一成一棵以顶层为根的虚拟目录树；技能包、技能容器、散装选择三种形态都由它判定。
_Avoid_: 上传根、来源目录、拖入内容

**添加入口（add entry point）**：
把技能交给插件的三种方式——单文件选择器、文件夹 / zip 选择器、拖放。同一份输入，任何入口都必须得出同一个结论。
_Avoid_: 上传方式、导入通道

**作用域（scope）**：
一个技能实体的归属位置——全局（用户根 `<dshHome>/skills`），或某个工作区（该项目根的 `.dsh/skills`）；同一工作区的 `.agents/skills` 与 `.dsh/skills` 属同一作用域。
_Avoid_: 位置、来源、profile

**受管块（managed block）**：
profile 的 `cordis.patch.yml` 里被 `dsh-skill-mcp-panel:mcp:begin` / `:end` 两条标记夹住的那一段。面板**新建**的 MCP 行追加在这里；已有的 MCP 行不论在不在块里都能就地改。它不是「能不能操作」的边界。
_Avoid_: 面板块、MCP 区块、标记区

**MCP 行（mcp-client row）**：
`name` 为 `@deepseek-ai/dsh-mcp-client` 的 patch 条目。面板对每一条都能启停、表单编辑、删除和原文编辑，不看 id 前缀、也不看它在不在受管块里（ADR-0006）。
_Avoid_: 受管行、外部行、外部管理

**外来行（foreign row）**：
受管块内**不是** MCP 客户端的条目（用户手写的别的插件、或其他工具写进去的）。面板必须**按读到的形状原样保留**：顶层条目仍是顶层条目（按 id 定向覆盖），`insert` 成员仍留在 insert 列表里（追加）。见 ADR-0003。
_Avoid_: 外部行、别人家的行、杂项条目

**预设（agent preset）**：
一份普通 cordis 插件列表（`@deepseek-ai/dsh-agent-preset` 的 `config.plugins`），决定一个会话能用哪些工具、技能来源与 MCP 服务器；会话按 id 选预设。
_Avoid_: 配置档、profile、模式、模板
