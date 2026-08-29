import { copyFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const developmentVars = resolve(projectRoot, "apps/cloudflare/.dev.vars");
const exampleVars = resolve(projectRoot, "apps/cloudflare/.dev.vars.example");
const createdTemporaryVars = !existsSync(developmentVars);

if (createdTemporaryVars) copyFileSync(exampleVars, developmentVars);

try {
  const wranglerCli = resolve(projectRoot, "node_modules/wrangler/bin/wrangler.js");
  const argumentsList = [
    wranglerCli,
    "types",
    ...(process.argv.includes("--check") ? ["--check"] : []),
    "--include-runtime",
    "false",
    "--config",
    "apps/cloudflare/wrangler.jsonc",
    "apps/cloudflare/worker-configuration.d.ts"
  ];
  const result = spawnSync(process.execPath, argumentsList, {
    cwd: projectRoot,
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (createdTemporaryVars) rmSync(developmentVars, { force: true });
}
