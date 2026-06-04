# promql-lint

[![CI](https://github.com/JCreatesGH/promql-lint/actions/workflows/ci.yml/badge.svg)](https://github.com/JCreatesGH/promql-lint/actions)
[![TypeScript](https://img.shields.io/badge/types-included-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Lint **PromQL** for the mistakes that break dashboards or melt your TSDB — raw counters, match-all regexes, high-cardinality grouping — and estimate how many series a query will fan out to *before* you run it.

![screenshot](assets/screenshot.png)

## Install

```bash
npm install promql-lint
```

## Lint

```ts
import { lint } from "promql-lint";

lint('sum(http_requests_total{instance=~".*"}) by (pod)');
// HIGH   counter-without-rate      : wrap a _total counter in rate()/increase()
// HIGH   high-cardinality-grouping : grouping by 'pod' explodes cardinality
// MEDIUM match-all-regex           : {instance=~".*"} matches everything
```

## Estimate cardinality

```ts
import { estimateCardinality } from "promql-lint";

estimateCardinality("sum(rate(x[5m])) by (job, pod)", {}, { job: 5, pod: 200 });
// 1000   (5 jobs × 200 pods)
```

## Rules

| Severity | Rule | Catches |
|----------|------|---------|
| HIGH | `counter-without-rate` | a `_total` counter not wrapped in `rate()`/`increase()` |
| HIGH | `high-cardinality-grouping` | `by (pod/instance/id/…)` |
| MEDIUM | `match-all-regex` | `label=~".*"` / `".+"` |
| MEDIUM | `range-without-function` | a `[5m]` range vector with no reducer |
| LOW | `no-matchers` | a bare metric with no label matchers |

The extractor pulls metric selectors, matchers, functions, and `by(...)` labels with a tolerant regex pass — no full parser needed.

## Development

```bash
npm install && npm test    # 9 tests
npm run build              # tsc, clean
```

## License

MIT
