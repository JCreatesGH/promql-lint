import {
  parseSelectors, functionsUsed, groupingLabels, RANGE_FUNCTIONS, AGGREGATIONS, durationSeconds,
} from "./parse.js";

export interface Finding { severity: "high" | "medium" | "low"; rule: string; message: string; }

const HIGH_CARD_LABELS = new Set(["id", "instance", "pod", "container_id", "uid",
  "user_id", "request_id", "ip", "trace_id", "session_id", "url", "path", "endpoint", "email"]);

// Metrics that are routinely queried bare (low cardinality by design).
const BARE_OK = new Set(["up", "scrape_duration_seconds", "scrape_samples_scraped"]);

// Range vectors longer than this are expensive to scan; suggest a recording rule.
const LARGE_RANGE_SECONDS = 86400; // > 1 day

// A rate window shorter than this rarely holds enough samples to be reliable.
const SHORT_RATE_SECONDS = 60; // < 1m

// A raw counter is only meaningful through one of these (per-second / total over time).
const COUNTER_FUNCTIONS = new Set(["rate", "irate", "increase"]);

// Suffixes Prometheus uses for monotonic counters: `_total`, plus the `_count`/`_sum`
// series emitted by every histogram and summary. All are meaningless without rate().
function counterKind(metric: string): string | null {
  if (metric.includes(":")) return null;          // recording rule — already pre-aggregated
  if (metric.endsWith("_total")) return "counter";
  if (metric.endsWith("_count") || metric.endsWith("_sum")) return "histogram/summary counter";
  return null;
}

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
  const hasAggregation = [...fns].some((f) => AGGREGATIONS.has(f));

  for (const s of selectors) {
    for (const m of s.matchers) {
      if (m.op === "=~" && (m.value === ".*" || m.value === ".+" || m.value === "")) {
        add({ severity: "medium", rule: "match-all-regex",
          message: `${s.metric}{${m.label}=~"${m.value}"} matches everything — drop the matcher or narrow it.` });
      }
    }

    const kind = counterKind(s.metric);
    if (kind && !hasCounterFn) {
      add({ severity: "high", rule: "counter-without-rate",
        message: `'${s.metric}' is a ${kind} — wrap it in rate()/increase(), a raw counter is meaningless.` });
    }

    if (s.matchers.length === 0 && !s.range && !s.metric.includes(":") && !BARE_OK.has(s.metric)) {
      add({ severity: "low", rule: "no-matchers",
        message: `'${s.metric}' has no label matchers — may select a lot of series.` });
    }

    if (s.range && durationSeconds(s.range) > LARGE_RANGE_SECONDS) {
      add({ severity: "medium", rule: "large-range-vector",
        message: `'${s.metric}[${s.range}]' scans a very long window — precompute it with a recording rule.` });
    }

    if (hasCounterFn && s.range && !s.subquery) {
      const secs = durationSeconds(s.range);
      if (secs > 0 && secs < SHORT_RATE_SECONDS) {
        add({ severity: "low", rule: "short-rate-window",
          message: `rate()/increase() over '${s.metric}[${s.range}]' (<1m) may capture too few samples to be reliable.` });
      }
    }
  }

  for (const label of groupingLabels(query)) {
    if (HIGH_CARD_LABELS.has(label)) {
      add({ severity: "high", rule: "high-cardinality-grouping",
        message: `Grouping by '${label}' explodes cardinality — avoid per-id/instance grouping.` });
    }
  }

  // histogram_quantile() correctness — the most common histogram mistakes.
  if (/\bhistogram_quantile\s*\(/.test(query)) {
    const buckets = selectors.filter((s) => s.metric.endsWith("_bucket"));
    if (buckets.length && (!hasCounterFn || buckets.some((s) => !s.range))) {
      add({ severity: "high", rule: "histogram-quantile-raw-buckets",
        message: "histogram_quantile() needs the per-second rate of the _bucket series — wrap it in rate()/increase()." });
    }
    if (hasAggregation && !groupingLabels(query).includes("le")) {
      add({ severity: "high", rule: "histogram-quantile-missing-le",
        message: "Aggregating histogram buckets drops the 'le' label — keep it with `by (le)` or the quantile is wrong." });
    }
  }

  // A range vector ([5m]) must be reduced by a range function (rate/increase/*_over_time/…).
  if (selectors.some((s) => s.range && !s.subquery) && !hasRangeFn) {
    add({ severity: "medium", rule: "range-without-function",
      message: "A range vector ([5m]) must be reduced by a function (rate/increase/*_over_time)." });
  }

  out.sort((a, b) => sev(a.severity) - sev(b.severity));
  return out;
}

const sev = (s: Finding["severity"]) => ({ high: 0, medium: 1, low: 2 }[s]);
