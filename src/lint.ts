import { parseSelectors, functionsUsed, groupingLabels, RANGE_FUNCTIONS, durationSeconds } from "./parse.js";

export interface Finding { severity: "high" | "medium" | "low"; rule: string; message: string; }

const HIGH_CARD_LABELS = new Set(["id", "instance", "pod", "container_id", "uid",
  "user_id", "request_id", "ip", "trace_id", "session_id", "url", "path", "endpoint", "email"]);

// Metrics that are routinely queried bare (low cardinality by design).
const BARE_OK = new Set(["up", "scrape_duration_seconds", "scrape_samples_scraped"]);

// Range vectors longer than this are expensive to scan; suggest a recording rule.
const LARGE_RANGE_SECONDS = 86400; // > 1 day

// A raw counter is only meaningful through one of these (per-second / total over time).
const COUNTER_FUNCTIONS = new Set(["rate", "irate", "increase"]);

export function lint(query: string): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  const add = (f: Finding) => {
    const key = `${f.rule}|${f.message}`;
    if (!seen.has(key)) { seen.add(key); out.push(f); }
  };

  const selectors = parseSelectors(query);
  const fns = functionsUsed(query);
  const hasRangeFn = [...fns].some((f) => RANGE_FUNCTIONS.has(f));
  const hasCounterFn = [...fns].some((f) => COUNTER_FUNCTIONS.has(f));

  for (const s of selectors) {
    for (const m of s.matchers) {
      if (m.op === "=~" && (m.value === ".*" || m.value === ".+" || m.value === "")) {
        add({ severity: "medium", rule: "match-all-regex",
          message: `${s.metric}{${m.label}=~"${m.value}"} matches everything — drop the matcher or narrow it.` });
      }
    }

    if (s.metric.endsWith("_total") && !hasCounterFn) {
      add({ severity: "high", rule: "counter-without-rate",
        message: `'${s.metric}' is a counter — wrap it in rate()/increase(), a raw counter is meaningless.` });
    }

    if (s.matchers.length === 0 && !s.range && !s.metric.includes(":") && !BARE_OK.has(s.metric)) {
      add({ severity: "low", rule: "no-matchers",
        message: `'${s.metric}' has no label matchers — may select a lot of series.` });
    }

    if (s.range && durationSeconds(s.range) > LARGE_RANGE_SECONDS) {
      add({ severity: "medium", rule: "large-range-vector",
        message: `'${s.metric}[${s.range}]' scans a very long window — precompute it with a recording rule.` });
    }
  }

  for (const label of groupingLabels(query)) {
    if (HIGH_CARD_LABELS.has(label)) {
      add({ severity: "high", rule: "high-cardinality-grouping",
        message: `Grouping by '${label}' explodes cardinality — avoid per-id/instance grouping.` });
    }
  }

  // A range vector ([5m]) must be reduced by a range function (rate/increase/*_over_time/…).
  if (selectors.some((s) => s.range) && !hasRangeFn) {
    add({ severity: "medium", rule: "range-without-function",
      message: "A range vector ([5m]) must be reduced by a function (rate/increase/*_over_time)." });
  }

  out.sort((a, b) => sev(a.severity) - sev(b.severity));
  return out;
}

const sev = (s: Finding["severity"]) => ({ high: 0, medium: 1, low: 2 }[s]);
