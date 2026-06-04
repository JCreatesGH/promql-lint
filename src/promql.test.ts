import { describe, it, expect } from "vitest";
import { parseSelectors, functionsUsed, groupingLabels } from "./parse";
import { lint } from "./lint";
import { estimateCardinality } from "./cardinality";

const rules = (q: string) => new Set(lint(q).map((f) => f.rule));

describe("parse", () => {
  it("extracts metric, matchers and range", () => {
    const s = parseSelectors('rate(http_requests_total{job="api",code=~"5.."}[5m])');
    const sel = s.find((x) => x.metric === "http_requests_total")!;
    expect(sel.matchers).toContainEqual({ label: "job", op: "=", value: "api" });
    expect(sel.range).toBe("5m");
    expect(functionsUsed('rate(x[5m])').has("rate")).toBe(true);
  });

  it("reads grouping labels", () => {
    expect(groupingLabels("sum(rate(x[5m])) by (job, instance)")).toEqual(["job", "instance"]);
  });
});

describe("lint", () => {
  it("flags a counter without rate()", () => {
    expect(rules("http_requests_total").has("counter-without-rate")).toBe(true);
    expect(rules("rate(http_requests_total[5m])").has("counter-without-rate")).toBe(false);
  });

  it("flags match-all regex", () => {
    expect(rules('up{instance=~".*"}').has("match-all-regex")).toBe(true);
  });

  it("flags grouping by a high-cardinality label", () => {
    expect(rules("sum(rate(http_requests_total[5m])) by (pod)").has("high-cardinality-grouping")).toBe(true);
  });

  it("flags a range vector with no reducing function", () => {
    expect(rules("http_latency_seconds[5m]").has("range-without-function")).toBe(true);
  });

  it("clean query has no high findings", () => {
    const q = 'sum(rate(http_requests_total{job="api"}[5m])) by (job)';
    expect(lint(q).filter((f) => f.severity === "high")).toEqual([]);
  });
});

describe("estimateCardinality", () => {
  it("uses grouping labels when present", () => {
    const c = estimateCardinality("sum(rate(x[5m])) by (job, pod)", {}, { job: 5, pod: 200 });
    expect(c).toBe(1000);
  });

  it("falls back to metric series narrowed by equality matchers", () => {
    const c = estimateCardinality('http_requests_total{job="api"}',
      { http_requests_total: 10000 }, { job: 5 });
    expect(c).toBe(2000);   // 10000 / 5
  });
});
