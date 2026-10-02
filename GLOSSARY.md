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
