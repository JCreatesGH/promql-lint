import { describe, it, expect } from "vitest";
import { parseSelectors, functionsUsed, groupingLabels, durationSeconds } from "./parse";
import { lint } from "./lint";
import { estimateCardinality } from "./cardinality";
import { run } from "./cli";

const rules = (q: string) => new Set(lint(q).map((f) => f.rule));

describe("parse", () => {
  it("extracts metric, matchers and range", () => {
    const s = parseSelectors('rate(http_requests_total{job="api",code=~"5.."}[5m])');
    const sel = s.find((x) => x.metric === "http_requests_total")!;
    expect(sel.matchers).toContainEqual({ label: "job", op: "=", value: "api" });
    expect(sel.range).toBe("5m");
    expect(functionsUsed('rate(x[5m])').has("rate")).toBe(true);
  });

  it("does not mistake grouping labels for metric selectors", () => {
    const metrics = parseSelectors("sum(rate(http_requests_total[5m])) by (job, instance)").map((s) => s.metric);
    expect(metrics).toContain("http_requests_total");
    expect(metrics).not.toContain("job");
    expect(metrics).not.toContain("instance");
  });

  it("ignores on()/group_left() join labels too", () => {
    const metrics = parseSelectors("foo_total * on(cluster) group_left(team) bar").map((s) => s.metric);
    expect(metrics).not.toContain("cluster");
    expect(metrics).not.toContain("team");
  });

  it("reads grouping labels", () => {
    expect(groupingLabels("sum(rate(x[5m])) by (job, instance)")).toEqual(["job", "instance"]);
  });

  it("parses durations to seconds", () => {
    expect(durationSeconds("5m")).toBe(300);
    expect(durationSeconds("1d")).toBe(86400);
    expect(durationSeconds("2w")).toBe(1209600);
    expect(durationSeconds("bogus")).toBe(0);
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

  it("accepts *_over_time as a valid range reducer", () => {
    expect(rules("avg_over_time(http_latency_seconds[5m])").has("range-without-function")).toBe(false);
    expect(rules("max_over_time(node_load1[10m])").has("range-without-function")).toBe(false);
  });

  it("still flags a counter that is only wrapped in *_over_time (not a rate)", () => {
    // max_over_time on a raw counter is still a raw-counter value.
    expect(rules("max_over_time(http_requests_total[5m])").has("counter-without-rate")).toBe(true);
  });

  it("flags an expensive long range vector", () => {
    expect(rules("rate(http_requests_total[7d])").has("large-range-vector")).toBe(true);
    expect(rules("rate(http_requests_total[5m])").has("large-range-vector")).toBe(false);
  });

  it("does not emit phantom no-matchers findings for grouping labels", () => {
    // `by (job)` must not be linted as a bare metric named 'job'.
    expect(rules('sum(rate(http_requests_total{job="api"}[5m])) by (job)').has("no-matchers")).toBe(false);
  });

  it("clean query has no high findings", () => {
    const q = 'sum(rate(http_requests_total{job="api"}[5m])) by (job)';
    expect(lint(q).filter((f) => f.severity === "high")).toEqual([]);
  });
});

describe("cli", () => {
  it("shows help with no args (exit 1) and --help (exit 0)", () => {
    expect(run([]).code).toBe(1);
    expect(run([]).output).toContain("Usage:");
    expect(run(["--help"]).code).toBe(0);
  });

  it("exits 1 and reports HIGH findings", () => {
    const r = run(['sum(http_requests_total{instance=~".*"}) by (pod)']);
    expect(r.code).toBe(1);
    expect(r.output).toContain("counter-without-rate");
    expect(r.output).toContain("high");
  });

  it("exits 0 for a clean query", () => {
    const r = run(['sum(rate(http_requests_total{job="api"}[5m])) by (job)']);
    expect(r.code).toBe(0);
    expect(r.output).toContain("no issues");
  });

  it("emits JSON with --json", () => {
    const r = run(["http_requests_total", "--json"]);
    const parsed = JSON.parse(r.output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].rule).toBe("counter-without-rate");
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
