---
name: hello-skill-file
description: 演示用示例技能（单文件格式）——一个 .md 文件就是一个技能，无需目录
---

# Hello Skill File（单文件示例）

这是**单文件格式**的最小示例：一个 `<名字>.md` 文件就是一个完整的技能，适合纯指令类技能，不需要附带资源。

## 怎么用

1. 用 `dsh-skill add examples/hello-skill-file.md` 添加到 DSH
2. 在支持技能的 agent 会话里输入 `/hello-skill-file`，或在对话中提到本技能名

## 示例指令

- 模型收到本技能后，回复"你好，我是 hello-skill-file 单文件示例"，并说明单文件与目录束格式的区别。
