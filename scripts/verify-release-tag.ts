import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { version?: string };
const tag = process.env.GITHUB_REF_NAME || process.argv[2];
const expected = `v${packageJson.version}`;

if (!tag) throw new Error("Provide a release tag or set GITHUB_REF_NAME.");
if (tag !== expected) {
  throw new Error(`Release tag ${tag} does not match package version ${expected}.`);
}

console.log(`Verified ${tag}.`);
