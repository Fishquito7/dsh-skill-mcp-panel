# 使用示例（Examples）

本目录演示 `dsh-skill-viewer` 支持的两种技能文件格式，供你参考或直接拿来试手。

## 目录结构

```
examples/
├── README.md            # 本说明
├── hello-skill/         # 目录束格式示例（含顶层 SKILL.md）
│   └── SKILL.md
└── hello-skill-file.md  # 单文件格式示例
```

## 两种格式怎么选

| 格式 | 结构 | 适用场景 | 添加命令 |
|---|---|---|---|
| 单文件 | `<名字>.md` | 简单的纯指令技能 | `dsh-skill add hello-skill-file.md` |
| 目录束 | `<名字>/SKILL.md` | 需要附带 references/scripts/assets 等资源 | `dsh-skill add hello-skill` |

## 试手步骤

```bash
# 1. 添加目录束示例
dsh-skill add examples/hello-skill

# 2. 添加单文件示例
dsh-skill add examples/hello-skill-file.md

# 3. 确认都注册成功
dsh-skill list

# 4. 玩够了删掉（需确认）
dsh-skill delete hello-skill
dsh-skill delete hello-skill-file
```

> 提示：不合规的文件（缺少 frontmatter、`name` 不是 kebab-case 等）会被拒绝并提示原因——这两个示例都是合规的，可以故意改坏一个试试报错效果。
