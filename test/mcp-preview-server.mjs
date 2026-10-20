/**
 * 预览用的本机 MCP 服务器（不进 npm 包，只在仓库里）。
 *
 * 目的：给面板的「工具」清单与「单工具禁用」提供一个真实、不依赖网络、
 * 可以随时杀掉重来的对象。十个工具（2026-10-20 从 4 个扩到 10 个，够在
 * 「禁用其中几个」的场景里看清工具表收缩），名字短、行为可预期：
 *   echo        —— 原样回显；
 *   add         —— 两个数相加；
 *   now         —— 当前时间；
 *   roll        —— 掷骰子；
 *   upper       —— 转大写；
 *   reverse     —— 反转字符串；
 *   wordCount   —— 统计词数；
 *   uuid        —— 生成一个 UUID；
 *   randomInt   —— 区间内随机整数；
 *   sha256      —— 文本的 SHA-256。
 *
 * 用法（面板里注册成 stdio 服务器）：
 *   command: node
 *   args:    <仓库绝对路径>/test/mcp-preview-server.mjs
 */
import { createHash, randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "preview", version: "1.1.0" });

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

server.tool("upper", "把文本转成大写", { text: z.string() }, async ({ text }) => ({
	content: [{ type: "text", text: String(text).toUpperCase() }]
}));

server.tool("reverse", "反转一段文本", { text: z.string() }, async ({ text }) => ({
	content: [{ type: "text", text: [...String(text)].reverse().join("") }]
}));

server.tool("wordCount", "统计文本的词数", { text: z.string() }, async ({ text }) => ({
	content: [{ type: "text", text: String(String(text).trim().split(/\s+/).filter(Boolean).length) }]
}));

server.tool("uuid", "生成一个 UUID v4", {}, async () => ({
	content: [{ type: "text", text: randomUUID() }]
}));

server.tool("randomInt", "返回区间内的随机整数", { min: z.number().int(), max: z.number().int() }, async ({ min, max }) => {
	const low = Math.min(min, max);
	const high = Math.max(min, max);
	return { content: [{ type: "text", text: String(low + Math.floor(Math.random() * (high - low + 1))) }] };
});

server.tool("sha256", "计算文本的 SHA-256", { text: z.string() }, async ({ text }) => ({
	content: [{ type: "text", text: createHash("sha256").update(String(text)).digest("hex") }]
}));

await server.connect(new StdioServerTransport());
