# Changelog

All notable changes are documented here, following
[Keep a Changelog](https://keepachangelog.com/) and [SemVer](https://semver.org/).

## [0.2.0]

### Added
- `histogram-quantile-raw-buckets` and `histogram-quantile-missing-le` rules —
  catch the two most common `histogram_quantile()` mistakes (quantile over
  un-rated buckets, and aggregating away the `le` label).
- `short-rate-window` rule for `rate()` windows under 1 minute.
- `counter-without-rate` now also flags histogram/summary `_count` and `_sum`.

### Changed
- `high-cardinality-grouping` and cardinality estimation now scan every `by()`
  clause, not just the first.
- Duration parsing handles compound durations (`1h30m`) and subquery windows
  (`[1h:5m]`).

## [0.1.0]

### Added
- PromQL linter: `counter-without-rate`, `high-cardinality-grouping`,
  `match-all-regex`, `range-without-function`, `large-range-vector`,
  `no-matchers`.
- Series-cardinality estimator and a `promql-lint` CLI (`--json`, `--check`).
