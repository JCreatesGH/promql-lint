#!/usr/bin/env node
import { lint, Finding } from "./index.js";

const HELP = `promql-lint — lint PromQL for correctness and cost

Usage:
  promql-lint "<query>" [--json]

Examples:
  promql-lint 'sum(http_requests_total{instance=~".*"}) by (pod)'
  promql-lint 'rate(http_requests_total[5m])' --json

Options:
  --json      emit findings as JSON
  -h, --help  show this help

Exit code: 1 if any HIGH-severity finding, otherwise 0.`;

const ICON = { high: "HIGH  ", medium: "MEDIUM", low: "LOW   " } as const;

function format(findings: Finding[]): string {
  if (findings.length === 0) return "✓ no issues found";
  const lines = findings.map((f) => `${ICON[f.severity]}  ${f.rule.padEnd(26)} ${f.message}`);
  const counts = (["high", "medium", "low"] as const)
    .map((s) => [s, findings.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s}`)
    .join(", ");
  lines.push("", `${findings.length} issue${findings.length === 1 ? "" : "s"} (${counts})`);
  return lines.join("\n");
}

/** Pure entry point: returns an exit code and the text to print. */
export function run(args: string[]): { code: number; output: string } {
  if (args.length === 0) return { code: 1, output: HELP };
  if (args.includes("-h") || args.includes("--help")) return { code: 0, output: HELP };

  const json = args.includes("--json");
  const query = args.filter((a) => a !== "--json").join(" ").trim();
  if (!query) return { code: 1, output: "Error: no query provided" };

  const findings = lint(query);
  const hasHigh = findings.some((f) => f.severity === "high");
  const output = json ? JSON.stringify(findings, null, 2) : format(findings);
  return { code: hasHigh ? 1 : 0, output };
}

// Execute only when invoked as the CLI binary (not when imported by tests).
if (process.argv[1] && /cli\.js$/.test(process.argv[1])) {
  const { code, output } = run(process.argv.slice(2));
  (code === 0 ? console.log : console.error)(output);
  process.exit(code);
}
