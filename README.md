# QuantForge AI

AI-powered research and development platform for algorithmic trading systems, focused on MetaTrader 5.

QuantForge AI does **not** sell trading signals or promise profit. It helps developers and traders:

- analyze MT5 backtest results
- find weaknesses in EA strategies
- audit EA behaviour
- read trading logs
- review MQL5 code for risk-control gaps
- build test plans
- compare optimization results and multiple backtest runs
- detect overfitting
- produce research reports (combined across tools)

## Tools (static, client-side, no upload)

| Page | What it does |
|---|---|
| `analyze.html` | Backtest Analyzer v0.6. Closed-trade / deals CSV or Strategy Tester graph CSV. Expectancy, payoff ratio, streaks, outlier dependence, tail loss, cost drag, t-statistic, floating-drawdown checks, breakdown by direction / symbol / weekday / hour, **Monte Carlo resampling** (shuffled order, bootstrap, 10% of trades skipped; drawdown and net-result percentiles, optional drawdown limit; seeded, so repeatable), **time stability** (net by calendar month, share of profitable months, one-month dependence, losing streaks) and optional **market regimes** (upload MT5 bars: trend by Kaufman efficiency ratio, volatility by ATR%, each in thirds, measured on bars completed before each trade; 3×3 table and a permutation test that says whether a regime gap is more than luck) and **trading sessions** (Asia / London / overlap / New York / late, from open time with a configurable server offset: UTC+2/+3 with US daylight saving or fixed), Markdown report. |
| `log.html` | EA Log Reader v0.1. Terminal/tester logs or Experts/Journal text. Classifies critical runtime errors, stop-outs, failed order requests (by reason, with fix hints), retry storms, log flooding, EA restarts; per-symbol and per-hour tables; Markdown report. |
| `review.html` | MQL5 Code Review v0.1. Pattern-based static scan of an EA: stop loss, martingale-like lot escalation, lot/price normalisation, margin check, order-result handling, unbounded retry loops, stops/freeze level, exposure cap, magic number, equity kill-switch, spread/time filters, indicator handles in OnTick, unchecked Copy* calls, Sleep(), input table. Detects MQL4 and reports it. |
| `testplan.html` | Test Plan Generator v0.1. From an EA profile (symbols, timeframes, history, trade frequency, optimized parameters, strategy type, known concerns) builds a plan: development/holdout split, rolling walk-forward windows with real dates, optimization protocol, robustness matrix, strategy-specific checks, acceptance criteria, concern-driven actions and an ordered run sheet, plus plan-quality warnings (thin OOS windows, trades per parameter, search-space size). |
| `compare.html` | Backtest Comparison v0.1. Two to four runs (all closed-trade lists or all graph exports) side by side with deltas against the baseline, trade-off flags (more profit with deeper drawdown, higher win rate with smaller payoff, fewer trades, grown tail loss, different period/symbols), a rough Welch t-test of the per-trade difference, per-symbol table, overlaid curves and a Markdown report. |
| `report.html` | Research Report v0.1. Every tool has an *Add to research report* button (kept in this browser's localStorage, up to 12 results). The report page builds a deterministic narrative (no LLM, no server): summary and status, evidence coverage, cross-tool observations (e.g. log retry storms vs unbounded retries in code), per-area findings, prioritized next steps, limits, metrics appendix; export as Markdown or print to PDF. |
| `optimize.html` | Optimization Check v0.2. MT5 optimization CSV. Best-vs-top-group spike, parameter-neighbour plateau test, trade-count sanity, back/forward rank correlation, score histogram, **parameter heatmap** for any two parameters (best or median over the rest, plateau share), Markdown report. |

Shared logic lives in `assets/qf.js` (no DOM dependency apart from `QF.ui` / `QF.draw`, so it can be tested in Node). Styles are in `assets/tools.css`.

## Run locally

Open `index.html` in a browser, or serve the folder:

```
python3 -m http.server 8000
```

## Tests

```
npm test        # or: node tests/smoke.js
```

56 smoke tests cover parsing (decimal commas, in/out deals), the analyzer, Monte Carlo (reproducibility, consistency with the analyzer), month stability, regime and session splits (including a planted-dependence case and a no-false-alarm case), optimization and heatmap, log reader, code review (including false-positive guards), test plan, comparison and the research report. Most use synthetic demo data. `tests/fixtures/` holds real MT5 exports (so far: a Strategy Tester graph export in UTF-16 with tab separation and `<DATE>`-style headers); more real files make the suite far more trustworthy.

## Principles

- Descriptive, not predictive. Thresholds are heuristic starting points.
- A flag is a prompt to investigate, not a verdict.
- Overfitting indicators are not proof; confirm on data the optimizer never saw.

## Roadmap

1. Optional, opt-in LLM wording on top of the rule-based report (user supplies their own key; nothing is sent unless they choose to)
2. Regression fixtures built from real (anonymised) MT5 exports, added to `tests/` (the main outstanding risk: parsers and thresholds are validated on synthetic data)
3. Spread and slippage sensitivity from a trade list with per-trade costs
