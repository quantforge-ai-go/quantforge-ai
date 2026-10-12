# QuantForge AI

AI-powered research and development platform for algorithmic trading systems, focused on MetaTrader 5.

QuantForge AI does **not** sell trading signals or promise profit. It helps developers and traders:

- analyze MT5 backtest results
- find weaknesses in EA strategies
- audit EA behaviour
- read trading logs
- review MQL5 code for risk-control gaps
- build test plans
- compare optimization results
- detect overfitting
- produce research reports

## Tools (static, client-side, no upload)

| Page | What it does |
|---|---|
| `analyze.html` | Backtest Analyzer v0.3. Closed-trade / deals CSV or Strategy Tester graph CSV. Expectancy, payoff ratio, streaks, outlier dependence, tail loss, cost drag, t-statistic, floating-drawdown checks, breakdown by direction / symbol / weekday / hour, Markdown report. |
| `log.html` | EA Log Reader v0.1. Terminal/tester logs or Experts/Journal text. Classifies critical runtime errors, stop-outs, failed order requests (by reason, with fix hints), retry storms, log flooding, EA restarts; per-symbol and per-hour tables; Markdown report. |
| `review.html` | MQL5 Code Review v0.1. Pattern-based static scan of an EA: stop loss, martingale-like lot escalation, lot/price normalisation, margin check, order-result handling, unbounded retry loops, stops/freeze level, exposure cap, magic number, equity kill-switch, spread/time filters, indicator handles in OnTick, unchecked Copy* calls, Sleep(), input table. Detects MQL4 and reports it. |
| `testplan.html` | Test Plan Generator v0.1. From an EA profile (symbols, timeframes, history, trade frequency, optimized parameters, strategy type, known concerns) builds a plan: development/holdout split, rolling walk-forward windows with real dates, optimization protocol, robustness matrix, strategy-specific checks, acceptance criteria, concern-driven actions and an ordered run sheet, plus plan-quality warnings (thin OOS windows, trades per parameter, search-space size). |
| `optimize.html` | Optimization Check v0.1. MT5 optimization CSV. Best-vs-top-group spike, parameter-neighbour plateau test, trade-count sanity, back/forward rank correlation, score histogram, Markdown report. |

Shared logic lives in `assets/qf.js` (no DOM dependency apart from `QF.ui` / `QF.draw`, so it can be tested in Node). Styles are in `assets/tools.css`.

## Run locally

Open `index.html` in a browser, or serve the folder:

```
python3 -m http.server 8000
```

## Test the engine

```
node -e "const QF=require('./assets/qf.js');const t=QF.parseAnalyzerInput(QF.demo.trades());console.log(QF.analyzeTrades(t.data,t.meta).flags)"
```

## Principles

- Descriptive, not predictive. Thresholds are heuristic starting points.
- A flag is a prompt to investigate, not a verdict.
- Overfitting indicators are not proof; confirm on data the optimizer never saw.

## Roadmap

1. Multi-run comparison (two or more backtests side by side)
2. LLM-assisted narrative report on top of the structured findings
