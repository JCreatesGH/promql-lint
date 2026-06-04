// Lightweight PromQL extraction (not a full parser): metric selectors, matchers,
// functions, and aggregation grouping labels.
export interface Matcher { label: string; op: string; value: string; }
export interface Selector { metric: string; matchers: Matcher[]; range?: string; }

const SELECTOR = /([a-zA-Z_:][a-zA-Z0-9_:]*)\s*(\{[^}]*\})?(\[[0-9]+[smhdwy]\])?/g;
const MATCHER = /([a-zA-Z_][a-zA-Z0-9_]*)\s*(=~|!~|!=|=)\s*"([^"]*)"/g;

export function parseSelectors(query: string): Selector[] {
  const out: Selector[] = [];
  const reserved = new Set(["by", "without", "on", "ignoring", "group_left", "group_right",
    "and", "or", "unless", "offset", "bool"]);
  let m: RegExpExecArray | null;
  SELECTOR.lastIndex = 0;
  while ((m = SELECTOR.exec(query))) {
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

export const FUNCTIONS = new Set([
  "rate", "irate", "increase", "sum", "avg", "min", "max", "count", "count_values",
  "histogram_quantile", "label_replace", "topk", "bottomk", "quantile", "stddev",
  "delta", "deriv", "predict_linear", "abs", "ceil", "floor", "clamp_max", "clamp_min",
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
