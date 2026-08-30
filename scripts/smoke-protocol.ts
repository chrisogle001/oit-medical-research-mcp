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
  const searchTool = tools.tools.find((tool) => tool.name === "search");
  const searchProperties = (searchTool?.inputSchema as { properties?: Record<string, unknown> } | undefined)
    ?.properties;
  const expectedSearchInputs = ["fromYear", "fullTextOnly", "journals", "limit", "query", "toYear"];
  if (Object.keys(searchProperties ?? {}).sort().join(",") !== expectedSearchInputs.join(",")) {
    throw new Error("The search tool did not advertise the expected structured-filter inputs.");
  }
  const fromYearSchema = searchProperties?.fromYear as { maximum?: number; minimum?: number } | undefined;
  if (fromYearSchema?.minimum !== 1800 || fromYearSchema.maximum !== 2100) {
    throw new Error("The search tool advertised an unstable publication-year range.");
  }
  console.log(
    JSON.stringify(
      { protocol: "connected", tools: names, searchInputs: expectedSearchInputs },
      null,
      2
    )
  );
} finally {
  await client.close();
}
