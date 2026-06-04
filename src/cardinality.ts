import { parseSelectors, groupingLabels } from "./parse.js";

/** Rough series-count estimate. `labelCardinalities` maps label -> distinct values.
 * If the query groups by labels, the result cardinality is the product of those;
 * otherwise it's the product of the *unconstrained* labels on the metric. */
export function estimateCardinality(
  query: string,
  metricSeries: Record<string, number>,
  labelCardinalities: Record<string, number>,
): number {
  const group = groupingLabels(query);
  if (group.length) {
    return group.reduce((acc, l) => acc * (labelCardinalities[l] ?? 1), 1);
  }
  const selectors = parseSelectors(query);
  let total = 0;
  for (const s of selectors) {
    let series = metricSeries[s.metric] ?? 1;
    // each equality matcher narrows by its label's cardinality
    for (const m of s.matchers) {
      if (m.op === "=" && labelCardinalities[m.label]) {
        series = Math.max(1, Math.round(series / labelCardinalities[m.label]));
      }
    }
    total += series;
  }
  return total;
}
