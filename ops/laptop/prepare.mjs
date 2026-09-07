import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import os from "node:os";

const root = resolve(import.meta.dirname, "../..");
const upstream = resolve(root, ".contingency/upstream");
const runtime = resolve(root, ".contingency/runtime");
const expected = "241bb11c0627f2981746d37033f57dbfa81d29b0";
const actual = execFileSync("git", ["-C", upstream, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (actual !== expected) throw new Error("Unexpected upstream revision; preparation stopped");
if (existsSync(runtime)) throw new Error("Runtime already exists; preserving existing configuration");
mkdirSync(runtime, { recursive: true });
cpSync(resolve(upstream, "docker"), runtime, { recursive: true });
// Only a template is copied. No .env, containers, tunnel, or production changes.
if (existsSync(resolve(runtime, ".env"))) throw new Error("Unexpected .env in upstream");
cpSync(resolve(root, "ops/laptop/compose.local.yml"), resolve(runtime, "compose.local.yml"));
const report = {
  preparedAt: new Date().toISOString(), upstreamCommit: actual,
  memoryGiB: Math.round(os.totalmem() / 1024 ** 3), logicalCpus: os.cpus().length,
  runtime, started: false, productionChanged: false,
  next: "See ops/laptop/README.md. Configure secrets and OAuth before startup.",
};
writeFileSync(resolve(root, ".contingency/preparation.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
