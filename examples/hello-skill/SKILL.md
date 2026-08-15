---
name: hello-skill
description: 演示用示例技能（目录束格式）——用最简指令展示 dsh-skill-viewer 的 bundle 结构
---

# Hello Skill（目录束示例）

这是一个**目录束格式**（bundle）的最小示例：技能正文就是本文件，目录里还可以放 `references/`、`scripts/`、`assets/` 等资源目录，随技能一起被加载。

## 怎么用

1. 用 `dsh-skill add examples/hello-skill` 添加到 DSH
2. 在支持技能的 agent 会话里输入 `/hello-skill`，或在对话中提到本技能名

## 示例指令

- 模型收到本技能后，按这里的要求行事：回复"你好，我是 hello-skill 目录束示例"，并顺带列出当前会话可用的技能清单。
