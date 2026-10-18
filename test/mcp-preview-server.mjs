/**
 * 预览用的本机 MCP 服务器（不进 npm 包，只在仓库里）。
 *
 * 目的：给面板的「工具」清单与「单工具禁用」提供一个真实、不依赖网络、
 * 可以随时杀掉重来的对象。四个工具，名字短、行为可预期：
 *   echo  —— 原样回显；
 *   add   —— 两个数相加；
 *   now   —— 当前时间；
 *   roll  —— 掷骰子。
 *
 * 用法（面板里注册成 stdio 服务器）：
 *   command: node
 *   args:    <仓库绝对路径>/test/mcp-preview-server.mjs
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "preview", version: "1.0.0" });

server.tool("echo", "原样回显一段文本", { text: z.string() }, async ({ text }) => ({
	content: [{ type: "text", text: String(text) }]
}));

server.tool("add", "两个数相加", { a: z.number(), b: z.number() }, async ({ a, b }) => ({
	content: [{ type: "text", text: String(a + b) }]
}));

server.tool("now", "返回当前时间（ISO 8601）", {}, async () => ({
	content: [{ type: "text", text: new Date().toISOString() }]
}));

server.tool("roll", "掷一个 N 面骰子", { sides: z.number().default(6) }, async ({ sides }) => ({
	content: [{ type: "text", text: String(1 + Math.floor(Math.random() * sides)) }]
}));

await server.connect(new StdioServerTransport());
