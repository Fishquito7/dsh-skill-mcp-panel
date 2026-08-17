import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const server = new McpServer({ name: "fixture", version: "1.0.0" });
server.tool("hello", "Say hello", { name: z.string() }, async ({ name }) => ({ content: [{ type: "text", text: `hello ${name}` }] }));
await server.connect(new StdioServerTransport());
