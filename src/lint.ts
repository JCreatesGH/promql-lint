import { parseSelectors, functionsUsed, groupingLabels } from "./parse.js";

export interface Finding { severity: "high" | "medium" | "low"; rule: string; message: string; }

const HIGH_CARD_LABELS = new Set(["id", "instance", "pod", "container_id", "uid",
  "user_id", "request_id", "ip", "trace_id", "session_id", "url", "path"]);

export function lint(query: string): Finding[] {
  const out: Finding[] = [];
  const selectors = parseSelectors(query);
  const fns = functionsUsed(query);

  for (const s of selectors) {
    for (const m of s.matchers) {
      if (m.op === "=~" && (m.value === ".*" || m.value === ".+" || m.value === "")) {
        out.push({ severity: "medium", rule: "match-all-regex",
          message: `${s.metric}{${m.label}=~"${m.value}"} matches everything — drop the matcher or narrow it.` });
      }
    }
    if (s.metric.endsWith("_total") && !fns.has("rate") && !fns.has("irate") && !fns.has("increase")) {
      out.push({ severity: "high", rule: "counter-without-rate",
        message: `'${s.metric}' is a counter — wrap it in rate()/increase(), a raw counter is meaningless.` });
    }
    if (s.metric === "" || (selectors.length === 1 && s.matchers.length === 0 && !s.metric.includes(":"))) {
      // bare metric with no matchers can be huge
      out.push({ severity: "low", rule: "no-matchers",
        message: `'${s.metric}' has no label matchers — may select a lot of series.` });
    }
  }

  for (const label of groupingLabels(query)) {
    if (HIGH_CARD_LABELS.has(label)) {
      out.push({ severity: "high", rule: "high-cardinality-grouping",
        message: `Grouping by '${label}' explodes cardinality — avoid per-id/instance grouping.` });
    }
  }

  // range without a rate-like function is a common mistake
  if (selectors.some((s) => s.range) && !(fns.has("rate") || fns.has("increase") || fns.has("irate") ||
      fns.has("delta") || fns.has("avg_over_time".replace("avg_over_time", "avg")))) {
    if (!/_over_time\s*\(/.test(query)) {
      out.push({ severity: "medium", rule: "range-without-function",
        message: "A range vector ([5m]) must be reduced by a function (rate/increase/*_over_time)." });
    }
  }

  out.sort((a, b) => sev(a.severity) - sev(b.severity));
  return out;
}
const sev = (s: Finding["severity"]) => ({ high: 0, medium: 1, low: 2 }[s]);
