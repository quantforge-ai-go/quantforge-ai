# QuantForge AI

AI-powered research and development platform for algorithmic trading systems, focused on MetaTrader 5.

QuantForge AI does **not** sell trading signals or promise profit. It helps developers and traders:

- analyze MT5 backtest results
- find weaknesses in EA strategies
- audit EA behaviour
- read trading logs *(planned)*
- get help with MQL5 code *(planned)*
- build test plans *(planned)*
- compare optimization results
- detect overfitting
- produce research reports

## Tools (static, client-side, no upload)

| Page | What it does |
|---|---|
| `analyze.html` | Backtest Analyzer v0.3. Closed-trade / deals CSV or Strategy Tester graph CSV. Expectancy, payoff ratio, streaks, outlier dependence, tail loss, cost drag, t-statistic, floating-drawdown checks, breakdown by direction / symbol / weekday / hour, Markdown report. |
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

1. EA log reader (Experts / Journal tabs): error and requote patterns, order-reject frequency
2. MQL5 code review checklist (stops, lot sizing, magic numbers, time filters, spread guards)
3. Test-plan generator (walk-forward windows, symbol/timeframe grid, cost stress)
4. Multi-run comparison (two or more backtests side by side)
5. LLM-assisted narrative report on top of the structured findings
