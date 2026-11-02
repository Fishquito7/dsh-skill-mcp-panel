# test/

所有测试都是**独立脚本**：没有测试框架、没有 `npm test`，直接用 `node` 跑。从仓库根目录：

```bash
# 全部跑一遍（串行，约 30 秒）
for f in test/test-*.mjs; do node "$f" || exit 1; done
```

单个：

```bash
node test/test-patch-editor.mjs
```

- `test-*.mjs` —— 回归测试，共 24 个；每个文件对应一次真实故障或一个功能面（文件头注释里写了背景）。
- `mcp-server-fixture.mjs` —— 最小 stdio MCP 服务器，`test-mcp-probe.mjs` 用它测「测试连接」。
- `mcp-preview-server.mjs` —— 10 个工具的本机预览服务器，手动在面板里注册时用；也给「单工具禁用」提供真实对象。

**注意**：上面两条 `mcp-*.mjs` 是夹具，不是测试——`mcp-preview-server.mjs` 会一直等待 MCP 握手，`mcp-server-fixture.mjs` 也会起服务器，所以循环里只跑 `test/test-*.mjs`。

这些文件**不进 npm 包**（`package.json` 的 `files` 只列 `lib` / `assets` / README / LICENSE / `cordis.patch.yml`），搬家只影响 GitHub 仓库结构。CI（`.github/workflows/publish-npm.yml`）目前只 build + publish，不跑测试；本地跑测试才生效。
