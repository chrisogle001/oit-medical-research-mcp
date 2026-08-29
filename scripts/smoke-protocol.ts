import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { resolve } from "node:path";

const serverPath = resolve("dist/oit-medical-research-mcp.js");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  stderr: "pipe"
});
const client = new Client({ name: "oit-medical-research-smoke-test", version: "0.1.0" });
let serverError = "";
transport.stderr?.on("data", (chunk) => {
  serverError += String(chunk);
});

try {
  await client.connect(transport).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}${serverError ? `\nServer stderr:\n${serverError}` : ""}`);
  });
  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name).sort();
  if (names.join(",") !== "fetch,search") {
    throw new Error(`Unexpected tool catalog: ${names.join(", ")}`);
  }
  console.log(JSON.stringify({ protocol: "connected", tools: names }, null, 2));
} finally {
  await client.close();
}
