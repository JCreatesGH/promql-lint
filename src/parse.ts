// Lightweight PromQL extraction (not a full parser): metric selectors, matchers,
// functions, and aggregation grouping labels.
export interface Matcher { label: string; op: string; value: string; }
export interface Selector { metric: string; matchers: Matcher[]; range?: string; }

const SELECTOR = /([a-zA-Z_:][a-zA-Z0-9_:]*)\s*(\{[^}]*\})?(\[[0-9]+[smhdwy]\])?/g;
const MATCHER = /([a-zA-Z_][a-zA-Z0-9_]*)\s*(=~|!~|!=|=)\s*"([^"]*)"/g;

// Label-list clauses (`by (a,b)`, `on (x)`, `group_left(code)`, …) hold labels, not
// metrics — strip them before extracting selectors so they aren't mis-read as metrics.
const LABEL_LISTS = /\b(?:by|without|on|ignoring|group_left|group_right)\s*\([^)]*\)/g;

export function parseSelectors(query: string): Selector[] {
  const out: Selector[] = [];
  const reserved = new Set(["by", "without", "on", "ignoring", "group_left", "group_right",
    "and", "or", "unless", "offset", "bool", "inf", "nan"]);
  const cleaned = query.replace(LABEL_LISTS, " ");
  let m: RegExpExecArray | null;
  SELECTOR.lastIndex = 0;
  while ((m = SELECTOR.exec(cleaned))) {
    const metric = m[1];
    if (reserved.has(metric) || FUNCTIONS.has(metric)) continue;
    const matchers: Matcher[] = [];
    if (m[2]) {
      let mm: RegExpExecArray | null;
      MATCHER.lastIndex = 0;
      while ((mm = MATCHER.exec(m[2]))) matchers.push({ label: mm[1], op: mm[2], value: mm[3] });
    }
    out.push({ metric, matchers, range: m[3] ? m[3].slice(1, -1) : undefined });
  }
  return out;
}

// Functions that consume a range vector ([5m]); a range vector must be reduced by one of these.
export const RANGE_FUNCTIONS = new Set([
  "rate", "irate", "increase", "delta", "idelta", "deriv", "predict_linear",
  "holt_winters", "double_exponential_smoothing", "resets", "changes",
  "avg_over_time", "min_over_time", "max_over_time", "sum_over_time", "count_over_time",
  "quantile_over_time", "stddev_over_time", "stdvar_over_time", "last_over_time",
  "present_over_time", "mad_over_time", "absent_over_time",
]);

export const FUNCTIONS = new Set([
  ...RANGE_FUNCTIONS,
  // aggregations
  "sum", "avg", "min", "max", "count", "count_values", "stddev", "stdvar",
  "topk", "bottomk", "quantile", "group", "limitk", "limit_ratio",
  // selection / transformation
  "histogram_quantile", "histogram_count", "histogram_sum", "histogram_fraction",
  "label_replace", "label_join", "sort", "sort_desc", "sort_by_label", "sort_by_label_desc",
  // math
  "abs", "ceil", "floor", "round", "clamp", "clamp_max", "clamp_min", "exp", "ln",
  "log2", "log10", "sqrt", "sgn", "scalar", "vector", "absent",
  // time
  "time", "timestamp", "day_of_month", "day_of_week", "day_of_year", "days_in_month",
  "hour", "minute", "month", "year",
]);

export function functionsUsed(query: string): Set<string> {
  const used = new Set<string>();
  for (const m of query.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)) {
    if (FUNCTIONS.has(m[1])) used.add(m[1]);
  }
  return used;
}

export function groupingLabels(query: string): string[] {
  const m = query.match(/\bby\s*\(([^)]*)\)/);
  if (!m) return [];
  return m[1].split(",").map((s) => s.trim()).filter(Boolean);
}

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800, y: 31536000 };

/** Convert a single-unit PromQL duration like "5m" or "7d" to seconds (0 if unparseable). */
export function durationSeconds(range: string): number {
  const m = /^([0-9]+)([smhdwy])$/.exec(range.trim());
  if (!m) return 0;
  return parseInt(m[1], 10) * UNIT_SECONDS[m[2]];
}
