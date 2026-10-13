/* QuantForge AI — analysis engine (no DOM dependency except QF.ui / QF.draw).
   All analysis is descriptive. Thresholds are heuristic starting points, not rules. */
(function (root) {
  "use strict";
  const QF = {};

  /* ---------- numbers & text ---------- */
  QF.num = function (v) {
    if (v === undefined || v === null) return NaN;
    let s = String(v).trim().replace(/["$€£%\s\u00a0]/g, "");
    if (!s) return NaN;
    const hasC = s.includes(","), hasD = s.includes(".");
    if (hasC && hasD) {
      if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
      else s = s.replace(/,/g, "");
    } else if (hasC) {
      if (/^-?\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, "");
      else s = s.replace(",", ".");
    } else if (hasD && /^-?\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  };
  QF.esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  QF.fmt = (n, d = 2) => Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : (n === Infinity ? "∞" : "N/A");
  QF.money = n => QF.fmt(n, 2);
  QF.norm = h => String(h).toLowerCase().replace(/^\uFEFF/, "").replace(/%/g, "pct").replace(/[^a-z0-9]/g, "");

  /* ---------- statistics ---------- */
  const sum = a => a.reduce((s, x) => s + x, 0);
  QF.sum = sum;
  QF.mean = a => a.length ? sum(a) / a.length : NaN;
  QF.median = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  QF.std = a => { if (a.length < 2) return NaN; const m = QF.mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
  QF.ranks = a => {
    const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(a.length); let i = 0;
    while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; }
    return r;
  };
  QF.pearson = (x, y) => {
    const n = x.length; if (n < 3) return NaN; const mx = QF.mean(x), my = QF.mean(y); let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
  };
  QF.spearman = (x, y) => QF.pearson(QF.ranks(x), QF.ranks(y));

  /* ---------- file & CSV ---------- */
  QF.readFile = async function (file) {
    const buf = await file.arrayBuffer(), u = new Uint8Array(buf); let enc = "utf-8";
    if (u[0] === 0xFF && u[1] === 0xFE) enc = "utf-16le";
    else if (u[0] === 0xFE && u[1] === 0xFF) enc = "utf-16be";
    else if (u.length > 3 && u[1] === 0 && u[3] === 0) enc = "utf-16le"; // MT5 often exports UTF-16
    return new TextDecoder(enc).decode(buf).replace(/^\uFEFF/, "");
  };
  QF.splitLine = function (line, delim) {
    const out = []; let cell = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"' && q && line[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = !q;
      else if (c === delim && !q) { out.push(cell.trim()); cell = ""; }
      else cell += c;
    }
    out.push(cell.trim()); return out;
  };
  QF.parseCSV = function (text) {
    text = text.replace(/^\uFEFF/, "").replace(/\u0000/g, "");
    const lines = text.split(/\r?\n/).filter(x => x.trim());
    if (lines.length < 2) throw new Error("The file needs a header row and at least one data row.");
    const head = lines[0], cnt = d => head.split(d).length - 1;
    let delim = ",", best = cnt(",");
    for (const d of [";", "\t"]) if (cnt(d) > best) { best = cnt(d); delim = d; }
    const headers = QF.splitLine(head, delim);
    const rows = [];
    for (let i = 1; i < lines.length; i++) { const c = QF.splitLine(lines[i], delim); if (c.every(x => !x)) continue; rows.push(c); }
    return { headers, norm: headers.map(QF.norm), rows, delim };
  };
  QF.parseDate = function (s) {
    s = String(s || "");
    let m = /(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2}))?/.exec(s), y, mo, d, h, mi;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; h = +(m[4] || 0); mi = +(m[5] || 0); }
    else if ((m = /(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T]+(\d{1,2}):(\d{2}))?/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3]; h = +(m[4] || 0); mi = +(m[5] || 0); }
    else return null;
    const dt = new Date(Date.UTC(y, mo - 1, d, h, mi));
    return { dow: dt.getUTCDay(), hour: h, hasTime: !!m[4], ts: dt.getTime() };
  };
  QF.looksLikeGraph = p => p.norm.includes("date") && p.norm.includes("balance") && p.norm.includes("equity") && !p.norm.includes("pass");
  QF.looksLikeOptimization = p => p.norm.includes("pass") && (p.norm.includes("result") || p.norm.includes("profit")) && p.norm.length >= 4;

  /* ---------- input adapters ---------- */
  QF.toGraph = function (p) {
    const f = names => p.norm.findIndex(h => names.includes(h));
    const dI = f(["date", "time", "datetime", "timestamp"]), bI = f(["balance", "accountbalance"]), eI = f(["equity", "funds"]), lI = f(["depositload", "marginload"]);
    if (!(dI >= 0 && bI >= 0 && eI >= 0)) return null;
    const data = [];
    p.rows.forEach((c, i) => {
      const b = QF.num(c[bI]), e = QF.num(c[eI]); if (!Number.isFinite(b) || !Number.isFinite(e)) return;
      data.push({ date: c[dI] || String(i + 1), balance: b, equity: e, load: lI < 0 ? NaN : QF.num(c[lI]) });
    });
    if (!data.length) throw new Error("Balance/equity columns were found, but no numeric rows could be read.");
    return { mode: "graph", data, meta: {} };
  };
  const SKIP_TYPES = ["balance", "credit", "deposit", "withdrawal", "charge", "correction", "bonus", "commission", "interest", "tax"];
  QF.toTrades = function (p) {
    const f = names => p.norm.findIndex(h => names.includes(h));
    const pi = f(["profit", "netprofit", "pl", "profitloss", "result"]);
    if (pi < 0) return null;
    const ci = f(["commission", "commissions"]), si = f(["swap", "swaps"]), fi = f(["fee", "fees"]), ti = f(["type"]), di = f(["direction"]),
      tmI = f(["time", "opentime", "date", "datetime"]), syI = f(["symbol", "item"]);
    const trades = []; let skipped = 0, entryCosts = 0, entryRows = 0;
    p.rows.forEach(c => {
      const type = ti >= 0 ? String(c[ti]).toLowerCase() : "";
      if (type && SKIP_TYPES.includes(type)) { skipped++; return; }
      const cm = ci < 0 ? 0 : (QF.num(c[ci]) || 0), sw = si < 0 ? 0 : (QF.num(c[si]) || 0), fe = fi < 0 ? 0 : (QF.num(c[fi]) || 0);
      if (di >= 0 && String(c[di]).toLowerCase() === "in") { entryCosts += cm + sw + fe; entryRows++; return; }
      const pr = QF.num(c[pi]); if (!Number.isFinite(pr)) return;
      const side = type.startsWith("buy") ? "Buy" : type.startsWith("sell") ? "Sell" : null;
      trades.push({ profit: pr, commission: cm, swap: sw, fee: fe, net: pr + cm + sw + fe, side, symbol: syI >= 0 ? c[syI] : null, time: tmI >= 0 ? QF.parseDate(c[tmI]) : null });
    });
    if (!trades.length) throw new Error("A profit column was found, but no numeric trade rows could be read.");
    return { mode: "trades", data: trades, meta: { skipped, entryCosts, entryRows } };
  };
  QF.parseAnalyzerInput = function (text) {
    const p = QF.parseCSV(text);
    if (QF.looksLikeOptimization(p)) throw new Error("This looks like an MT5 optimization export (it has a Pass column). Open it in the Optimization Check tool instead.");
    const r = QF.toGraph(p) || QF.toTrades(p);
    if (!r) throw new Error("Could not identify this CSV. Expected DATE + BALANCE + EQUITY for a graph export, or a Profit column for closed trades. Detected headers: " + p.headers.join(" | "));
    return r;
  };

  /* ---------- trade analysis ---------- */
  const PFtxt = (w, l) => l === 0 ? (w > 0 ? "∞" : "N/A") : (w / l).toFixed(2);
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function groupRows(trades, keyFn, order) {
    const m = new Map();
    trades.forEach(t => { const k = keyFn(t); if (k == null) return; if (!m.has(k)) m.set(k, []); m.get(k).push(t); });
    const keys = [...m.keys()]; order ? keys.sort((a, b) => order.indexOf(a) - order.indexOf(b)) : keys.sort();
    return keys.map(k => {
      const g = m.get(k), nn = g.map(t => t.net), w = sum(nn.filter(x => x > 0)), l = Math.abs(sum(nn.filter(x => x < 0)));
      return [String(k), g.length, QF.money(sum(nn)), (nn.filter(x => x > 0).length / g.length * 100).toFixed(1) + "%", PFtxt(w, l)];
    });
  }
  QF.analyzeTrades = function (trades, meta) {
    meta = meta || {};
    const n = trades.length, nets = trades.map(t => t.net);
    const wins = nets.filter(x => x > 0), losses = nets.filter(x => x < 0);
    const net = sum(nets), gw = sum(wins), gl = Math.abs(sum(losses));
    const pf = gl === 0 ? (gw > 0 ? Infinity : NaN) : gw / gl;
    const avgWin = wins.length ? gw / wins.length : NaN, avgLoss = losses.length ? gl / losses.length : NaN, payoff = avgWin / avgLoss;
    const winRate = wins.length / n * 100, expectancy = net / n;
    let eq = 0, peak = 0, dd = 0, cw = 0, cl = 0, mw = 0, ml = 0; const cum = [];
    nets.forEach(x => {
      eq += x; cum.push(eq); peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq);
      if (x > 0) { cw++; cl = 0; } else if (x < 0) { cl++; cw = 0; } else { cw = 0; cl = 0; }
      mw = Math.max(mw, cw); ml = Math.max(ml, cl);
    });
    const rf = dd > 0 ? net / dd : NaN;
    const desc = [...nets].sort((a, b) => b - a), k = Math.max(1, Math.round(n * 0.05));
    const netExTop = net - sum(desc.slice(0, k));
    const topShare = gw > 0 ? desc[0] / gw * 100 : NaN, worst = desc[desc.length - 1];
    const costs = sum(trades.map(t => t.commission + t.swap + t.fee)), costShare = gw > 0 && costs < 0 ? -costs / gw * 100 : 0;
    const sd = QF.std(nets), tstat = sd > 0 ? (net / n) / (sd / Math.sqrt(n)) : NaN;

    const metrics = [
      { label: "Closed trades", value: String(n) },
      { label: "Net profit", value: QF.money(net) },
      { label: "Max drawdown (trade sequence)", value: QF.money(dd) },
      { label: "Win rate", value: winRate.toFixed(2) + "%" },
      { label: "Profit factor", value: PFtxt(gw, gl) },
      { label: "Expectancy per trade", value: QF.money(expectancy) },
      { label: "Average win / average loss", value: QF.money(avgWin) + " / " + QF.money(avgLoss) },
      { label: "Payoff ratio", value: QF.fmt(payoff) },
      { label: "Recovery factor", value: QF.fmt(rf) },
      { label: "Longest win / loss streak", value: mw + " / " + ml },
      { label: "Net without best " + k + " trade" + (k > 1 ? "s" : ""), value: QF.money(netExTop) },
      { label: "Costs (commission+swap+fee)", value: QF.money(costs) }
    ];

    const flags = [];
    const add = (level, title, text) => flags.push({ level, title, text });
    if (n < 30) add("risk", "Very small sample", `Only ${n} trades. Every statistic here has wide uncertainty; treat this as an anecdote, not a result.`);
    else if (n < 100) add("warn", "Small sample", `${n} trades is a thin base for judging an edge. Aim for several hundred trades across different market regimes.`);
    if (net <= 0) add("risk", "Not profitable after costs", `Net result is ${QF.money(net)} (profit factor ${PFtxt(gw, gl)}).`);
    else if (pf < 1.2) add("warn", "Thin profit factor", `Profit factor ${PFtxt(gw, gl)} leaves little margin for spread, slippage or regime change.`);
    if (net > 0 && netExTop <= 0) add("risk", "Result depends on a few trades", `Removing the best ${k} trade${k > 1 ? "s" : ""} turns the net result to ${QF.money(netExTop)}. The edge may be outlier-driven.`);
    else if (topShare > 25) add("warn", "One trade dominates gross profit", `The single best trade is ${topShare.toFixed(1)}% of gross profit.`);
    if (Number.isFinite(payoff) && winRate > 60 && payoff < 0.5) add("warn", "Many small wins, few large losses", `Win rate ${winRate.toFixed(1)}% with payoff ratio ${payoff.toFixed(2)}. This profile is typical of systems with open-ended risk (averaging down, grids, no stop). Check the worst trades and how they were closed.`);
    if (Number.isFinite(avgLoss) && Math.abs(worst) > 5 * avgLoss) add("warn", "Tail loss", `The worst trade (${QF.money(worst)}) is ${(Math.abs(worst) / avgLoss).toFixed(1)}× the average loss.`);
    if (net > 0 && Number.isFinite(rf) && rf < 2) add("warn", "Low recovery factor", `Net profit is only ${rf.toFixed(2)}× the maximum drawdown.`);
    if (costShare > 30) add("warn", "Costs eat a large share of profit", `Commission, swap and fees equal ${costShare.toFixed(1)}% of gross profit.`);
    if (Number.isFinite(tstat) && n >= 30 && Math.abs(tstat) < 2) add("warn", "Not statistically distinguishable from zero", `Mean trade result has a t-statistic of ${tstat.toFixed(2)} (rough guide: |t| ≥ 2). Trade results are rarely independent, so even this is optimistic.`);
    if (meta.entryRows) add("info", "Entry-deal costs detected", `${meta.entryRows} entry deals carried ${QF.money(meta.entryCosts)} of commission/swap/fee. They are not attributed to individual trades above; net after entry costs would be ${QF.money(net + meta.entryCosts)}.`);
    if (meta.skipped) add("info", "Non-trade rows skipped", `${meta.skipped} balance/credit-type rows were ignored.`);
    add("info", "Order and costs", "Statistics use file order. Results include only the costs present in the file, with no extra slippage or latency model.");
    if (!flags.some(f => f.level === "risk" || f.level === "warn")) add("ok", "No structural flags raised", "These checks found nothing alarming. That does not mean the strategy is robust; it only means these particular tests did not trip.");

    const breakdowns = [];
    const head = ["Group", "Trades", "Net", "Win rate", "Profit factor"];
    if (trades.some(t => t.side)) {
      const rows = groupRows(trades, t => t.side, ["Buy", "Sell"]); breakdowns.push({ title: "By direction", head, rows });
      if (rows.length === 2 && rows.every(r => r[1] >= 20)) {
        const a = QF.num(rows[0][2]), b = QF.num(rows[1][2]);
        if (a * b < 0) add("info", "One side carries the result", `${a > 0 ? rows[0][0] : rows[1][0]} trades are profitable while ${a > 0 ? rows[1][0] : rows[0][0]} trades lose. Consider whether the logic is symmetric or the test period simply trended.`);
      }
    }
    const syms = new Set(trades.map(t => t.symbol).filter(Boolean));
    if (syms.size > 1) breakdowns.push({ title: "By symbol", head, rows: groupRows(trades, t => t.symbol || null) });
    const timed = trades.filter(t => t.time && t.time.hasTime);
    if (timed.length >= 0.8 * n) {
      breakdowns.push({ title: "By weekday (open time)", head, rows: groupRows(trades, t => t.time ? DOW[t.time.dow] : null, DOW) });
      breakdowns.push({ title: "By hour (open time, server clock)", head, rows: groupRows(trades, t => t.time && t.time.hasTime ? String(t.time.hour).padStart(2, "0") + ":00" : null) });
    }
    const stats = { n, net, pf, expectancy, winRate, payoff, dd, rf, maxLossStreak: ml, worst, netExTop, topShare, costShare, tstat };
    return { mode: "trades", label: "Trade analysis", metrics, flags, breakdowns, stats, nets, trades, series: [{ name: "Cumulative net P/L", color: "#70aaff", values: cum }],
      preview: { head: ["#", "Profit", "Commission", "Swap", "Net P/L"], rows: trades.slice(0, 10).map((t, i) => [i + 1, QF.money(t.profit), QF.money(t.commission), QF.money(t.swap), QF.money(t.net)]) } };
  };

  /* ---------- graph (balance / equity) analysis ---------- */
  QF.analyzeGraph = function (data) {
    const first = data[0], last = data[data.length - 1], change = last.balance - first.balance;
    let pB = -Infinity, pE = -Infinity, ddB = 0, ddE = 0, ddBp = 0, ddEp = 0, below = 0, floatMax = 0, floatMaxP = 0;
    let run = 0, runStart = 0, bestRun = 0, bestStart = 0, bestEnd = 0; const loads = [];
    data.forEach((x, i) => {
      pB = Math.max(pB, x.balance); const underwater = x.equity < pE; pE = Math.max(pE, x.equity);
      const db = pB - x.balance, de = pE - x.equity; ddB = Math.max(ddB, db); ddE = Math.max(ddE, de);
      if (pB > 0) ddBp = Math.max(ddBp, db / pB * 100); if (pE > 0) ddEp = Math.max(ddEp, de / pE * 100);
      if (x.equity < x.balance) { below++; const fl = x.balance - x.equity; floatMax = Math.max(floatMax, fl); if (x.balance > 0) floatMaxP = Math.max(floatMaxP, fl / x.balance * 100); }
      if (underwater) { if (run === 0) runStart = i; run++; if (run > bestRun) { bestRun = run; bestStart = runStart; bestEnd = i; } } else run = 0;
      if (Number.isFinite(x.load)) loads.push(x.load);
    });
    const rf = ddE > 0 ? change / ddE : NaN, maxLoad = loads.length ? Math.max(...loads) : NaN, avgLoad = loads.length ? QF.mean(loads) : NaN;
    const metrics = [
      { label: "Graph data points", value: String(data.length) },
      { label: "Balance change", value: (change >= 0 ? "+" : "") + QF.money(change) },
      { label: "Max equity drawdown", value: QF.money(ddE) + " (" + ddEp.toFixed(2) + "%)" },
      { label: "Max balance drawdown", value: QF.money(ddB) + " (" + ddBp.toFixed(2) + "%)" },
      { label: "Recovery factor (balance change / equity DD)", value: QF.fmt(rf) },
      { label: "Max floating loss", value: QF.money(floatMax) + " (" + floatMaxP.toFixed(2) + "% of balance)" },
      { label: "Equity below balance", value: (below / data.length * 100).toFixed(1) + "% of points" },
      { label: "Longest stretch below equity peak", value: bestRun + " points" },
      { label: "Final equity", value: QF.money(last.equity) },
      { label: "Max / average deposit load", value: loads.length ? maxLoad.toFixed(2) + "% / " + avgLoad.toFixed(2) + "%" : "N/A" }
    ];
    const flags = []; const add = (l, t, x) => flags.push({ level: l, title: t, text: x });
    add("info", "Period", `${first.date} to ${last.date}. Balance ${QF.money(first.balance)} → ${QF.money(last.balance)}.`);
    if (change <= 0) add("risk", "Balance did not grow", `Balance change is ${QF.money(change)}.`);
    if (ddEp > 50) add("risk", "Very deep equity drawdown", `Equity fell ${ddEp.toFixed(1)}% from its peak.`);
    else if (ddEp > 30) add("warn", "Deep equity drawdown", `Equity fell ${ddEp.toFixed(1)}% from its peak.`);
    if (ddE > 0 && ddEp > 10 && ddBp > 0 && ddEp > 2 * ddBp) add("warn", "Drawdown is mostly floating", `Equity drawdown (${ddEp.toFixed(1)}%) is more than twice the balance drawdown (${ddBp.toFixed(1)}%). The system may hold losing positions for long periods; inspect how those positions were eventually closed.`);
    if (floatMaxP > 20) add("warn", "Large floating losses", `At one point equity sat ${floatMaxP.toFixed(1)}% below balance.`);
    if (Number.isFinite(rf) && change > 0 && rf < 1) add("warn", "Low recovery factor", `Balance gain is smaller than the worst equity drawdown (${rf.toFixed(2)}×).`);
    if (Number.isFinite(maxLoad) && maxLoad > 60) add("risk", "Very high deposit load", `Peak deposit load ${maxLoad.toFixed(1)}%. Margin stress can force closure before a recovery.`);
    else if (Number.isFinite(maxLoad) && maxLoad > 30) add("warn", "Elevated deposit load", `Peak deposit load ${maxLoad.toFixed(1)}%.`);
    if (bestRun > 0.5 * data.length) add("warn", "Long time below equity peak", `Equity spent ${bestRun} of ${data.length} points (${data[bestStart].date} → ${data[bestEnd].date}) below a previous peak.`);
    add("info", "Limits of this file", "A graph export has no individual trades, so win rate, profit factor and per-trade behaviour cannot be computed. Export the trade history too.");
    if (!flags.some(f => f.level === "risk" || f.level === "warn")) add("ok", "No structural flags raised", "These checks found nothing alarming. That is not proof of robustness.");
    const stats = { change, ddEp, ddBp, rf, floatMaxP, maxLoad, belowPct: below / data.length * 100 };
    return { mode: "graph", label: "Balance & equity analysis", metrics, flags, breakdowns: [], stats,
      series: [{ name: "Balance", color: "#70aaff", values: data.map(x => x.balance) }, { name: "Equity", color: "#65ddb0", values: data.map(x => x.equity) }],
      preview: { head: ["#", "Date", "Balance", "Equity", "Deposit load"], rows: data.slice(0, 10).map((x, i) => [i + 1, x.date, QF.money(x.balance), QF.money(x.equity), Number.isFinite(x.load) ? x.load.toFixed(4) + "%" : "—"]) } };
  };

  /* ---------- optimization analysis ---------- */
  const KNOWN = { pass: "pass", result: "result", profit: "profit", expectedpayoff: "payoff", profitfactor: "pf", recoveryfactor: "rf", sharperatio: "sharpe", custom: "custom", equityddpct: "eqdd", balanceddpct: "baldd", trades: "trades", forwardresult: "fwd", backresult: "back" };
  QF.toOptimization = function (p) {
    const N = p.rows.length, cols = p.headers.map((h, j) => { const vals = p.rows.map(r => QF.num(r[j])); return { j, name: h, key: KNOWN[p.norm[j]] || null, vals, share: vals.filter(Number.isFinite).length / N }; });
    const idx = {}; cols.forEach(c => { if (c.key && c.share > 0.5) idx[c.key] = c.j; });
    if (!["result", "custom", "profit", "payoff", "pf", "rf", "sharpe"].some(k => idx[k] !== undefined) && idx.pass === undefined) return null; // not an MT5 optimization export
    const params = [], extras = [];
    cols.forEach(c => {
      if (c.key || c.share < 0.9) return;
      const distinct = [...new Set(c.vals)].sort((a, b) => a - b);
      if (distinct.length < 2) return;
      if (N > 50 && distinct.length / N > 0.5) extras.push(c); else params.push({ j: c.j, name: c.name, values: distinct });
    });
    const scoreOptions = [];
    ["result", "custom", "profit", "payoff", "pf", "rf", "sharpe"].forEach(k => { if (idx[k] !== undefined) scoreOptions.push({ j: idx[k], name: p.headers[idx[k]] }); });
    extras.forEach(c => scoreOptions.push({ j: c.j, name: c.name }));
    if (!scoreOptions.length) return null;
    return { headers: p.headers, N, X: p.rows.map((r, i) => cols.map(c => c.vals[i])), idx, params, scoreOptions };
  };
  QF.analyzeOptimization = function (ctx, opt) {
    opt = opt || {}; const sj = opt.scoreJ !== undefined ? opt.scoreJ : ctx.scoreOptions[0].j, minTrades = opt.minTrades || 0;
    const tj = ctx.idx.trades, flags = [], add = (l, t, x) => flags.push({ level: l, title: t, text: x });
    const all = ctx.X.filter(r => Number.isFinite(r[sj]));
    if (all.length < 10) throw new Error("Fewer than 10 passes have a numeric value in the selected score column.");
    const rows = tj !== undefined && minTrades > 0 ? all.filter(r => !(r[tj] < minTrades)) : all;
    if (rows.length < 5) throw new Error("Fewer than 5 passes remain after the minimum-trades filter. Lower the filter.");
    const sorted = [...rows].sort((a, b) => b[sj] - a[sj]), best = sorted[0], n = rows.length;
    const K = Math.min(n, Math.max(5, Math.ceil(n * 0.05))), top = sorted.slice(0, K), scores = rows.map(r => r[sj]);
    const topMed = QF.median(top.map(r => r[sj])), allMed = QF.median(scores);
    const profitJ = ctx.idx.profit !== undefined ? ctx.idx.profit : sj, profitable = rows.filter(r => r[profitJ] > 0).length / n * 100;

    // spike
    const spike = topMed > 0 ? best[sj] / topMed : NaN;
    if (Number.isFinite(spike)) {
      if (spike > 2) add("risk", "Best pass stands far above the rest of the top group", `Best score is ${spike.toFixed(2)}× the median of the top ${K} passes. A lone peak is a classic sign of fitting to noise.`);
      else if (spike > 1.5) add("warn", "Best pass is notably above the top group", `${spike.toFixed(2)}× the median of the top ${K}.`);
      else add("ok", "Top passes are close together", `Best score is ${spike.toFixed(2)}× the median of the top ${K} passes.`);
    }
    if (profitable < 30) add("warn", "Most passes lose", `Only ${profitable.toFixed(1)}% of passes are profitable. The good region may be a small island in parameter space.`);

    // neighbours
    const P = ctx.params, pj = P.map(p => p.j), key = r => pj.map(j => r[j]).join("|"), map = new Map();
    ctx.X.forEach(r => { if (Number.isFinite(r[sj])) map.set(key(r), r[sj]); });
    const nb = [];
    if (P.length && best[sj] > 0) P.forEach((p, i) => { const vi = p.values.indexOf(best[p.j]); [-1, 1].forEach(d => { const v = p.values[vi + d]; if (v === undefined) return; const k = pj.map((j, q) => q === i ? v : best[j]).join("|"); if (map.has(k)) nb.push(map.get(k) / best[sj]); }); });
    let nbMean = NaN, nbMin = NaN;
    if (nb.length >= 2) {
      nbMean = QF.mean(nb); nbMin = Math.min(...nb);
      if (nbMean < 0.5) add("risk", "Best pass is an isolated peak", `Its direct parameter neighbours average ${(nbMean * 100).toFixed(0)}% of its score (worst ${(nbMin * 100).toFixed(0)}%). A robust setting usually sits on a plateau, not on a spike.`);
      else if (nbMean < 0.8) add("warn", "Best pass is sensitive to small parameter changes", `Neighbours average ${(nbMean * 100).toFixed(0)}% of its score (worst ${(nbMin * 100).toFixed(0)}%).`);
      else add("ok", "Best pass sits on a plateau", `Neighbours average ${(nbMean * 100).toFixed(0)}% of its score (worst ${(nbMin * 100).toFixed(0)}%).`);
    } else add("info", "Neighbour check unavailable", "No direct parameter neighbours were found. This is normal for genetic or sparse optimizations; a full grid enables this test.");

    // forward
    let sp = NaN, fwdShare = NaN, fwdMed = NaN;
    if (ctx.idx.fwd !== undefined && ctx.idx.back !== undefined) {
      const fb = ctx.X.filter(r => Number.isFinite(r[ctx.idx.fwd]) && Number.isFinite(r[ctx.idx.back]));
      if (fb.length >= 10) {
        sp = QF.spearman(fb.map(r => r[ctx.idx.back]), fb.map(r => r[ctx.idx.fwd]));
        const tb = [...fb].sort((a, b) => b[ctx.idx.back] - a[ctx.idx.back]).slice(0, Math.max(5, Math.ceil(fb.length * 0.05)));
        fwdShare = tb.filter(r => r[ctx.idx.fwd] > 0).length / tb.length * 100;
        const rat = tb.filter(r => r[ctx.idx.back] > 0).map(r => r[ctx.idx.fwd] / r[ctx.idx.back]); fwdMed = QF.median(rat);
        if (sp < 0.1) add("risk", "In-sample rank does not carry forward", `Rank correlation between back and forward results is ${sp.toFixed(2)}. Optimizing on the back period did not select passes that do better forward.`);
        else if (sp < 0.3) add("warn", "Weak forward persistence", `Back/forward rank correlation is ${sp.toFixed(2)}.`);
        else add("ok", "Forward results follow back results", `Back/forward rank correlation is ${sp.toFixed(2)}.`);
        if (fwdShare < 50) add("risk", "Top back passes mostly fail forward", `Only ${fwdShare.toFixed(0)}% of the top back passes are profitable forward.`);
        if (Number.isFinite(fwdMed) && fwdMed < 0.5) add("warn", "Large forward degradation", `Median forward result is ${(fwdMed * 100).toFixed(0)}% of the back result among top passes.`);
      }
    } else add("info", "No forward data in this file", "Export a forward optimization (Forward Result / Back Result columns), or re-test the shortlisted passes on data that was not used for optimization. This is the strongest overfitting test available here.");

    // sample / quality of best
    if (tj !== undefined) {
      const bt = best[tj], tm = QF.median(top.map(r => r[tj]));
      if (bt < 30) add("risk", "Best pass has very few trades", `${bt} trades.`);
      else if (bt < 100) add("warn", "Best pass has a modest trade count", `${bt} trades.`);
      if (tm > 0 && bt < 0.5 * tm) add("warn", "Best pass trades far less than its peers", `${bt} trades vs a top-group median of ${tm.toFixed(0)}.`);
    }
    if (ctx.idx.pf !== undefined && best[ctx.idx.pf] > 3) add("warn", "Unusually high profit factor", `Best pass profit factor is ${best[ctx.idx.pf].toFixed(2)}. Verify cost modelling, tick quality and sample size.`);
    add("info", "Multiple testing", `${ctx.N} passes were evaluated. The best of many variants looks better than a typical one even when no edge exists, so judge the shortlist on data it has not seen.`);

    // parameter table
    const ptable = P.map(p => { const gv = p.values, tv = top.map(r => r[p.j]), gr = gv[gv.length - 1] - gv[0], tr = Math.max(...tv) - Math.min(...tv);
      return [p.name, String(+gv[0].toFixed(4)), String(+gv[gv.length - 1].toFixed(4)), String(best[p.j]), gr ? (tr / gr * 100).toFixed(0) + "%" : "—"]; });
    const metrics = [
      { label: "Passes analysed", value: n + (n < ctx.N ? " of " + ctx.N : "") },
      { label: "Best score", value: QF.fmt(best[sj]) },
      { label: "Median score (all)", value: QF.fmt(allMed) },
      { label: "Best ÷ top-group median", value: QF.fmt(spike) },
      { label: "Profitable passes", value: profitable.toFixed(1) + "%" },
      { label: "Neighbour score (mean / worst)", value: Number.isFinite(nbMean) ? (nbMean * 100).toFixed(0) + "% / " + (nbMin * 100).toFixed(0) + "%" : "N/A" },
      { label: "Back→forward rank correlation", value: QF.fmt(sp) },
      { label: "Top back passes profitable forward", value: Number.isFinite(fwdShare) ? fwdShare.toFixed(0) + "%" : "N/A" }
    ];
    if (!flags.some(f => f.level === "risk" || f.level === "warn")) add("ok", "No structural flags raised", "Not proof of robustness; confirm out of sample.");
    const show = sorted.slice(0, 10), cell = (r, j) => j === ctx.idx.trades ? String(r[j]) : QF.fmt(r[j]);
    const extraCols = ["trades", "pf", "eqdd"].filter(k => ctx.idx[k] !== undefined).map(k => ctx.idx[k]);
    const head = ["Rank", ctx.headers[sj], ...extraCols.filter(j => j !== sj).map(j => ctx.headers[j]), ...P.map(p => p.name)];
    const trows = show.map((r, i) => [i + 1, QF.fmt(r[sj]), ...extraCols.filter(j => j !== sj).map(j => cell(r, j)), ...P.map(p => String(r[p.j]))]);
    return { metrics, flags, scores, bestScore: best[sj], medianScore: allMed, scoreName: ctx.headers[sj], topK: K,
      tables: [{ title: "Top 10 passes", head, rows: trows }, { title: "Where the top " + K + " passes sit in each parameter's range", head: ["Parameter", "Tested min", "Tested max", "Best value", "Top-group spread (% of range)"], rows: ptable }] };
  };

  /* ---------- demo data (synthetic, seeded) ---------- */
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const gauss = r => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
  QF.demo = {
    trades(o) {
      o = o || {}; const r = rng(o.seed || 7), L = ["Time,Symbol,Type,Volume,Commission,Swap,Profit"]; let t = Date.UTC(2026, 0, 2, 8);
      for (let i = 0; i < (o.n || 220); i++) {
        t += (4 + Math.floor(r() * 20)) * 3600e3; const d = new Date(t), win = r() < (o.winP || 0.68);
        let p = win ? 22 + Math.abs(gauss(r)) * 14 : -(24 + Math.abs(gauss(r)) * 30) * (o.lossScale || 1); if (i === 90) p = 520; if (i === 150) p = -260;
        const ts = `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:00:00`;
        L.push([ts, i % 3 ? "EURUSD" : "XAUUSD", r() < 0.55 ? "buy" : "sell", "0.10", -0.7, (-0.1 * r()).toFixed(2), p.toFixed(2)].join(","));
      }
      return L.join("\n");
    },
    graph(o) {
      o = o || {}; const r = rng(o.seed || 11), L = ["DATE,BALANCE,EQUITY,DEPOSIT LOAD"]; let bal = 3000;
      for (let i = 0; i < 300; i++) { if (i % 6 === 0) bal += gauss(r) * 18 + 2; const fl = (r() < 0.35 ? 0 : (i > 120 && i < 170 ? Math.abs(gauss(r)) * 140 : Math.abs(gauss(r)) * 15)) * (o.floatScale || 1), dd = new Date(Date.UTC(2026, 0, 1 + (i >> 1))); L.push(`${dd.getUTCFullYear()}.${String(dd.getUTCMonth() + 1).padStart(2, "0")}.${String(dd.getUTCDate()).padStart(2, "0")},${bal.toFixed(2)},${(bal - fl).toFixed(2)},${(fl / 40 + r() * 3).toFixed(2)}`); }
      return L.join("\n");
    },
    optimization() {
      const r = rng(3), L = ["Pass;Result;Profit;Profit Factor;Equity DD %;Trades;Forward Result;Back Result;FastMA;SlowMA"]; let pass = 0;
      for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
        const ridge = 400 * Math.exp(-((i - 4) ** 2 + (j - 6) ** 2) / 18) - 100; let back = ridge + gauss(r) * 250, trades = Math.round(70 + r() * 140);
        if (i === 9 && j === 2) { back += 1800; trades = 24; }
        const fwd = 0.25 * ridge + gauss(r) * 250, pf = Math.max(0.6, Math.min(4, 1 + back / 3000 + (trades < 30 ? 1.2 : 0)));
        L.push([pass++, back.toFixed(2), back.toFixed(2), pf.toFixed(2), (8 + r() * 25).toFixed(2), trades, fwd.toFixed(2), back.toFixed(2), 5 + i * 5, 20 + j * 10].join(";"));
      }
      return L.join("\n");
    }
  };


  /* ---------- EA log analysis (Experts / Journal / terminal & tester logs) ---------- */
  const RET = { 10004: "requote", 10006: "rejected", 10013: "invalid request", 10014: "invalid volume", 10015: "invalid price", 10016: "invalid stops", 10017: "trade disabled", 10018: "market closed", 10019: "no money", 10024: "too many requests", 10027: "autotrading disabled", 10030: "invalid fill type", 10031: "no connection", 10033: "orders limit", 10034: "volume limit", 10040: "positions limit" };
  const HINTS = {
    "invalid stops": "SL/TP too close to price or inside the freeze level. Check SYMBOL_TRADE_STOPS_LEVEL and spread before sending, and normalise prices.",
    "invalid volume": "Lot is outside min/max or not a multiple of the volume step. Normalise with SYMBOL_VOLUME_MIN/MAX/STEP.",
    "invalid price": "Price not normalised to _Digits/tick size, or stale. Refresh rates and normalise before sending.",
    "no money": "Not enough free margin for the requested lot. Check lot sizing against free margin; the EA may be over-leveraged.",
    "off quotes": "Broker could not quote the requested price. Review deviation and avoid trading around news or rollover.",
    "requote": "Price moved before execution. Review deviation and cap the number of retries.",
    "market closed": "Order sent while the market was closed. Add a session/time filter (SymbolInfoSessionTrade).",
    "trade disabled": "Trading is disabled for the account, symbol or terminal. Check permissions and the EA's allow-trading setting.",
    "autotrading disabled": "AutoTrading is off in the terminal. The EA should detect this and stop sending orders.",
    "too many requests": "Order/modify calls are too frequent. Throttle requests; do not modify on every tick.",
    "timeout": "Request timed out. Check connection/VPS latency and verify the order state before resending.",
    "rejected": "Broker rejected the request. Inspect the retcode, fill mode and deviation.",
    "invalid fill type": "Order filling mode not supported by the symbol. Select the fill mode from SYMBOL_FILLING_MODE.",
    "invalid request": "Malformed trade request. Log the full MqlTradeRequest and verify every field.",
    "no connection": "No connection to the trade server. Add handling for disconnects.",
    "orders limit": "Pending-order limit reached. Clean up or cap pending orders.",
    "volume limit": "Total volume limit reached for the symbol.",
    "positions limit": "Open-position limit reached. Cap the number of positions the EA can open.",
    "position not found": "Modify/close was sent for a position that no longer exists. Re-check the position before acting.",
    "frozen": "Order is inside the freeze level. Check SYMBOL_TRADE_FREEZE_LEVEL.",
    "no prices": "No prices available. Common in tests with missing data; check history quality."
  };
  QF.logHints = HINTS;
  const RE = {
    ts: /(\d{4})\.(\d{2})\.(\d{2})[ \t]+(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/, tod: /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/, tag: /\(([A-Za-z0-9#._+\-]{3,20}),\s*(M\d+|H\d+|D1|W1|MN1|Tick)\)/,
    critical: /array out of range|zero divide|critical error|invalid pointer|stack overflow|access violation|unhandled exception|out of memory|cannot (?:load|open)/i,
    stopout: /stop out|margin call|stopout/i,
    bracket: /\[([a-z][a-z ]{2,30})\]/i, retcode: /retcode[=: ]*(\d{5})/i,
    tradeErr: /\[(?:invalid stops|invalid volume|invalid price|no money|off quotes|requote|market closed|trade disabled|too many requests|timeout|trade timeout|rejected|frozen|no prices|position not found|invalid request|not enough money|client disables at\w*|invalid expiration|hedging prohibited)\]|retcode[=: ]*10(?:004|006|013|014|015|016|017|018|019|024|027|030|031|033|034|040)\b|ordersend (?:error|failed)|failed (?:market|modify|close|instant|buy|sell|pending)/i,
    warn: /\b(error|failed|failure|warning|cannot|invalid)\b/i,
    deal: /\bdeal #\d+ (?:buy|sell)\b/i, orderOk: /\b(?:buy|sell)\b.*\[(?:done|placed)/i,
    init: /loaded successfully|\binitialized\b|\binit(?:ialization)? (?:ok|done)\b/i, deinit: /\bremoved\b|\buninit|\bdeinit/i
  };
  const reasonOf = msg => {
    const rc = RE.retcode.exec(msg); if (rc && RET[rc[1]]) return RET[rc[1]];
    const b = RE.bracket.exec(msg); if (b) { let r = b[1].toLowerCase().trim(); if (r === "not enough money") r = "no money"; if (r === "trade timeout") r = "timeout"; if (/^client disables/.test(r)) r = "autotrading disabled"; return r; }
    return /ordersend/i.test(msg) ? "ordersend error" : "other";
  };
  QF.parseLog = function (text) {
    text = text.replace(/^\uFEFF/, "").replace(/\u0000/g, "");
    let lines = text.split(/\r?\n/), truncated = false; if (lines.length > 500000) { lines = lines.slice(0, 500000); truncated = true; }
    const entries = [];
    for (const raw of lines) {
      const line = raw.trim(); if (!line) continue;
      let msg = line, src = null, ts = null; const f = line.split("\t");
      if (f.length >= 5 && /^[A-Z]{2}$/.test(f[0]) && /^\d+$/.test(f[1])) {
        src = f[3]; msg = f.slice(4).join(" "); const t = RE.tod.exec(f[2]); if (t) ts = Date.UTC(1970, 0, 1, +t[1], +t[2], +t[3]);
      }
      const m = RE.ts.exec(line); if (m) ts = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
      const tag = RE.tag.exec(line); msg = msg.replace(RE.ts, "").replace(/\s+/g, " ").trim();
      let cat = "info", reason = null;
      if (RE.critical.test(msg)) cat = "critical";
      else if (RE.stopout.test(msg)) cat = "stopout";
      else if (RE.tradeErr.test(msg)) { cat = "trade_error"; reason = reasonOf(msg); }
      else if (RE.warn.test(msg)) cat = "warning";
      else if (RE.deal.test(msg)) cat = "deal";
      else if (RE.orderOk.test(msg)) cat = "order_ok";
      else if (RE.init.test(msg)) cat = "init";
      else if (RE.deinit.test(msg)) cat = "deinit";
      entries.push({ ts, src, sym: tag ? tag[1] : null, tf: tag ? tag[2] : null, msg, cat, reason });
    }
    if (!entries.length) throw new Error("The file has no readable lines.");
    return { entries, truncated };
  };
  const CATNAME = { critical: "Critical runtime error", stopout: "Stop-out / margin call", trade_error: "Trade request error", warning: "Other warning/error", deal: "Deal", order_ok: "Order accepted", init: "EA initialised", deinit: "EA removed/deinit", info: "Info" };
  QF.analyzeLog = function (parsed) {
    const E = parsed.entries, n = E.length, cnt = {}; E.forEach(e => cnt[e.cat] = (cnt[e.cat] || 0) + 1);
    const g = k => cnt[k] || 0, failed = g("trade_error"), okOrders = Math.max(g("order_ok"), g("deal")), attempts = failed + okOrders, failRate = attempts ? failed / attempts * 100 : NaN;
    const dated = E.filter(e => e.ts !== null), tsMin = dated.length ? Math.min(...dated.map(e => e.ts)) : null, tsMax = dated.length ? Math.max(...dated.map(e => e.ts)) : null;
    const errs = E.filter(e => e.cat === "trade_error" || e.cat === "critical" || e.cat === "warning");
    // per-minute peaks
    const perMin = new Map(), perReason = new Map();
    errs.forEach(e => { if (e.ts === null) return; const mi = Math.floor(e.ts / 60000); perMin.set(mi, (perMin.get(mi) || 0) + 1); if (e.cat === "trade_error") { const k = e.reason + "|" + mi; perReason.set(k, (perReason.get(k) || 0) + 1); } });
    const peakMin = perMin.size ? Math.max(...perMin.values()) : 0;
    let storm = null; perReason.forEach((v, k) => { if (v >= 10 && (!storm || v > storm.n)) storm = { n: v, reason: k.split("|")[0] }; });
    // reasons
    const rc = new Map(); E.filter(e => e.cat === "trade_error").forEach(e => rc.set(e.reason, (rc.get(e.reason) || 0) + 1));
    const reasons = [...rc.entries()].sort((a, b) => b[1] - a[1]);
    // repeated messages
    const rep = new Map(); E.forEach(e => { const k = e.msg.toLowerCase().replace(/[-+]?\d+(?:\.\d+)?/g, "#").slice(0, 120); const r = rep.get(k); if (r) r.n++; else rep.set(k, { n: 1, cat: e.cat, sample: e.msg.slice(0, 110) }); });
    const topRep = [...rep.values()].sort((a, b) => b.n - a.n).slice(0, 8);
    const crit = E.filter(e => e.cat === "critical"), inits = g("init"), syms = new Set(E.map(e => e.sym && e.tf ? e.sym + " " + e.tf : null).filter(Boolean));

    const span = tsMin !== null && tsMax > tsMin ? (() => { const s = (tsMax - tsMin) / 1000; return s >= 86400 ? (s / 86400).toFixed(1) + " days" : s >= 3600 ? (s / 3600).toFixed(1) + " hours" : Math.max(1, Math.round(s / 60)) + " min"; })() : "N/A";
    const metrics = [
      { label: "Log lines", value: String(n) }, { label: "Time span", value: span },
      { label: "Critical runtime errors", value: String(g("critical")) }, { label: "Stop-out / margin call lines", value: String(g("stopout")) },
      { label: "Order attempts (accepted + failed)", value: String(attempts) }, { label: "Failed order requests", value: failed + (Number.isFinite(failRate) ? " (" + failRate.toFixed(1) + "%)" : "") },
      { label: "Peak errors in one minute", value: dated.length ? String(peakMin) : "N/A" }, { label: "EA initialisations", value: String(inits) },
      { label: "Symbols / timeframes seen", value: String(syms.size) }
    ];
    const flags = [], add = (l, t, x) => flags.push({ level: l, title: t, text: x });
    if (g("critical")) add("risk", "Critical runtime errors", `${g("critical")} lines such as: "${crit[0].msg.slice(0, 120)}". These can stop the EA's logic mid-execution; fix before trusting any backtest result.`);
    if (g("stopout")) add("risk", "Stop-out or margin-call lines present", `${g("stopout")} lines. The account was forced to close positions; review lot sizing and exposure.`);
    if (attempts >= 10 && failRate > 20) add("risk", "High order failure rate", `${failRate.toFixed(1)}% of ${attempts} order attempts failed.`);
    else if (attempts >= 10 && failRate > 5) add("warn", "Noticeable order failure rate", `${failRate.toFixed(1)}% of ${attempts} order attempts failed.`);
    if (storm) add("warn", "Retry storm", `${storm.n} "${storm.reason}" errors inside a single minute. The EA probably resends a failing order on every tick; add a retry limit and back-off.`);
    reasons.filter(x => x[1] >= 5).slice(0, 3).forEach(([r, c]) => add("warn", `Frequent trade error: ${r} (${c}×)`, HINTS[r] || "Review the full request and server response for this error."));
    if (topRep[0] && topRep[0].n > 100 && topRep[0].n / n > 0.3) add("warn", "Log flooding", `One message pattern makes up ${(topRep[0].n / n * 100).toFixed(0)}% of the log (${topRep[0].n}×): "${topRep[0].sample}". It hides real problems and slows the tester; log on state change instead.`);
    if (inits > 3) add("warn", "EA initialised many times", `${inits} initialisation lines. Repeated restarts reset internal state (counters, grid levels, trailing data) unless it is persisted.`);
    const undated = n - dated.length; if (undated > 0.5 * n) add("info", "Few timestamps", `${undated} of ${n} lines carry no timestamp, so burst detection is limited.`);
    if (parsed.truncated) add("info", "Log truncated", "Only the first 500,000 lines were analysed.");
    add("info", "Heuristic classification", "Lines are classified by text patterns. Wording differs between brokers and MT5 builds, so check unclassified or surprising results against the raw log.");
    if (!flags.some(f => f.level === "risk" || f.level === "warn")) add("ok", "No structural flags raised", "Nothing alarming was matched. Not proof the EA behaved correctly.");

    const tables = [
      { title: "Line categories", head: ["Category", "Lines", "Share"], rows: Object.keys(CATNAME).filter(k => g(k)).map(k => [CATNAME[k], g(k), (g(k) / n * 100).toFixed(1) + "%"]) }
    ];
    if (reasons.length) tables.push({ title: "Trade error reasons", head: ["Reason", "Count", "What to check"], rows: reasons.slice(0, 10).map(([r, c]) => [r, c, HINTS[r] || "Inspect the raw lines."]) });
    tables.push({ title: "Most repeated messages", head: ["Count", "Category", "Example (numbers vary)"], rows: topRep.map(r => [r.n, CATNAME[r.cat], r.sample]) });
    const bySym = new Map(); E.forEach(e => { if (!e.sym) return; const k = e.sym + " " + e.tf, r = bySym.get(k) || [0, 0]; r[0]++; if (e.cat === "trade_error" || e.cat === "critical") r[1]++; bySym.set(k, r); });
    if (bySym.size > 1) tables.push({ title: "By symbol / timeframe", head: ["Symbol TF", "Lines", "Errors"], rows: [...bySym.entries()].sort((a, b) => b[1][1] - a[1][1]).slice(0, 12).map(([k, v]) => [k, v[0], v[1]]) });
    if (dated.length >= 0.5 * n && errs.length) { const h = new Array(24).fill(0); errs.forEach(e => { if (e.ts !== null) h[new Date(e.ts).getUTCHours()]++; }); tables.push({ title: "Errors by hour (log clock)", head: ["Hour", "Errors"], rows: h.map((v, i) => [String(i).padStart(2, "0") + ":00", v]).filter(r => r[1]) }); }
    if (crit.length) tables.push({ title: "Critical lines (first 5)", head: ["Message"], rows: crit.slice(0, 5).map(e => [e.msg.slice(0, 160)]) });
    return { metrics, flags, tables, label: "EA log analysis" };
  };
  QF.demo.log = function () {
    const r = rng(21), L = []; let t = Date.UTC(2026, 2, 2, 8, 0, 0); const stamp = () => { const d = new Date(t); return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}.${String(Math.floor(r() * 999)).padStart(3, "0")}`; };
    const w = m => L.push(stamp() + "\tGridEA (EURUSD,M15)\t" + m);
    w("GridEA loaded successfully");
    for (let i = 0; i < 400; i++) {
      t += 20e3 + Math.floor(r() * 60e3);
      if (i % 2 === 0) w("Signal check: spread " + Math.floor(8 + r() * 9) + " points, ATR " + (0.0008 + r() * 0.0004).toFixed(5));
      if (i % 9 === 0) w("CTrade::OrderSend: market " + (r() < 0.5 ? "buy" : "sell") + " 0.10 EURUSD sl: 1.0" + Math.floor(800 + r() * 90) + " tp: 1.1" + Math.floor(r() * 90) + " [done at 1.0" + Math.floor(900 + r() * 80) + "]");
      if (i === 150) for (let k = 0; k < 28; k++) { t += 1500; w("CTrade::OrderSend: market buy 0.10 EURUSD sl: 1.09420 tp: 1.09500 [invalid stops]"); }
      if (i > 250 && i % 12 === 0) w("failed market buy 0." + Math.floor(10 + r() * 40) + " EURUSD [no money]");
      if (i === 300) w("array out of range in 'GridEA.mq5' (412,25)");
      if (i === 340) w("stop out occurred: margin level 48.2% below 50%");
      if (i === 200 || i === 330) w("GridEA loaded successfully");
      if (i % 40 === 0) w("failed modify #" + (1000 + i) + " buy 0.10 EURUSD [too many requests]");
    }
    return L.join("\n");
  };


  /* ---------- MQL5 static review (pattern-based, not a compiler) ---------- */
  function mqlStrip(src) {
    let clean = "", keep = "", i = 0; const n = src.length;
    while (i < n) {
      const c = src[i], d = src[i + 1];
      if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") { clean += " "; keep += " "; i++; } }
      else if (c === "/" && d === "*") {
        clean += "  "; keep += "  "; i += 2;
        while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { const ch = src[i] === "\n" ? "\n" : " "; clean += ch; keep += ch; i++; }
        if (i < n) { clean += "  "; keep += "  "; i += 2; }
      } else if (c === "'" && src[i + 2] === "'") { clean += "   "; keep += src.slice(i, i + 3); i += 3; }
      else if (c === '"') {
        clean += '"'; keep += '"'; i++;
        while (i < n && src[i] !== '"' && src[i] !== "\n") { if (src[i] === "\\" && i + 1 < n && src[i + 1] !== "\n") { clean += "  "; keep += src[i] + src[i + 1]; i += 2; continue; } clean += " "; keep += src[i]; i++; }
        if (i < n && src[i] === '"') { clean += '"'; keep += '"'; i++; }
      } else { clean += c; keep += c; i++; }
    }
    return { clean, keep };
  }
  function splitArgs(t, open) {
    const a = []; let depth = 0, cur = "";
    for (let i = open; i < t.length; i++) {
      const c = t[i];
      if (c === "(" || c === "[" || c === "{") { if (depth++ === 0) continue; }
      else if (c === ")" || c === "]" || c === "}") { if (--depth === 0) { a.push(cur); return a; } }
      else if (c === "," && depth === 1) { a.push(cur); cur = ""; continue; }
      cur += c;
    }
    return a;
  }
  function braceEnd(t, open) { let d = 0; for (let i = open; i < t.length; i++) { if (t[i] === "{") d++; else if (t[i] === "}" && --d === 0) return i; } return t.length - 1; }
  const IND = "(?:MA|RSI|ATR|Bands|MACD|Stochastic|CCI|ADX|Custom|Momentum|SAR|Envelopes|StdDev|WPR|AMA|DEMA|TEMA|BearsPower|BullsPower|MFI|OBV|AC|AO|Ichimoku|Force|RVI)";
  const ORDER_CALL = "(?:OrderSend|OrderSendAsync|\\.\\s*(?:Buy|Sell|BuyLimit|SellLimit|BuyStop|SellStop|PositionOpen|OrderOpen))\\s*\\(";
  QF.reviewMQL = function (src) {
    if (!src || src.trim().length < 20) throw new Error("Paste or upload MQL5 source code first.");
    const { clean, keep } = mqlStrip(src.replace(/^\uFEFF/, "").replace(/\u0000/g, ""));
    const starts = [0]; for (let i = 0; i < clean.length; i++) if (clean[i] === "\n") starts.push(i + 1);
    const lineAt = idx => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= idx) lo = m; else hi = m - 1; } return lo + 1; };
    const find = (re, text) => { text = text === undefined ? clean : text; const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"), o = []; let m; while ((m = g.exec(text))) { o.push({ idx: m.index, line: lineAt(m.index), m }); if (!m[0].length) g.lastIndex++; } return o; };
    const has = re => new RegExp(re.source, re.flags.replace("g", "")).test(clean);
    const ln = h => { const u = [...new Set(h.map(x => x.line))]; return u.length ? (u.length > 6 ? "lines " + u.slice(0, 6).join(", ") + "…" : (u.length > 1 ? "lines " : "line ") + u.join(", ")) : ""; };
    const codeLines = clean.split("\n").filter(l => l.trim()).length;
    const body = name => { const m = new RegExp("\\b(?:void|int)\\s+" + name + "\\s*\\(").exec(clean); if (!m) return null; const o = clean.indexOf("{", m.index); return o < 0 ? null : { start: o, end: braceEnd(clean, o) }; };
    const funcs = ["OnInit", "OnDeinit", "OnTick", "OnTimer", "OnTrade", "OnTradeTransaction", "OnTester", "OnChartEvent"].filter(f => has(new RegExp("\\b(?:void|int|double)\\s+" + f + "\\s*\\(")));
    const inputs = find(/\b(?:sinput|input)\s+([A-Za-z_][\w:<>]*)\s+([A-Za-z_]\w*)\s*=\s*([^;]+);/, keep).map(h => [h.m[1], h.m[2], h.m[3].trim(), h.line]);
    const base = { label: "MQL5 code review" };
    if (/\bint\s+start\s*\(\s*\)/.test(clean) || (/\bOrderSelect\s*\([^)]*SELECT_BY_POS/.test(clean) && /\bMODE_TRADES\b/.test(clean)))
      return Object.assign(base, { metrics: [{ label: "Code lines", value: String(codeLines) }, { label: "Dialect", value: "MQL4 (detected)" }], flags: [{ level: "info", title: "MQL4 syntax detected", text: "This reviewer targets MQL5 (CTrade / MqlTradeRequest / position model). Port the code to MQL5 first, or ask for a manual review of the MQL4 logic." }], tables: [] });

    const sites = [];
    find(/\b(OrderSend|OrderSendAsync)\s*\(/).forEach(h => sites.push({ kind: h.m[1], line: h.line, open: h.idx + h.m[0].length - 1 }));
    find(/\.\s*(Buy|Sell|BuyLimit|SellLimit|BuyStop|SellStop|PositionOpen|OrderOpen)\s*\(/).forEach(h => sites.push({ kind: h.m[1], line: h.line, open: h.idx + h.m[0].length - 1 }));
    const hasOrders = sites.length > 0, R = [], rule = (name, status, detail, why) => R.push({ name, status, detail: detail || "", why: why || "" });
    const need = (name, re, okTxt, badLevel, badTxt, why) => has(re) ? rule(name, "ok", okTxt) : rule(name, badLevel, badTxt, why);

    if (!hasOrders) rule("Order-sending calls", "info", "No OrderSend / CTrade order calls were found, so trade-related checks were skipped. If orders are sent from an included file, review that file too.");
    else {
      // stop loss
      const SLI = { Buy: 3, Sell: 3, BuyLimit: 3, SellLimit: 3, BuyStop: 3, SellStop: 3, PositionOpen: 4, OrderOpen: 5 };
      const ct = sites.filter(x => SLI[x.kind] !== undefined), zero = ct.filter(x => { const v = splitArgs(clean, x.open)[SLI[x.kind]]; return v === undefined || /^\s*(0|0\.0*|NULL)\s*$/.test(v); });
      const asg = find(/\.\s*sl\s*=\s*([^;]+);/), nz = asg.filter(h => !/^\s*(0|0\.0*)\s*$/.test(h.m[1]));
      if (ct.length - zero.length + nz.length === 0) rule("Stop loss on orders", "risk", `No order is sent with a stop loss (${ln(sites)}).`, "An open-ended loss can wipe the account in one adverse move. If the EA closes losers by logic instead, make sure that logic cannot fail or be skipped.");
      else if (zero.length) rule("Stop loss on orders", "warn", `Some orders are sent with SL = 0 (${ln(zero)}).`, "Positions opened there carry unlimited risk.");
      else rule("Stop loss on orders", "ok", "Every order call passes a non-zero stop loss.");
      const slIn = inputs.filter(i => /stop\s*loss|(^|_)sl(_|$)|^inp?sl|slpoints|slpips/i.test(i[1]) && /^(0|0\.0*)$/.test(i[2]));
      if (slIn.length) rule("Stop-loss input default", "warn", `${slIn.map(i => i[1]).join(", ")} defaults to 0 (line ${slIn[0][3]}).`, "A default of 0 usually means no stop loss in every backtest run with default settings.");
      // martingale / grid
      const mart = find(/\b(\w*lot\w*)\s*(?:\*=|=\s*\w*lot\w*\s*\*\s*[\w.]+)/i);
      if (mart.length) rule("Lot escalation (martingale-like)", "warn", `Lot size is multiplied (${ln(mart)}).`, "Escalating lots after losses produces smooth equity curves until one long run breaks the account. Test with the worst historical streak and check margin at each step.");
      else { const g = find(/\b\w*(?:martingale|grid|averag(?:e|ing)|recovery)\w*/i); rule("Lot escalation (martingale-like)", g.length ? "info" : "ok", g.length ? `Grid/averaging terminology found (${ln(g)}); verify how exposure grows.` : "No lot-multiplication pattern found."); }
      // sizing & prices
      need("Lot normalisation", /SYMBOL_VOLUME_(?:STEP|MIN|MAX)/, "Volume step/min/max are used.", "warn", "No use of SYMBOL_VOLUME_STEP/MIN/MAX.", "Un-normalised lots cause 'invalid volume' errors on some brokers or symbols.");
      need("Price normalisation", /NormalizeDouble\s*\(|\bNormalizePrice|_Digits|SYMBOL_DIGITS|SYMBOL_TRADE_TICK_SIZE/, "Prices are normalised.", "warn", "No NormalizeDouble/_Digits/tick-size handling.", "Un-normalised SL/TP/price values cause 'invalid price' / 'invalid stops'.");
      need("Free-margin check", /OrderCalcMargin|ACCOUNT_MARGIN_FREE|ACCOUNT_FREEMARGIN|FreeMargin/i, "Margin is checked.", "warn", "No free-margin check before sending orders.", "Without it the EA keeps trying orders it cannot afford ('no money').");
      // results
      const hasRes = has(/\bResultRetcode\s*\(|\bGetLastError\s*\(|\bResultDeal\s*\(|\bretcode\b|TRADE_RETCODE_/i), un = find(/^[ \t]*OrderSend\s*\(/m);
      if (!hasRes || un.length) rule("Order result handling", "warn", !hasRes ? "No retcode / GetLastError / ResultRetcode handling found." : `OrderSend result ignored (${ln(un)}).`, "A failed order that is not detected leaves the EA's state out of sync with the account and can trigger retry storms.");
      else rule("Order result handling", "ok", "Order results are inspected.");
      // retry loops
      const loops = find(/\b(?:while|for)\s*\(/).filter(h => {
        const o = h.idx + h.m[0].length - 1; let d = 0, e = o; for (; e < clean.length; e++) { if (clean[e] === "(") d++; else if (clean[e] === ")" && --d === 0) break; }
        let b = e + 1; while (b < clean.length && /\s/.test(clean[b])) b++;
        const end = clean[b] === "{" ? braceEnd(clean, b) : clean.indexOf(";", b), txt = clean.slice(o, end < 0 ? clean.length : end + 1);
        return new RegExp(ORDER_CALL).test(txt) && !/\b(?:break|attempt|retry|retries|tries)\w*/i.test(txt);
      });
      rule("Bounded order retries", loops.length ? "warn" : "ok", loops.length ? `Order call inside a loop with no visible retry limit (${ln(loops)}).` : "No unbounded order loops found.", "In the Log Reader this shows up as a retry storm: the same failed request repeated many times per minute.");
      need("Stops / freeze level", /STOPS_LEVEL|FREEZE_LEVEL/, "Stops and freeze level are read.", "warn", "SYMBOL_TRADE_STOPS_LEVEL / FREEZE_LEVEL are never read.", "The usual cause of 'invalid stops' errors.");
      // exposure controls
      need("Position / exposure cap", /PositionsTotal\s*\(|OrdersTotal\s*\(|PositionSelect|count\w*pos|pos\w*count/i, "Positions are counted.", "warn", "No PositionsTotal/OrdersTotal logic: nothing visibly limits how many positions open.", "Unlimited stacking is how small errors become large drawdowns.");
      need("Magic number", /SetExpertMagicNumber|POSITION_MAGIC|ORDER_MAGIC|DEAL_MAGIC|\.magic\s*=|\bmagic\b/i, "A magic number is used.", "warn", "No magic number.", "The EA cannot tell its positions from manual trades or other EAs.");
      const eqG = has(/ACCOUNT_EQUITY|ACCOUNT_BALANCE|AccountInfoDouble/) && has(/drawdown|max_?dd|dd_?(?:pct|percent|limit)|max\w*loss|daily\w*loss|\bdd\b|equity\w*stop|kill|stop\s*trading/i);
      rule("Drawdown / equity kill-switch", eqG ? "ok" : "warn", eqG ? "Equity is compared with a limit." : "No equity or daily-loss limit found.", "A hard stop on account drawdown caps the damage when the strategy stops working.");
      need("Spread filter", /SYMBOL_SPREAD|SymbolInfoInteger\s*\([^)]*SPREAD|\bask\b\s*-\s*\bbid\b|spread/i, "Spread is considered.", "warn", "No spread check.", "Wide spreads at rollover or news turn marginal setups into losses and trigger stop errors.");
      need("Session / time filter", /TimeCurrent\s*\(|TimeToStruct|SymbolInfoSessionTrade|TimeLocal|TimeGMT|\bhour\b/i, "Time is considered.", "info", "No time or session filter.", "Trading while the market is closed produces 'market closed' errors.");
      const hc = find(/"(?:EUR|GBP|USD|AUD|NZD|CAD|CHF|JPY|XAU|XAG|BTC|ETH)[A-Z]{3}[a-z._#]?"/, keep).filter(h => !/^\s*(?:s?input)\b/.test(keep.slice(starts[h.line - 1], starts[h.line] || keep.length)));
      rule("Hard-coded symbol", hc.length ? "info" : "ok", hc.length ? `Symbol literal in code (${ln(hc)}); use _Symbol or an input.` : "No hard-coded symbol literals.");
    }
    // data / indicator handling
    const ot = body("OnTick");
    if (ot) {
      const ii = find(new RegExp("\\bi" + IND + "\\s*\\("), clean.slice(ot.start, ot.end)).map(h => ({ line: lineAt(ot.start + h.idx) }));
      rule("Indicator handles in OnTick", ii.length ? "warn" : "ok", ii.length ? `Indicator created inside OnTick (${ln(ii)}).` : "No indicator creation inside OnTick.", "Creating a handle on every tick is slow and leaks resources unless guarded by a one-time check. Create handles in OnInit.");
      rule("New-bar logic", has(/iTime\s*\(|new_?bar|last_?bar|prev_?bar|bar_?time/i) ? "ok" : "info", has(/iTime\s*\(|new_?bar|last_?bar|prev_?bar|bar_?time/i) ? "A new-bar guard exists." : "Logic runs on every tick; consider a new-bar guard unless tick-level logic is intended.", "Per-tick signals on an unfinished bar can flip and repaint, so live results may differ from bar-based tests.");
    } else rule("OnTick", "info", "No OnTick found (timer- or event-driven EA?). OnTick-specific checks were skipped.");
    const unCopy = find(/^[ \t]*Copy(?:Buffer|Rates|Close|High|Low|Open|Time)\s*\(/m);
    rule("Copy* result checked", unCopy.length ? "warn" : "ok", unCopy.length ? `Return value of CopyBuffer/CopyRates ignored (${ln(unCopy)}).` : "No ignored Copy* results.", "If data is not ready the array stays empty or stale and the EA trades on garbage values or crashes with 'array out of range'.");
    if (has(/\bCopy(?:Buffer|Rates|Close|High|Low|Open|Time)\s*\(/)) rule("ArraySetAsSeries", has(/ArraySetAsSeries/) ? "ok" : "info", has(/ArraySetAsSeries/) ? "Series direction is set." : "Copy* used but ArraySetAsSeries never called; confirm which index is the latest bar.", "Reading index 0 as 'current' when the array is oldest-first is a classic silent bug.");
    if (has(new RegExp("\\bi" + IND + "\\s*\\("))) rule("IndicatorRelease", has(/IndicatorRelease/) ? "ok" : "info", has(/IndicatorRelease/) ? "Handles are released." : "Handles are created but IndicatorRelease is never called (OnDeinit).");
    const sl = find(/\bSleep\s*\(/); rule("Sleep() calls", sl.length ? "warn" : "ok", sl.length ? `Sleep() used (${ln(sl)}).` : "No Sleep() calls.", "Sleep blocks the EA thread, so it misses ticks, and it distorts timing in the tester.");
    const fe = find(/\b(?:price|lots?|volume|sl|tp|ask|bid|stoploss|takeprofit|equity|balance)\w*\s*(?:==|!=)\s*([\w.()]+)/i).filter(h => !/^0(\.0*)?$/.test(h.m[1]));
    rule("Floating-point equality", fe.length ? "info" : "ok", fe.length ? `Possible double compared with ==/!= (${ln(fe)}).` : "No suspicious double equality found.", "Compare doubles with a tolerance (e.g. MathAbs(a-b) < _Point/2) or normalise both sides first.");

    const lab = { ok: "OK", risk: "Risk", warn: "Review", info: "Note" };
    const evalR = R.filter(r => r.status !== "skip"), okN = evalR.filter(r => r.status === "ok").length;
    const flags = ["risk", "warn", "info"].flatMap(st => R.filter(r => r.status === st).map(r => ({ level: st, title: r.name, text: (r.detail + " " + r.why).trim() })));
    if (!flags.some(f => f.level === "risk" || f.level === "warn")) flags.push({ level: "ok", title: "No structural flags raised", text: "The pattern checks found nothing alarming. This is a static scan, not a compile or a test: it cannot prove the logic is correct." });
    flags.push({ level: "info", title: "How to read this", text: "Pattern-based scan of the source text. It can miss logic in included files and can flag code that is handled in a way the patterns do not recognise. Treat each item as a question to answer, not a verdict." });
    const metrics = [
      { label: "Code lines (excl. comments/blank)", value: String(codeLines) }, { label: "Event handlers found", value: funcs.length ? funcs.join(", ") : "none" },
      { label: "Order-sending call sites", value: String(sites.length) }, { label: "Input parameters", value: String(inputs.length) },
      { label: "Checks passed", value: okN + " of " + evalR.length }, { label: "Risk / Review items", value: R.filter(r => r.status === "risk").length + " / " + R.filter(r => r.status === "warn").length }
    ];
    const tables = [{ title: "Checklist", head: ["Check", "Result", "Detail"], rows: R.map(r => [r.name, lab[r.status] || r.status, r.detail || "—"]) }];
    if (inputs.length) tables.push({ title: "Input parameters (candidates for the Optimization Check)", head: ["Type", "Name", "Default", "Line"], rows: inputs.map(i => [i[0], i[1], i[2], i[3]]) });
    return Object.assign(base, { metrics, flags, tables });
  };
  QF.demo.mql = function () {
    return `//+------------------------------------------------------------------+
//| GridEA demo (synthetic, deliberately flawed)                      |
//+------------------------------------------------------------------+
#include <Trade\\Trade.mqh>
CTrade trade;

input double InpLot           = 0.10;
input double InpLotMultiplier = 2.0;   // martingale step
input int    InpStopLoss      = 0;
input int    InpTakeProfit    = 200;
input int    InpGridStep      = 150;
input int    InpMaPeriod      = 20;

double lastLot;
double lastEntry;

int OnInit()
{
   lastLot = InpLot;
   return INIT_SUCCEEDED;
}

void OnTick()
{
   int h = iMA(_Symbol, PERIOD_CURRENT, InpMaPeriod, 0, MODE_SMA, PRICE_CLOSE);
   double ma[];
   CopyBuffer(h, 0, 0, 3, ma);

   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double tp  = ask + InpTakeProfit * _Point;

   if(ask > ma[0] && PositionsTotal() == 0)
   {
      trade.Buy(lastLot, "EURUSD", ask, 0, tp);
      lastEntry = ask;
   }

   if(PositionsTotal() > 0 && bid < lastEntry - InpGridStep * _Point)
   {
      lastLot = lastLot * InpLotMultiplier;
      while(!trade.Buy(lastLot, _Symbol, ask, 0, tp))
      {
         Sleep(500);
      }
      lastEntry = ask;
   }
}
`;
  };


  /* ---------- Test-plan generator ---------- */
  const DAY = 864e5, iso = t => new Date(t).toISOString().slice(0, 10), mon = d => (d / 30.4375).toFixed(1);
  const TYPE_CHECKS = {
    trend: [["Range / choppy regimes", "Split results by regime (e.g. ADX or volatility bands). A trend system should lose small in ranges, not give back all trend profit."], ["Late entries", "Delay signals by 1–2 bars. A real trend edge survives small delays."]],
    meanrev: [["Strong trending regimes", "Find the longest one-way trend in the sample and measure the loss it caused. Mean reversion earns small and loses big."], ["Worst trade vs average win", "Confirm every trade has a hard stop and compare the worst trade with the average win."]],
    grid: [["Worst-case adverse run", "Replay the longest one-way move in the data. Record maximum open lots, floating loss and margin level at the deepest grid level."], ["Margin at the last step", "Compute the margin needed at the last allowed step. It must stay under your limit for the largest adverse move seen, with a safety multiple."], ["Stop-out distance", "Re-run with a smaller deposit and higher leverage to see how close the system runs to stop-out."]],
    scalper: [["Spread and slippage", "Edge per trade is often smaller than a spread widening. Test spread ×2 and an execution delay."], ["Tick quality", "Use real ticks if available; generated ticks flatter scalpers."]],
    breakout: [["False breakouts", "Inspect results around news and rollover; test with wider spread and delayed fills."], ["Entry timing", "Shift entries by one bar."]],
    other: []
  };
  const CONCERNS = {
    retry: ["Log Reader: retry storm", "Add a retry limit and back-off to order sending, re-run a short test.", "Log Reader shows no retry-storm finding and no unbounded order loop in Code Review.", "Log Reader, Code Review"],
    invalid: ["Log Reader: invalid stops / invalid price", "Read stops and freeze levels, normalise prices to _Digits, re-run.", "Zero 'invalid stops' / 'invalid price' lines in the tester log.", "Log Reader"],
    nomoney: ["Log Reader: no money / failed orders", "Add a free-margin check before every order; cap lot size.", "Order failure rate under 5% and no 'no money' reasons.", "Log Reader"],
    outlier: ["Analyzer: result depends on a few trades", "Extend the sample and add validation symbols; track the result without the best 5% of trades.", "Net result without the best 5% of trades stays positive.", "Backtest Analyzer"],
    floating: ["Analyzer: drawdown is mostly floating", "Inspect holding times of the worst stretches; test with an equity-based stop.", "Equity drawdown within the limit below, and not more than twice balance drawdown.", "Backtest Analyzer"],
    spike: ["Optimization: isolated peak", "Choose the centre of a stable region, not the top pass; re-test its neighbours.", "Neighbour check shows at least 80% of the chosen pass's score.", "Optimization Check"],
    fewtrades: ["Too few trades", "Lengthen the period and add validation symbols before judging any statistic.", "Meets the minimum trade count below in both in-sample and out-of-sample.", "Backtest Analyzer"],
    costs: ["Costs eat a large share of profit", "Run the cost-stress matrix and consider lower trade frequency.", "Profit factor stays above the stressed threshold below.", "Backtest Analyzer"],
    martingale: ["Code Review: lot escalation (martingale-like)", "Cap the escalation steps and compute margin at the deepest step.", "Margin level at the deepest step stays above your limit across the worst adverse run seen.", "Code Review, Backtest Analyzer"],
    nosl: ["Code Review: no stop loss", "Add a hard stop (or a tested equivalent) and re-run every stage from the baseline.", "Every order carries a stop; worst trade within 5× the average loss.", "Code Review, Backtest Analyzer"]
  };
  QF.concerns = CONCERNS;
  QF.buildTestPlan = function (c) {
    const d0 = Date.parse(c.start + "T00:00:00Z"), d1 = Date.parse(c.end + "T00:00:00Z");
    if (!Number.isFinite(d0) || !Number.isFinite(d1) || d1 <= d0) throw new Error("Enter a valid start date that is before the end date.");
    const total = Math.round((d1 - d0) / DAY); if (total < 180) throw new Error("The test period must cover at least 180 days.");
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const hold = clamp(+c.holdoutPct || 20, 10, 40) / 100, k = clamp(Math.round(+c.windows || 5), 2, 12), ratio = clamp(+c.ratio || 3, 1, 8);
    const P = Math.max(0, Math.round(+c.params || 0)), steps = Math.max(2, Math.round(+c.steps || 10)), tpy = Math.max(1, +c.tradesPerYear || 100);
    const maxDD = +c.maxDD || 25, minTrades = +c.minTrades || 200, minPF = +c.minPF || 1.2;
    const symbols = (c.symbols || []).filter(Boolean), tfs = (c.tfs || []).filter(Boolean), S = Math.max(1, symbols.length), T = Math.max(1, tfs.length);
    const devDays = Math.round(total * (1 - hold)), devEnd = d0 + devDays * DAY, oos = devDays / (ratio + k), isl = ratio * oos;
    const years = total / 365.25, isYears = isl / 365.25, oosYears = oos / 365.25;
    const isTrades = tpy * isYears, oosTrades = tpy * oosYears, perParam = P ? isTrades / P : Infinity;
    const passes = P ? Math.pow(steps, P) : 1;
    const at = x => d0 + Math.round(x) * DAY, wf = [];
    for (let i = 0; i < k; i++) wf.push([i + 1, iso(at(i * oos)) + " → " + iso(at(i * oos + isl)), iso(at(i * oos + isl)) + " → " + iso(at((i + 1) * oos + isl))]);

    const flags = [], add = (l, t, x) => flags.push({ level: l, title: t, text: x });
    if (years < 3) add("risk", "Short history", `${years.toFixed(1)} years of data. Aim for 5+ years that include trending, ranging and high-volatility phases.`);
    else if (years < 5) add("warn", "Moderate history", `${years.toFixed(1)} years of data; add more history if your data source allows.`);
    if (oosTrades < 30) add("risk", "Out-of-sample windows are too thin", `About ${oosTrades.toFixed(0)} expected trades per OOS window. Use fewer windows, a lower IS:OOS ratio, or more symbols.`);
    else if (oosTrades < 60) add("warn", "Thin out-of-sample windows", `About ${oosTrades.toFixed(0)} expected trades per OOS window; statistics will be noisy.`);
    if (P && perParam < 10) add("risk", "Too few trades per free parameter", `About ${perParam.toFixed(0)} in-sample trades per optimized parameter. With so little data per parameter, optimization will mostly fit noise.`);
    else if (P && perParam < 30) add("warn", "Few trades per free parameter", `About ${perParam.toFixed(0)} in-sample trades per optimized parameter; 30+ is a common starting point.`);
    if (passes > 1e5) add("warn", "Very large search space", `${passes.toExponential(1)} grid combinations. Use genetic optimization, optimize fewer parameters, or widen the steps. The more variants you test, the more inflated the best result.`);
    else if (passes > 1000) add("info", "Many optimization passes", `About ${passes.toLocaleString("en-US")} passes: the best result will look better than a typical one even without an edge. Rely on out-of-sample data.`);
    if (S < 3) add("warn", "Few validation symbols", "Plan at least two symbols that were not used for optimization, ideally one correlated and one uncorrelated with the primary.");
    if (c.type === "grid" || (c.concerns || []).includes("martingale")) add("warn", "Open-ended risk profile", "Grid/martingale systems need worst-case tests (see the strategy-specific table); a smooth backtest curve says little about tail risk.");
    add("info", "Pre-commit the criteria", "Write the acceptance criteria before running anything. Changing them after seeing results is a form of overfitting.");

    const metrics = [
      { label: "Period", value: `${iso(d0)} → ${iso(d1)} (${years.toFixed(1)} y)` }, { label: "Development / final holdout", value: `${iso(d0)} → ${iso(devEnd)} / ${iso(devEnd)} → ${iso(d1)}` },
      { label: "Walk-forward windows", value: `${k} × (IS ${mon(isl)} mo, OOS ${mon(oos)} mo)` }, { label: "Expected trades per IS / OOS window", value: `${isTrades.toFixed(0)} / ${oosTrades.toFixed(0)}` },
      { label: "In-sample trades per free parameter", value: P ? perParam.toFixed(0) : "no optimized parameters" }, { label: "Optimization grid size", value: passes > 1e9 ? passes.toExponential(1) : passes.toLocaleString("en-US") }
    ];
    const dataTbl = { title: "1. Data and split", head: ["Item", "Plan"], rows: [
      ["Symbols", symbols.length ? symbols.join(", ") + (S > 1 ? " (first = primary, optimize on it only)" : "") : "not specified"],
      ["Timeframes", tfs.length ? tfs.join(", ") : "not specified"],
      ["Modelling", "Every tick based on real ticks if the broker offers them; otherwise note the lower quality. Record history quality % for each run."],
      ["Development period", `${iso(d0)} → ${iso(devEnd)} (${mon(devDays)} months): optimization and walk-forward`],
      ["Final holdout", `${iso(devEnd)} → ${iso(d1)} (${mon(total - devDays)} months): run exactly once, after everything is frozen`],
      ["Deposit / currency", c.deposit ? String(c.deposit) : "not specified; keep identical for all runs"]
    ] };
    const wfTbl = { title: "2. Walk-forward windows (rolling)", head: ["Window", "In-sample (optimize)", "Out-of-sample (test only)"], rows: wf };
    const optTbl = { title: "3. Optimization protocol", head: ["Item", "Plan"], rows: [
      ["Free parameters", P ? `${P} parameters, about ${steps} steps each` : "none; run a baseline only"],
      ["Search method", passes > 1e5 ? "Genetic; grid is too large" : "Complete grid (enables the neighbour check)"],
      ["Ranking criterion", "A balanced criterion (e.g. custom score combining profit, drawdown and trade count), not raw profit. Filter out passes under " + Math.max(30, Math.round(isTrades * 0.4)) + " trades."],
      ["Selection rule", "Pick the centre of a stable region, not the top pass. Record why."],
      ["Forward data", "Use MT5 forward optimization on the IS windows if available; otherwise test the shortlist on the OOS window."],
      ["Frozen after selection", "Parameters, symbol, timeframe and risk settings. No changes after seeing OOS or holdout."]
    ] };
    const pp = P ? [["Parameter perturbation", `Each of the ${P} parameters ±10% and ±20% around the chosen value, one at a time (${P * 4} runs)`, "Result stays above the stressed profit-factor threshold in at least 75% of runs"]] : [];
    const robTbl = { title: "4. Robustness matrix (run on the frozen setting)", head: ["Test", "Variation", "Expectation"], rows: [
      ...pp,
      ["Spread stress", "Normal, ×1.5, ×2 (widen spread on a copy of the symbol or add a cost in test mode)", `Profit factor stays above ${minPF}`],
      ["Execution delay", "No delay, 100 ms, 500 ms / random delay in the tester settings", "Result degrades gradually, not abruptly"],
      ["Commission and swap", "Broker actual, +20%", "Still profitable"],
      ["Start-date shift", "Start 1, 2 and 3 months later", "No single start date makes or breaks the result"],
      ["Validation symbols", S > 1 ? "Run on: " + symbols.slice(1).join(", ") + " with the same parameters" : "Add at least two other symbols", "Not necessarily profitable everywhere, but no catastrophic loss"],
      ["Timeframe neighbours", T > 1 ? "Run on: " + tfs.slice(1).join(", ") : "Optional: adjacent timeframe", "Same sign of result"],
      ["Trade sampling", "Randomly skip 10% of trades (Monte Carlo) and reshuffle order, in the Analyzer or a script", "Drawdown distribution stays inside your limit"]
    ] };
    const typeRows = (TYPE_CHECKS[c.type] || []).map(r => [r[0], r[1]]);
    const crit = { title: "6. Acceptance criteria (starting points: edit to your risk limits)", head: ["Criterion", "Threshold", "Measured with"], rows: [
      ["Total trades (OOS combined)", `≥ ${minTrades}`, "Backtest Analyzer"], ["Profit factor after stress costs", `≥ ${minPF}`, "Backtest Analyzer"],
      ["OOS result vs IS result", "OOS profit factor at least 50% of IS (as a ratio of edge, PF−1)", "Backtest Analyzer"],
      ["Maximum equity drawdown", `≤ ${maxDD}% of balance`, "Backtest Analyzer (graph export)"], ["Recovery factor", "≥ 2", "Backtest Analyzer"],
      ["Net result without best 5% of trades", "> 0", "Backtest Analyzer"], ["Chosen pass: neighbour score", "≥ 80% of its score", "Optimization Check"],
      ["Back→forward rank correlation", "≥ 0.3", "Optimization Check"], ["Log hygiene", "No critical runtime errors, no retry storm, order failure rate < 5%", "Log Reader"],
      ["Code review", "No Risk items open", "Code Review"], ["Final holdout", "Meets the same thresholds on the first and only run", "Backtest Analyzer"]
    ] };
    const cs = (c.concerns || []).filter(x => CONCERNS[x]);
    const conTbl = cs.length ? { title: "7. Actions for known concerns", head: ["Concern", "Action", "Pass criterion", "Tool"], rows: cs.map(x => CONCERNS[x]) } : null;
    const runs = 1 + k * 2 + (P * 4) + 6 + 3 + (S - 1) + (T - 1) + 1;
    const sheet = { title: (conTbl ? "8" : "7") + ". Run sheet (do in this order)", head: ["", "Stage", "Action", "Gate to continue"], rows: [
      ["☐", "0 Pre-flight", "Run Code Review on the EA; fix every Risk item. Run a short test and read the log in Log Reader.", "No Risk items; no critical runtime errors, retry storms or high failure rate"],
      ["☐", "1 Baseline", "One run with default settings over the development period; export trades and graph into the Backtest Analyzer.", "Record the metrics. Nothing else is decided here."],
      ["☐", "2 Optimize in-sample", `For each of the ${k} windows, optimize on the in-sample part only. Check each result in Optimization Check.`, "No isolated-peak finding on the chosen setting"],
      ["☐", "3 Out-of-sample", "Run each chosen setting on its own OOS window; join the OOS results.", "OOS meets the criteria; OOS/IS ratio acceptable"],
      ["☐", "4 Freeze", "Pick the final parameters and write them down (parameters, symbol, timeframe, risk).", "Nothing changes after this point"],
      ["☐", "5 Stress and validation", "Run the robustness matrix" + (typeRows.length ? " and the strategy-specific checks" : "") + ".", "No single test breaks the criteria"],
      ["☐", "6 Final holdout", `Run once on ${iso(devEnd)} → ${iso(d1)}.`, "Meets the criteria. If it fails, return to design; do not re-tune on the holdout."],
      ["☐", "7 Forward on demo / minimum size", "Run at least 1–3 months on a demo or minimum lot size, then read the live log in Log Reader and compare spread, slippage and fill rate with the test assumptions.", "Live behaviour is within tolerance of the OOS results"]
    ] };
    const tables = [dataTbl, wfTbl, optTbl, robTbl];
    if (typeRows.length) tables.push({ title: "5. Strategy-specific checks (" + c.type + ")", head: ["Check", "How"], rows: typeRows });
    tables.push(crit); if (conTbl) tables.push(conTbl); tables.push(sheet);
    metrics.push({ label: "Estimated tester runs (excl. optimization passes)", value: String(runs) });
    return { label: "Test plan", metrics, flags, tables, name: c.ea || "EA" };
  };


  /* ---------- Multi-run comparison ---------- */
  const PALETTE = ["#70aaff", "#65ddb0", "#ffd37a", "#ff9292"];
  const resample = (v, m) => { const out = []; for (let i = 0; i < m; i++) { const x = i * (v.length - 1) / (m - 1), a = Math.floor(x), b = Math.min(v.length - 1, a + 1); out.push(v[a] + (v[b] - v[a]) * (x - a)); } return out; };
  const TRADE_DEFS = [["n", "Trades", 0, 0], ["net", "Net profit", 2, 1], ["pf", "Profit factor", 2, 1], ["expectancy", "Expectancy per trade", 2, 1], ["winRate", "Win rate (%)", 1, 0], ["payoff", "Payoff ratio", 2, 0], ["dd", "Max drawdown (trade sequence)", 2, -1], ["rf", "Recovery factor", 2, 1], ["maxLossStreak", "Longest losing streak", 0, -1], ["worst", "Worst trade", 2, 1], ["netExTop", "Net without best 5% of trades", 2, 1], ["topShare", "Best trade, % of gross profit", 1, -1], ["costShare", "Costs, % of gross profit", 1, -1], ["tstat", "t-statistic of mean trade", 2, 1]];
  const GRAPH_DEFS = [["change", "Balance change", 2, 1], ["ddEp", "Max equity drawdown (%)", 2, -1], ["ddBp", "Max balance drawdown (%)", 2, -1], ["rf", "Recovery factor", 2, 1], ["floatMaxP", "Max floating loss (% of balance)", 2, -1], ["belowPct", "Equity below balance (% of points)", 1, -1], ["maxLoad", "Max deposit load (%)", 2, -1]];
  QF.compareRuns = function (runs) {
    if (!runs || runs.length < 2) throw new Error("Add at least two runs to compare.");
    const mode = runs[0].mode;
    if (runs.some(r => r.mode !== mode)) throw new Error("All runs must be the same kind of file: either all closed-trade lists or all graph exports.");
    const A = runs.map(r => mode === "trades" ? QF.analyzeTrades(r.data, r.meta) : QF.analyzeGraph(r.data)), S = A.map(a => a.stats), defs = mode === "trades" ? TRADE_DEFS : GRAPH_DEFS;
    const labels = runs.map(r => r.label), base = S[0];
    const cell = (v, b, dec, dir, isBase) => {
      const txt = QF.fmt(v, dec); if (isBase || !Number.isFinite(v) || !Number.isFinite(b)) return txt;
      const d = v - b, rel = b !== 0 ? d / Math.abs(b) : NaN;
      if (Math.abs(Number.isFinite(rel) ? rel : d) < 0.05) return txt + " (≈ same)";
      const arrow = d > 0 ? "▲" : "▼", pct = Number.isFinite(rel) ? (rel > 0 ? "+" : "") + (rel * 100).toFixed(0) + "%" : (d > 0 ? "+" : "") + QF.fmt(d, dec);
      const verdict = dir === 0 ? "" : ((d > 0) === (dir > 0) ? ", better" : ", worse");
      return `${txt} (${arrow} ${pct}${verdict})`;
    };
    const cmpTbl = { title: "Metric comparison (changes are relative to " + labels[0] + ")", head: ["Metric", ...labels], rows: defs.map(([k, name, dec, dir]) => [name, ...S.map((st, i) => cell(st[k], base[k], dec, dir, i === 0))]) };
    const flags = [], add = (l, t, x) => flags.push({ level: l, title: t, text: x }), tables = [cmpTbl];

    // context + noise test
    const span = r => { const ts = (r.data || []).map(t => t.time && t.time.ts).filter(Number.isFinite); return ts.length ? [Math.min(...ts), Math.max(...ts)] : null; };
    if (mode === "trades") {
      const spans = runs.map(span), syms = runs.map(r => [...new Set(r.data.map(t => t.symbol).filter(Boolean))].sort());
      tables.push({ title: "Context", head: ["Run", "Trades", "First → last open time", "Symbols"], rows: runs.map((r, i) => [labels[i], r.data.length, spans[i] ? iso(spans[i][0]) + " → " + iso(spans[i][1]) : "no timestamps", syms[i].length ? syms[i].join(", ") : "not in file"]) });
      const nets = runs.map(r => r.data.map(t => t.net)), noise = [];
      for (let i = 1; i < runs.length; i++) {
        const m1 = QF.mean(nets[0]), m2 = QF.mean(nets[i]), s1 = QF.std(nets[0]), s2 = QF.std(nets[i]), se = Math.sqrt(s1 * s1 / nets[0].length + s2 * s2 / nets[i].length), t = se > 0 ? (m2 - m1) / se : NaN;
        noise.push({ i, t, d: m2 - m1 });
        const sp0 = spans[0], spi = spans[i];
        if (sp0 && spi) { const l0 = sp0[1] - sp0[0], li = spi[1] - spi[0]; if (l0 > 0 && Math.abs(li - l0) / l0 > 0.2) add("warn", `${labels[i]}: different test period`, `Covers ${(li / 864e5).toFixed(0)} days vs ${(l0 / 864e5).toFixed(0)} days for ${labels[0]}. Totals are not comparable; look at per-trade metrics.`); }
        if (syms[0].join() !== syms[i].join() && syms[0].length && syms[i].length) add("warn", `${labels[i]}: different symbols`, `${syms[i].join(", ")} vs ${syms[0].join(", ")}. Differences may come from the market, not the change you made.`);
      }
      tables.push({ title: "Is the per-trade difference more than noise? (Welch t-test, rough)", head: ["Run", "Δ expectancy per trade vs " + labels[0], "t", "Reading"], rows: noise.map(n => [labels[n.i], (n.d > 0 ? "+" : "") + QF.money(n.d), QF.fmt(n.t), !Number.isFinite(n.t) ? "N/A" : Math.abs(n.t) >= 2 ? "Distinguishable from noise (|t| ≥ 2)" : "Within noise (|t| < 2)"]) });
      noise.forEach(({ i, t }) => {
        const st = S[i], tag = labels[i];
        if (st.net > base.net + 0.05 * Math.abs(base.net) && Number.isFinite(t) && Math.abs(t) < 2) add("warn", `${tag}: improvement is within noise`, `Net profit is higher, but the per-trade difference has t = ${t.toFixed(2)}. With this many trades, a gap this size can appear by chance. Re-test on data not used for tuning before keeping the change.`);
        if (st.net > base.net && st.dd > base.dd * 1.2) add("warn", `${tag}: more profit, deeper drawdown`, `Net profit rose, but max drawdown grew from ${QF.money(base.dd)} to ${QF.money(st.dd)}. Compare recovery factor (${QF.fmt(base.rf)} → ${QF.fmt(st.rf)}) before calling it better.`);
        if (st.n < base.n * 0.7) add("warn", `${tag}: far fewer trades`, `${st.n} vs ${base.n} trades. A filter that removes trades also thins the sample; check that the removed trades were not the winners in unusual conditions.`);
        if (st.net > 0 && st.netExTop <= 0) add("risk", `${tag}: result depends on a few trades`, `Without its best 5% of trades the net result is ${QF.money(st.netExTop)}.`);
        if (st.winRate - base.winRate > 8 && Number.isFinite(st.payoff) && Number.isFinite(base.payoff) && st.payoff < base.payoff * 0.7) add("warn", `${tag}: higher win rate, smaller payoff`, `Win rate rose ${(st.winRate - base.winRate).toFixed(1)} points while payoff fell from ${QF.fmt(base.payoff)} to ${QF.fmt(st.payoff)}. This often means losses are being allowed to run; inspect the worst trades.`);
        if (Number.isFinite(st.worst) && base.worst < 0 && st.worst < base.worst * 1.5) add("warn", `${tag}: worst trade is much larger`, `${QF.money(st.worst)} vs ${QF.money(base.worst)}. A grown tail loss is easy to miss in averages.`);
        const better = TRADE_DEFS.filter(d => d[3] !== 0 && Number.isFinite(st[d[0]]) && Number.isFinite(base[d[0]])).every(d => d[3] > 0 ? st[d[0]] >= base[d[0]] * 0.95 : st[d[0]] <= base[d[0]] * 1.05);
        if (better && Number.isFinite(t) && Math.abs(t) >= 2 && st.net > base.net) add("ok", `${tag}: better on every directional metric`, "The difference is also outside the noise band. Still confirm on out-of-sample data before trusting it.");
      });
      const all = [...new Set(runs.flatMap(r => r.data.map(t => t.symbol).filter(Boolean)))].sort();
      if (all.length > 1) tables.push({ title: "Net profit by symbol", head: ["Symbol", ...labels], rows: all.map(sy => [sy, ...runs.map(r => { const g = r.data.filter(t => t.symbol === sy); return g.length ? QF.money(QF.sum(g.map(t => t.net))) + " (" + g.length + ")" : "—"; })]) });
    } else {
      for (let i = 1; i < runs.length; i++) {
        const st = S[i], tag = labels[i];
        if (st.change > base.change && st.ddEp > base.ddEp * 1.2) add("warn", `${tag}: more gain, deeper equity drawdown`, `Max equity drawdown ${base.ddEp.toFixed(1)}% → ${st.ddEp.toFixed(1)}%.`);
        if (Number.isFinite(st.rf) && Number.isFinite(base.rf) && st.rf < base.rf * 0.8) add("warn", `${tag}: lower recovery factor`, `${QF.fmt(base.rf)} → ${QF.fmt(st.rf)}.`);
        if (st.floatMaxP > base.floatMaxP * 1.3 && st.floatMaxP > 5) add("warn", `${tag}: larger floating losses`, `Max floating loss ${base.floatMaxP.toFixed(1)}% → ${st.floatMaxP.toFixed(1)}% of balance.`);
        if (Number.isFinite(st.maxLoad) && Number.isFinite(base.maxLoad) && st.maxLoad > base.maxLoad * 1.3) add("warn", `${tag}: higher margin usage`, `Max deposit load ${base.maxLoad.toFixed(1)}% → ${st.maxLoad.toFixed(1)}%.`);
      }
      add("info", "Graph files have no per-trade data", "A noise test needs individual trades. Export the trade history for each run to test whether differences are meaningful.");
    }
    add("info", "What a comparison can and cannot say", "It shows how the files differ. It cannot say which setup will do better live, and a single before/after pair is a sample of one. Confirm changes on data the tuning never saw.");
    if (!flags.some(f => f.level === "risk" || f.level === "warn" || f.level === "ok")) add("ok", "No structural flags raised", "No adverse trade-offs were detected between the runs. Not proof that any run is robust.");
    const series = runs.map((r, i) => ({ name: labels[i], color: PALETTE[i % 4], values: resample(mode === "trades" ? A[i].series[0].values : A[i].series[1].values.map(v => v - r.data[0].balance), 200) }));
    return { label: "Backtest comparison", mode, metrics: [{ label: "Runs compared", value: String(runs.length) }, { label: "Baseline", value: labels[0] }, { label: "File kind", value: mode === "trades" ? "closed trades" : "balance/equity graph" }], flags, tables, series };
  };


  /* ---------- Research report: evidence store + deterministic narrative ---------- */
  const STORE_KEY = "qf.report.items.v1";
  QF.store = {
    slim(kind, label, res, source) {
      return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), kind, label, source: source || "", mode: res.mode || null, savedAt: new Date().toISOString(), metrics: res.metrics || [], flags: res.flags || [],
        tables: (res.tables || res.breakdowns || []).slice(0, 12).map(t => ({ title: t.title, head: t.head, rows: t.rows.slice(0, 25) })) };
    },
    list() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); } catch (e) { return []; } },
    add(kind, label, res, source) {
      try { const items = QF.store.list(); items.push(QF.store.slim(kind, label, res, source)); const keep = items.slice(-12); localStorage.setItem(STORE_KEY, JSON.stringify(keep)); return { ok: true, count: keep.length }; }
      catch (e) { return { ok: false, error: "Browser storage is unavailable or full, so the result could not be saved." }; }
    },
    remove(id) { try { localStorage.setItem(STORE_KEY, JSON.stringify(QF.store.list().filter(i => i.id !== id))); } catch (e) { } },
    clear() { try { localStorage.removeItem(STORE_KEY); } catch (e) { } }
  };
  QF.demoItems = function () {
    const sl = QF.store.slim, o = [];
    const p = QF.parseAnalyzerInput(QF.demo.trades()); o.push(sl("backtest", "Demo trade history (synthetic)", QF.analyzeTrades(p.data, p.meta), "demo"));
    o.push(sl("optimization", "Demo optimization (synthetic)", QF.analyzeOptimization(QF.toOptimization(QF.parseCSV(QF.demo.optimization())), {}), "demo"));
    o.push(sl("log", "Demo EA log (synthetic)", QF.analyzeLog(QF.parseLog(QF.demo.log())), "demo"));
    o.push(sl("code", "Demo EA source (synthetic)", QF.reviewMQL(QF.demo.mql()), "demo"));
    o.push(sl("plan", "Test plan: DemoEA", QF.buildTestPlan({ ea: "DemoEA", type: "grid", symbols: ["EURUSD", "GBPUSD"], tfs: ["M15"], start: "2021-01-01", end: "2026-09-30", params: 3, steps: 10, tradesPerYear: 120, concerns: ["retry", "martingale"] }), "demo"));
    const mk = (l, x) => { const q = QF.parseAnalyzerInput(QF.demo.trades(x)); return { label: l, mode: q.mode, data: q.data, meta: q.meta }; };
    o.push(sl("comparison", "Demo comparison (synthetic)", QF.compareRuns([mk("A baseline"), mk("B v2 filter", { seed: 8, winP: 0.70 })]), "demo"));
    return o;
  };
  const AREA = { backtest: "Backtest results", optimization: "Optimization", log: "Execution log", code: "Source code", plan: "Test plan", comparison: "Run comparison" };
  const AREA_ORDER = ["code", "log", "backtest", "optimization", "comparison", "plan"];
  QF.areaNames = AREA;
  QF.buildNarrative = function (items, o) {
    o = o || {}; if (!items || !items.length) throw new Error("No evidence yet. Add results from the other tools first, or load the demo.");
    const sorted = [...items].sort((a, b) => AREA_ORDER.indexOf(a.kind) - AREA_ORDER.indexOf(b.kind));
    const lvl = (it, l) => it.flags.filter(f => f.level === l);
    const val = (it, ...labels) => { for (const l of labels) { const m = it.metrics.find(x => x.label === l || x.label.startsWith(l)); if (m) return m.value; } return "N/A"; };
    const risk = sorted.flatMap(it => lvl(it, "risk").map(f => ({ f, it }))), warn = sorted.flatMap(it => lvl(it, "warn").map(f => ({ f, it })));
    const F = (kind, re) => items.some(i => i.kind === kind && i.flags.some(f => (f.level === "risk" || f.level === "warn") && re.test(f.title)));
    const kinds = [...new Set(sorted.map(i => i.kind))], date = new Date().toISOString().slice(0, 10), ea = o.ea || "the EA", demo = items.some(i => /demo|synthetic/i.test(i.label + " " + i.source));
    const S = [];

    // executive summary
    const sum = [`This report summarises ${items.length} analysis result${items.length > 1 ? "s" : ""} for ${ea}, produced with QuantForge AI. Areas covered: ${kinds.map(k => AREA[k].toLowerCase()).join(", ")}.`];
    if (risk.length) sum.push(`Status: not ready. ${risk.length} Risk finding${risk.length > 1 ? "s are" : " is"} unresolved${warn.length ? `, plus ${warn.length} item${warn.length > 1 ? "s" : ""} to review` : ""}. Most serious: ${risk.slice(0, 3).map(x => `${x.f.title} (${AREA[x.it.kind].toLowerCase()})`).join("; ")}.`);
    else if (warn.length) sum.push(`Status: needs work. No Risk findings, but ${warn.length} item${warn.length > 1 ? "s need" : " needs"} review. Main ones: ${warn.slice(0, 3).map(x => `${x.f.title} (${AREA[x.it.kind].toLowerCase()})`).join("; ")}.`);
    else sum.push("Status: no structural flags were raised by the checks that were run. That is not evidence that the strategy is robust or profitable; it means these particular checks did not trip.");
    if (demo) sum.push("Note: this report includes synthetic demo data. Its findings illustrate the tools and say nothing about a real strategy.");
    S.push({ h: "Summary", p: sum });

    // coverage
    const missing = Object.keys(AREA).filter(k => !kinds.includes(k));
    S.push({ h: "Evidence coverage", p: [missing.length ? `Not included: ${missing.map(k => AREA[k].toLowerCase()).join(", ")}. Conclusions are limited to the evidence listed here.` : "All six evidence areas are included."],
      tables: [{ title: "Coverage", head: ["Area", "Analyses", "Risk", "Review"], rows: Object.keys(AREA).map(k => { const g = items.filter(i => i.kind === k); return [AREA[k], g.length, g.reduce((n, i) => n + lvl(i, "risk").length, 0), g.reduce((n, i) => n + lvl(i, "warn").length, 0)]; }) }] });

    // cross-cutting
    const x = [];
    if (F("log", /retry storm|order failure/i) && F("code", /retries|result handling/i)) x.push("The log shows failing or repeated order requests, and the code review found missing retry limits or result handling. These are probably the same problem: fix the code, then re-check the log.");
    if (F("log", /invalid stops|invalid price/i) && F("code", /Stops \/ freeze|normalisation/i)) x.push("Order rejections for invalid stops or prices in the log match the missing stops-level and normalisation handling in the code.");
    if (F("log", /no money|failed order/i) && F("code", /margin|escalation/i)) x.push("Margin-related order failures in the log match the missing free-margin check or lot escalation in the code.");
    if (F("code", /Stop loss on orders|escalation/i) && F("backtest", /Many small wins|Tail loss|mostly floating|Large floating|drawdown/i)) x.push("The code has open-ended risk features (no stop loss and/or escalating lots) and the backtest shows the matching signature (small wins with large losses, tail loss or floating drawdown). The backtest probably understates the real risk.");
    if (F("optimization", /isolated peak|sensitive/i) && F("backtest", /depends on a few|dominates|noise/i)) x.push("Both the optimization and the backtest suggest the result rests on a narrow set of settings or trades.");
    if (F("comparison", /within noise/i)) x.push("At least one apparent improvement in the run comparison is within noise. Do not keep that change on the strength of the headline numbers alone.");
    if (kinds.includes("plan") && !kinds.includes("optimization") && !kinds.includes("comparison")) x.push("A test plan exists, but this report contains no optimization or out-of-sample evidence yet. The plan has not been executed.");
    if (kinds.includes("backtest") && !kinds.includes("log")) x.push("Backtest results are included without an execution log. Failed orders or runtime errors would not be visible here.");
    S.push({ h: "Cross-cutting observations", p: x.length ? [] : ["No links between areas were detected by the rules used here. That does not mean none exist."], ul: x });

    // per area
    sorted.forEach(it => {
      let t;
      if (it.kind === "backtest" && it.mode === "graph") t = `The balance/equity graph covers ${val(it, "Graph data points")} points. Balance changed by ${val(it, "Balance change")}; maximum equity drawdown was ${val(it, "Max equity drawdown")} and maximum floating loss ${val(it, "Max floating loss")}.`;
      else if (it.kind === "backtest") t = `The trade history contains ${val(it, "Closed trades")} closed trades. Net result is ${val(it, "Net profit")}, profit factor ${val(it, "Profit factor")}, expectancy ${val(it, "Expectancy per trade")} per trade, win rate ${val(it, "Win rate")} and maximum drawdown ${val(it, "Max drawdown")}.`;
      else if (it.kind === "optimization") t = `${val(it, "Passes analysed")} optimization passes were analysed. The best score is ${val(it, "Best score")} against a median of ${val(it, "Median score")}; ${val(it, "Profitable passes")} of passes were profitable. Neighbour score (mean / worst): ${val(it, "Neighbour score")}. Back→forward rank correlation: ${val(it, "Back→forward")}.`;
      else if (it.kind === "log") t = `The log contains ${val(it, "Log lines")} lines (time span ${val(it, "Time span")}). Critical runtime errors: ${val(it, "Critical runtime errors")}; stop-out lines: ${val(it, "Stop-out")}; failed order requests: ${val(it, "Failed order requests")} out of ${val(it, "Order attempts")} attempts.`;
      else if (it.kind === "code") t = `The source scan covered ${val(it, "Code lines")} code lines and ${val(it, "Order-sending call sites")} order-sending call sites. Checks passed: ${val(it, "Checks passed")}. Open items (Risk / Review): ${val(it, "Risk / Review items")}.`;
      else if (it.kind === "plan") t = `The plan covers ${val(it, "Period")} with ${val(it, "Walk-forward windows")}. Development / final holdout: ${val(it, "Development")}. Expected trades per in-sample / out-of-sample window: ${val(it, "Expected trades")}. Estimated tester runs: ${val(it, "Estimated tester runs")}. The plan is a design document and contains no results.`;
      else t = `${val(it, "Runs compared")} runs were compared against the baseline "${val(it, "Baseline")}".`;
      const ul = [...lvl(it, "risk").map(f => `[Risk] ${f.title}: ${f.text}`), ...lvl(it, "warn").map(f => `[Review] ${f.title}: ${f.text}`), ...lvl(it, "ok").map(f => `[OK] ${f.title}`)];
      S.push({ h: `${AREA[it.kind]}: ${it.label}`, p: [t, ul.length ? "Findings:" : "No Risk or Review findings were raised."], ul });
    });

    // next steps
    const steps = [], seen = new Set();
    [...risk, ...warn].forEach(({ f, it }) => { if (steps.length < 12 && !seen.has(f.title)) { seen.add(f.title); steps.push(`${f.level === "risk" ? "Resolve" : "Review"}: ${f.title} (${AREA[it.kind].toLowerCase()}).`); } });
    steps.push("Re-run the affected analyses after each fix and add the new results to this report.");
    if (kinds.includes("plan")) steps.push("Execute the test-plan stages in order. The final holdout is run once, after parameters are frozen.");
    steps.push("Treat out-of-sample, holdout and a demo or minimum-size forward test as the deciding evidence, not any single backtest.");
    S.push({ h: "Recommended next steps", p: [], ul: steps });

    S.push({ h: "Limits of this report", p: ["The report is generated from rule-based checks on the files supplied. It is descriptive: it does not predict future results, and the thresholds are heuristic starting points. Pattern checks on logs and code can miss or misread things. It is not financial advice."] });
    S.push({ h: "Appendix: metrics", p: [], tables: sorted.map(it => ({ title: `${AREA[it.kind]}: ${it.label}`, head: ["Metric", "Value"], rows: it.metrics.map(m => [m.label, m.value]) })) });
    return { title: `Research report: ${ea}`, meta: [`Generated ${date}`, o.author ? "Prepared by " + o.author : null, o.purpose ? "Purpose: " + o.purpose : null].filter(Boolean), sections: S };
  };
  QF.narrativeToMarkdown = d => {
    const L = ["# " + d.title, "", d.meta.join(" · "), ""];
    d.sections.forEach(s => {
      L.push("## " + s.h, ""); (s.p || []).forEach(p => L.push(p, "")); if (s.ul && s.ul.length) { s.ul.forEach(u => L.push("- " + u)); L.push(""); }
      (s.tables || []).forEach(t => { L.push("**" + t.title + "**", "", "| " + t.head.join(" | ") + " |", "|" + t.head.map(() => "---").join("|") + "|"); t.rows.forEach(r => L.push("| " + r.join(" | ") + " |")); L.push(""); });
    });
    return L.join("\n");
  };
  QF.narrativeToHTML = d => `<h1>${QF.esc(d.title)}</h1><p class="muted">${d.meta.map(QF.esc).join(" · ")}</p>` + d.sections.map(s => `<h2>${QF.esc(s.h)}</h2>` + (s.p || []).map(p => `<p>${QF.esc(p)}</p>`).join("") + (s.ul && s.ul.length ? `<ul>${s.ul.map(u => `<li>${QF.esc(u)}</li>`).join("")}</ul>` : "") + (s.tables || []).map(QF.ui.tableHTML).join("")).join("");


  /* ---------- Monte Carlo resampling (trade level) ---------- */
  const pctile = (sorted, p) => { const x = (sorted.length - 1) * p, a = Math.floor(x), b = Math.min(sorted.length - 1, a + 1); return sorted[a] + (sorted[b] - sorted[a]) * (x - a); };
  QF.monteCarlo = function (nets, o) {
    o = o || {}; const n = nets.length; if (n < 20) throw new Error("Monte Carlo needs at least 20 trades.");
    const runs = Math.max(200, Math.min(+o.runs || 5000, Math.floor(4e6 / n))), seed = +o.seed || 12345, r = rng(seed), limit = +o.limit > 0 ? +o.limit : null;
    const maxDD = a => { let e = 0, p = 0, d = 0; for (let i = 0; i < a.length; i++) { e += a[i]; if (e > p) p = e; if (p - e > d) d = p - e; } return d; };
    const obsDD = maxDD(nets), obsNet = sum(nets), arr = nets.slice();
    const ddS = new Float64Array(runs), netB = new Float64Array(runs), pfB = new Float64Array(runs), ddB = new Float64Array(runs), netK = new Float64Array(runs), ddK = new Float64Array(runs);
    for (let k = 0; k < runs; k++) {
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)), t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
      ddS[k] = maxDD(arr);
      let gw = 0, gl = 0, e = 0, p = 0, d = 0, e2 = 0, p2 = 0, d2 = 0;
      for (let i = 0; i < n; i++) {
        const v = nets[Math.floor(r() * n)]; if (v > 0) gw += v; else if (v < 0) gl -= v; e += v; if (e > p) p = e; if (p - e > d) d = p - e;
        if (r() >= 0.1) { e2 += nets[i]; if (e2 > p2) p2 = e2; if (p2 - e2 > d2) d2 = p2 - e2; }
      }
      netB[k] = e; ddB[k] = d; pfB[k] = gl > 0 ? Math.min(999, gw / gl) : (gw > 0 ? 999 : 0); netK[k] = e2; ddK[k] = d2;
    }
    [ddS, netB, pfB, ddB, netK, ddK].forEach(a => a.sort());
    const share = (a, f) => { let c = 0; for (let i = 0; i < a.length; i++) if (f(a[i])) c++; return c / a.length * 100; };
    const R = {
      runs, seed, n, limit, obs: { net: obsNet, dd: obsDD },
      shuffle: { p50: pctile(ddS, .5), p95: pctile(ddS, .95), p99: pctile(ddS, .99), obsPct: share(ddS, v => v <= obsDD), breach: limit ? share(ddS, v => v > limit) : NaN },
      boot: { netP5: pctile(netB, .05), netP50: pctile(netB, .5), netP95: pctile(netB, .95), pLoss: share(netB, v => v <= 0), pfP5: pctile(pfB, .05), ddP50: pctile(ddB, .5), ddP95: pctile(ddB, .95), ddP99: pctile(ddB, .99), breach: limit ? share(ddB, v => v > limit) : NaN },
      skip: { netP5: pctile(netK, .05), netP50: pctile(netK, .5), pLoss: share(netK, v => v <= 0), ddP50: pctile(ddK, .5), ddP95: pctile(ddK, .95), ddP99: pctile(ddK, .99), breach: limit ? share(ddK, v => v > limit) : NaN }
    };
    const M = QF.money, pc = v => Number.isFinite(v) ? v.toFixed(1) + "%" : "—";
    const tables = [
      { title: "Monte Carlo: maximum drawdown (account currency)", head: ["Method", "Median", "95th percentile", "99th percentile", limit ? "Share of runs above " + M(limit) : "Share above limit"],
        rows: [["Observed sequence", M(obsDD), "—", "—", limit ? (obsDD > limit ? "above limit" : "within limit") : "no limit set"], ["Shuffled order (same trades)", M(R.shuffle.p50), M(R.shuffle.p95), M(R.shuffle.p99), pc(R.shuffle.breach)], ["Bootstrap (with replacement)", M(R.boot.ddP50), M(R.boot.ddP95), M(R.boot.ddP99), pc(R.boot.breach)], ["Random 10% of trades skipped", M(R.skip.ddP50), M(R.skip.ddP95), M(R.skip.ddP99), pc(R.skip.breach)]] },
      { title: "Monte Carlo: net result (account currency)", head: ["Method", "5th percentile", "Median", "95th percentile", "Share of runs with net ≤ 0"],
        rows: [["Observed", M(obsNet), "—", "—", obsNet <= 0 ? "yes" : "no"], ["Bootstrap (with replacement)", M(R.boot.netP5), M(R.boot.netP50), M(R.boot.netP95), pc(R.boot.pLoss)], ["Random 10% of trades skipped", M(R.skip.netP5), M(R.skip.netP50), "—", pc(R.skip.pLoss)]] }
    ];
    const flags = [], add = (l, t, x) => flags.push({ level: l, title: t, text: x });
    if (R.shuffle.obsPct < 25) add("warn", "Observed drawdown looks lucky in its ordering", `Only ${R.shuffle.obsPct.toFixed(0)}% of reorderings of the same trades produced a drawdown as small as the observed ${M(obsDD)}. A different ordering would typically be deeper (median ${M(R.shuffle.p50)}, 95th percentile ${M(R.shuffle.p95)}).`);
    if (obsDD > 0 && R.shuffle.p95 > 1.5 * obsDD) add("warn", "Drawdown can be much deeper than observed", `The 95th percentile drawdown across reorderings is ${(R.shuffle.p95 / obsDD).toFixed(2)}× the observed one. Size positions against ${M(R.shuffle.p95)} or more, not ${M(obsDD)}.`);
    if (R.boot.pLoss > 20) add("risk", "Sizeable chance the edge is not there", `${R.boot.pLoss.toFixed(1)}% of bootstrap resamples ended with net ≤ 0 (5th percentile ${M(R.boot.netP5)}).`);
    else if (R.boot.pLoss > 5) add("warn", "Non-trivial chance of a losing resample", `${R.boot.pLoss.toFixed(1)}% of bootstrap resamples ended with net ≤ 0.`);
    else add("ok", "Bootstrap results stay positive", `Only ${R.boot.pLoss.toFixed(1)}% of resamples ended with net ≤ 0.`);
    if (R.skip.pLoss > 20) add("warn", "Fragile to missing trades", `Skipping a random 10% of trades gives net ≤ 0 in ${R.skip.pLoss.toFixed(1)}% of runs. Missed fills or filters in live trading could erase the result.`);
    if (limit) { const w = Math.max(R.shuffle.breach, R.boot.breach); if (w > 20) add("risk", "Drawdown limit is likely to be breached", `The ${M(limit)} limit is exceeded in up to ${w.toFixed(1)}% of resampled runs.`); else if (w > 5) add("warn", "Drawdown limit breached in some runs", `The ${M(limit)} limit is exceeded in up to ${w.toFixed(1)}% of resampled runs.`); }
    add("info", "What resampling assumes", `${runs.toLocaleString("en-US")} runs per method (seed ${seed}, so the result repeats). Trades are treated as independent draws from one distribution. Real trades cluster in regimes and overlap, so true risk is usually higher than this shows.`);
    const metrics = [{ label: "Monte Carlo runs", value: runs.toLocaleString("en-US") + " (seed " + seed + ")" }, { label: "MC 95th percentile max drawdown (shuffled)", value: M(R.shuffle.p95) }, { label: "MC bootstrap runs with net ≤ 0", value: pc(R.boot.pLoss) }];
    return Object.assign(R, { tables, flags, metrics });
  };

  /* ---------- Optimization parameter heatmap ---------- */
  QF.heatmap = function (ctx, o) {
    const P = ctx.params; if (P.length < 2) return null;
    const xp = P[o.xi], yp = P[o.yi]; if (!xp || !yp || xp === yp) throw new Error("Choose two different parameters.");
    const tj = ctx.idx.trades, minT = o.minTrades || 0, cells = yp.values.map(() => xp.values.map(() => []));
    ctx.X.forEach(r => { const v = r[o.scoreJ]; if (!Number.isFinite(v) || (tj !== undefined && minT > 0 && r[tj] < minT)) return; cells[yp.values.indexOf(r[yp.j])][xp.values.indexOf(r[xp.j])].push(v); });
    const grid = cells.map(row => row.map(c => c.length ? (o.agg === "median" ? QF.median(c) : Math.max(...c)) : NaN)), flat = grid.flat().filter(Number.isFinite);
    if (!flat.length) throw new Error("No passes remain for the heatmap after filtering.");
    const best = Math.max(...flat); let bx = 0, by = 0; grid.forEach((row, yi) => row.forEach((v, xi) => { if (v === best) { bx = xi; by = yi; } }));
    const plateau = best > 0 ? flat.filter(v => v >= 0.8 * best).length / flat.length * 100 : NaN;
    return { xs: xp.values, ys: yp.values, xName: xp.name, yName: yp.name, grid, best, bx, by, plateau, filled: flat.length, total: xp.values.length * yp.values.length, agg: o.agg === "median" ? "median" : "best", others: P.length - 2 };
  };


  /* ---------- Time stability and market regimes ---------- */
  const tStats = g => { const nn = g.map(t => t.net), w = sum(nn.filter(x => x > 0)), l = Math.abs(sum(nn.filter(x => x < 0))); return { n: g.length, net: sum(nn), win: g.length ? nn.filter(x => x > 0).length / g.length * 100 : NaN, pf: l === 0 ? (w > 0 ? Infinity : NaN) : w / l }; };
  QF.periodStability = function (trades) {
    const timed = trades.filter(t => t.time && Number.isFinite(t.time.ts)); if (!timed.length || timed.length < 0.8 * trades.length) return null;
    const m = new Map(); timed.forEach(t => { const d = new Date(t.time.ts), k = d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0"); if (!m.has(k)) m.set(k, []); m.get(k).push(t); });
    const keys = [...m.keys()].sort(); if (keys.length < 3) return null;
    const rows = keys.map(k => ({ k, ...tStats(m.get(k)) })), total = sum(rows.map(r => r.net)), prof = rows.filter(r => r.net > 0).length;
    const worst = rows.reduce((a, b) => b.net < a.net ? b : a), best = rows.reduce((a, b) => b.net > a.net ? b : a);
    let run = 0, longest = 0; rows.forEach(r => { if (r.net < 0) { run++; longest = Math.max(longest, run); } else run = 0; });
    const bestShare = total > 0 ? best.net / total * 100 : NaN, M = QF.money;
    const flags = [], add = (l, t, x) => flags.push({ level: l, title: t, text: x });
    if (keys.length < 6) add("info", "Few months to judge", `Only ${keys.length} calendar months have trades; month-level stability cannot be judged reliably.`);
    else if (prof / keys.length < 0.6) add("warn", "Profit is not consistent across months", `Only ${prof} of ${keys.length} months (${(prof / keys.length * 100).toFixed(0)}%) were profitable.`);
    else add("ok", "Most months are profitable", `${prof} of ${keys.length} months were profitable.`);
    if (Number.isFinite(bestShare) && bestShare > 40 && keys.length >= 4) add("warn", "One month carries the result", `${best.k} contributed ${bestShare.toFixed(0)}% of the total net profit.`);
    if (longest >= 3) add("warn", "Extended losing stretch", `${longest} consecutive losing months (months without trades are not counted). Check whether you could have stayed with the system through that.`);
    if (total > 0 && worst.net < -0.5 * total) add("info", "A single month erased much of the profit", `${worst.k} lost ${M(-worst.net)}, ${(-worst.net / total * 100).toFixed(0)}% of the total net profit.`);
    const metrics = [{ label: "Months with trades", value: String(keys.length) }, { label: "Profitable months", value: `${prof} (${(prof / keys.length * 100).toFixed(0)}%)` }, { label: "Worst month", value: `${worst.k}: ${M(worst.net)}` }, { label: "Longest losing run (months)", value: String(longest) }];
    return { metrics, flags, tables: [{ title: "Net result by calendar month (open time)", head: ["Month", "Trades", "Net", "Win rate", "Profit factor"], rows: rows.map(r => [r.k, r.n, M(r.net), r.win.toFixed(1) + "%", r.pf === Infinity ? "∞" : QF.fmt(r.pf)]) }], chart: { labels: rows.map(r => r.k), values: rows.map(r => r.net) } };
  };


  /* shared: permutation test on the gap between best and worst group average, and group judgement */
  function permGap(lab, nets, K, seed) {
    const stat = L => { const sm = new Array(K).fill(0), ct = new Array(K).fill(0); for (let i = 0; i < L.length; i++) { sm[L[i]] += nets[i]; ct[L[i]]++; } const m = []; for (let k = 0; k < K; k++) if (ct[k] >= 20) m.push(sm[k] / ct[k]); return m.length >= 2 ? Math.max(...m) - Math.min(...m) : NaN; };
    const obs = stat(lab); if (!Number.isFinite(obs)) return NaN;
    const rr = rng(seed), L = lab.slice(), R = 2000; let ge = 0;
    for (let k = 0; k < R; k++) { for (let i = L.length - 1; i > 0; i--) { const j = Math.floor(rr() * (i + 1)), t = L[i]; L[i] = L[j]; L[j] = t; } if (stat(L) >= obs - 1e-12) ge++; }
    return (ge + 1) / (R + 1);
  }
  function judgeGroups(name, d, p, add, noun, pf) {
    const M = QF.money, j = d.filter(g => g.n >= 20);
    if (j.length < 2) { add("info", `${name}: too few trades per group`, "Groups under 20 trades are not judged."); return; }
    const pr = j.filter(g => g.net > 0);
    if (pr.length === j.length) add("ok", `${name}: profitable in every judged ${noun}`, "Groups with 20+ trades are all net positive.");
    else if (pr.length === 1 && !(p >= 0.1)) add("warn", `${name}: result depends on one ${noun}`, `Only "${pr[0].label}" is net positive (${M(pr[0].net)}); the other judged ${noun}s lost ${M(-sum(j.filter(g => g.net <= 0).map(g => g.net)))} combined. Shuffling ${noun} labels reproduces a gap this large in only ${(p * 100).toFixed(0)}% of runs, so it is unlikely to be luck. The system may be a bet on that ${noun === "regime" ? "market condition" : noun}.`);
    else if (pr.length === 1) add("info", `${name}: one ${noun} stands out, but may be luck`, `Only "${pr[0].label}" is net positive (${M(pr[0].net)}), yet shuffling ${noun} labels reproduces a gap this large in ${(p * 100).toFixed(0)}% of runs. With this many trades the pattern is within what chance produces.`);
    else if (pr.length === 0) add("risk", `${name}: no profitable ${noun}`, `None of the judged ${noun}s is net positive.`);
    else add("info", `${name}: mixed`, `${pr.length} of ${j.length} judged ${noun}s are net positive. Gap between best and worst ${noun} vs chance: ${pf(p)}${p < 0.05 ? " (unlikely to be luck)" : " (consistent with luck)"}.`);
  }

  /* ---------- Trading sessions (approximate, UTC-based) ---------- */
  const SESS = [["Asia (00–07 UTC)", 0, 7], ["London (07–12 UTC)", 7, 12], ["London / New York overlap (12–16 UTC)", 12, 16], ["New York (16–21 UTC)", 16, 21], ["Late / rollover (21–24 UTC)", 21, 24]];
  QF.sessionOffset = function (serverTs, o) {
    o = o || {}; if (o.mode === "fixed") return +o.offset || 0;
    const y = new Date(serverTs).getUTCFullYear(), nth = (m, n) => Date.UTC(y, m, 1 + ((7 - new Date(Date.UTC(y, m, 1)).getUTCDay()) % 7) + (n - 1) * 7);
    return serverTs >= nth(2, 2) && serverTs < nth(10, 1) ? 3 : 2;
  };
  QF.sessionSplit = function (trades, o) {
    o = o || {}; const timed = trades.filter(t => t.time && t.time.hasTime && Number.isFinite(t.time.ts));
    if (timed.length < 20 || timed.length < 0.8 * trades.length) throw new Error("Session analysis needs open times (date and clock time) on at least 20 trades and 80% of them.");
    const used = timed.map(t => { const utc = new Date(t.time.ts - QF.sessionOffset(t.time.ts, o) * 3600e3).getUTCHours(); return { t, k: SESS.findIndex(s => utc >= s[1] && utc < s[2]) }; });
    const groups = SESS.map((s, k) => ({ label: s[0], ...tStats(used.filter(u => u.k === k).map(u => u.t)) })), M = QF.money, p = permGap(used.map(u => u.k), used.map(u => u.t.net), SESS.length, 4242);
    const pf = v => Number.isFinite(v) ? "p ≈ " + v.toFixed(2) : "n/a", flags = [], add = (l, t, x) => flags.push({ level: l, title: t, text: x });
    judgeGroups("Trading session", groups, p, add, "session", pf);
    const off = o.mode === "fixed" ? `a fixed offset of UTC${(+o.offset || 0) >= 0 ? "+" : ""}${+o.offset || 0}` : "server time following US daylight saving (UTC+2 in winter, UTC+3 in summer, typical for FX brokers)";
    add("info", "How sessions were assigned", `Open time was converted to UTC assuming ${off}, then mapped to approximate session windows. Real session hours move with local daylight saving, trades near a boundary can fall either side, and the clock change itself is applied by date only. Treat this as a rough guide; check your broker's actual server offset. A wrong offset shifts trades across session boundaries: sessions can be mislabelled, and a pattern close to a boundary can be split between two sessions and look weaker. The "By hour" breakdown does not depend on any offset.`);
    const best = groups.filter(g => g.n >= 20); 
    const metrics = [{ label: "Trades assigned to sessions", value: String(used.length) }, { label: "Session gap vs chance", value: pf(p) }, ...(best.length ? [{ label: "Best session (20+ trades)", value: best.reduce((a, b) => b.net / b.n > a.net / a.n ? b : a).label.split(" (")[0] }] : [])];
    return { metrics, flags, pSession: p, tables: [{ title: "Net result by trading session (open time)", head: ["Session", "Trades", "Net", "Win rate", "Profit factor", "Avg per trade"], rows: groups.map(g => [g.label, g.n, M(g.net), Number.isFinite(g.win) ? g.win.toFixed(1) + "%" : "—", g.pf === Infinity ? "∞" : QF.fmt(g.pf), g.n ? M(g.net / g.n) : "—"]) }] };
  };

  QF.parsePrices = function (text) {
    const p = QF.parseCSV(text), f = names => p.norm.findIndex(h => names.includes(h));
    const dI = f(["date"]), tI = f(["time"]), dtI = f(["datetime", "timestamp"]), hI = f(["high"]), lI = f(["low"]), cI = f(["close"]);
    if (hI < 0 || lI < 0 || cI < 0 || (dI < 0 && tI < 0 && dtI < 0)) throw new Error("The price file needs a date/time plus High, Low and Close columns (MT5 bars export: DATE, TIME, OPEN, HIGH, LOW, CLOSE, ...). Detected headers: " + p.headers.join(" | "));
    const bars = [];
    p.rows.forEach(c => { const stamp = dtI >= 0 ? c[dtI] : (dI >= 0 && tI >= 0 ? c[dI] + " " + c[tI] : c[dI >= 0 ? dI : tI]), d = QF.parseDate(stamp), h = QF.num(c[hI]), l = QF.num(c[lI]), cl = QF.num(c[cI]); if (d && [h, l, cl].every(Number.isFinite)) bars.push({ ts: d.ts, h, l, c: cl }); });
    if (bars.length < 100) throw new Error("Only " + bars.length + " usable bars were read; at least 100 are needed.");
    bars.sort((a, b) => a.ts - b.ts); return bars;
  };
  QF.regimeSplit = function (trades, bars, o) {
    o = o || {}; const erN = o.erN || 20, atrN = o.atrN || 14, n = bars.length;
    const pool = trades.filter(t => (!o.symbol || t.symbol === o.symbol) && t.time && t.time.hasTime && Number.isFinite(t.time.ts));
    if (!pool.length) throw new Error("No trades with an open time" + (o.symbol ? " for " + o.symbol : "") + " were found. Regimes need trade timestamps.");
    const dp = [0], tr = []; for (let i = 0; i < n; i++) { tr.push(Math.max(bars[i].h - bars[i].l, i ? Math.abs(bars[i].h - bars[i - 1].c) : 0, i ? Math.abs(bars[i].l - bars[i - 1].c) : 0)); dp.push(dp[i] + (i ? Math.abs(bars[i].c - bars[i - 1].c) : 0)); }
    const tp = [0]; tr.forEach((v, i) => tp.push(tp[i] + v));
    const er = new Array(n).fill(NaN), av = new Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      if (i >= atrN) av[i] = (tp[i + 1] - tp[i + 1 - atrN]) / atrN / bars[i].c * 100;
      if (i >= erN) { const path = dp[i + 1] - dp[i + 1 - erN], net = Math.abs(bars[i].c - bars[i - erN].c); er[i] = path > 0 ? net / path : NaN; }
    }
    const cuts = a => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return [pctile(v, 1 / 3), pctile(v, 2 / 3)]; }, ec = cuts(er), ac = cuts(av), cls = (v, c) => v <= c[0] ? 0 : v <= c[1] ? 1 : 2;
    const ts = bars.map(b => b.ts), lo = ts[0], hi = ts[n - 1]; let used = [], out = 0;
    pool.forEach(t => {
      if (t.time.ts < lo || t.time.ts > hi) { out++; return; }
      let a = 0, b = n - 1; while (a < b) { const m = (a + b + 1) >> 1; if (ts[m] <= t.time.ts) a = m; else b = m - 1; }
      const i = a - 1; if (i < 0 || !Number.isFinite(er[i]) || !Number.isFinite(av[i])) { out++; return; }
      used.push({ t, tr: cls(er[i], ec), vo: cls(av[i], ac) });
    });
    if (used.length < 20) throw new Error("Only " + used.length + " trades fall inside the price data after the indicator warm-up. Load price data covering the whole trade period.");
    const TL = ["Range-like (lowest third of efficiency ratio)", "Mixed", "Trend-like (highest third)"], VL = ["Low volatility (lowest third of ATR%)", "Mid volatility", "High volatility (highest third of ATR%)"], M = QF.money;
    const dim = (idx, labels) => labels.map((label, k) => { const g = used.filter(u => u[idx] === k).map(u => u.t); return { label, ...tStats(g) }; });
    const dT = dim("tr", TL), dV = dim("vo", VL), total = sum(used.map(u => u.t.net));
    const rows = d => d.map(g => [g.label, g.n, M(g.net), Number.isFinite(g.win) ? g.win.toFixed(1) + "%" : "—", g.pf === Infinity ? "∞" : QF.fmt(g.pf), g.n ? M(g.net / g.n) : "—"]);
    const head = ["Regime", "Trades", "Net", "Win rate", "Profit factor", "Avg per trade"];
    const permP = idx => permGap(used.map(u => u[idx]), used.map(u => u.t.net), 3, o.seed || 777);
    const pT = permP("tr"), pV = permP("vo"), pf = p => Number.isFinite(p) ? "p ≈ " + p.toFixed(2) : "n/a";
    const flags = [], add = (l, t, x) => flags.push({ level: l, title: t, text: x });
    const judge = (name, d, p) => judgeGroups(name, d, p, add, "regime", pf);
    judge("Trend regime", dT, pT); judge("Volatility regime", dV, pV);
    const cov = used.length / pool.length * 100; if (cov < 80) add("warn", "Low price-data coverage", `Only ${cov.toFixed(0)}% of trades could be matched to a regime (${out} fell outside the price data or the warm-up). Load price data for the full trade period.`);
    add("info", "How regimes were measured", `Trend = Kaufman efficiency ratio over ${erN} bars (net move ÷ total path); volatility = ATR(${atrN}) as % of price. Each is split into thirds of all bars in the price file (efficiency ratio cut-offs ${ec[0].toFixed(2)} / ${ec[1].toFixed(2)}; ATR% cut-offs ${ac[0].toFixed(3)} / ${ac[1].toFixed(3)}). Each trade uses the last bar completed before it opened. Regime splits reduce sample sizes, so differences between groups can be noise; the permutation test (2,000 shuffles of regime labels, on the gap between the best and worst group average) estimates how often chance alone gives a gap that large.`);
    const cross = { title: "Net result by trend × volatility (trades in brackets)", head: ["Trend \\ Volatility", "Low", "Mid", "High"], rows: [0, 1, 2].map(a => [["Range-like", "Mixed", "Trend-like"][a], ...[0, 1, 2].map(b => { const g = used.filter(u => u.tr === a && u.vo === b).map(u => u.t); return g.length ? M(sum(g.map(t => t.net))) + " (" + g.length + ")" : "—"; })]) };
    const metrics = [{ label: "Trades matched to a regime", value: `${used.length} of ${pool.length}` }, { label: "Regime gap vs chance (trend / volatility)", value: pf(pT) + " / " + pf(pV) }, ...dT.filter(g => g.n >= 20).length ? [{ label: "Best trend regime", value: dT.filter(g => g.n >= 20).reduce((a, b) => b.net > a.net ? b : a).label.split(" (")[0] }] : []];
    return { metrics, flags, pTrend: pT, pVol: pV, tables: [{ title: "Net result by trend regime", head, rows: rows(dT) }, { title: "Net result by volatility regime", head, rows: rows(dV) }, cross], coverage: cov };
  };
  QF.demo.prices = function () {
    const r = rng(5), L = ["<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>"], end = Date.UTC(2026, 5, 1); let px = 1.09, anchor = px, i = 0, lastTrend = true;
    for (let t = Date.UTC(2025, 11, 15, 0); t < end; t += 3600e3) {
      const d = new Date(t), dow = d.getUTCDay(); if (dow === 0 || dow === 6) continue;
      const trend = Math.floor(i / 150) % 2 === 0, dir = Math.floor(i / 300) % 2 === 0 ? 1 : -1; if (!trend && lastTrend) anchor = px; lastTrend = trend;
      const o = px; px = trend ? px + dir * 0.00012 + gauss(r) * 0.0004 : px + (anchor - px) * 0.15 + gauss(r) * 0.0003;
      const hi = Math.max(o, px) + Math.abs(gauss(r)) * 0.0002, lo = Math.min(o, px) - Math.abs(gauss(r)) * 0.0002, p2 = v => String(v).padStart(2, "0");
      L.push([`${d.getUTCFullYear()}.${p2(d.getUTCMonth() + 1)}.${p2(d.getUTCDate())}`, `${p2(d.getUTCHours())}:00:00`, o.toFixed(5), hi.toFixed(5), lo.toFixed(5), px.toFixed(5), 100, 0, 10].join("\t")); i++;
    }
    return L.join("\n");
  };

  /* ---------- report ---------- */
  QF.report = function (r) {
    const L = ["# " + r.title, "", "Source: " + r.source, "Generated: " + new Date().toISOString().slice(0, 10), "", "## Key metrics", "", "| Metric | Value |", "|---|---|"];
    r.metrics.forEach(m => L.push(`| ${m.label} | ${m.value} |`));
    const tag = { risk: "RISK", warn: "WATCH", info: "NOTE", ok: "OK" };
    L.push("", "## Findings", ""); r.flags.forEach(f => L.push(`- **[${tag[f.level]}] ${f.title}.** ${f.text}`));
    (r.tables || []).forEach(t => { L.push("", "## " + t.title, "", "| " + t.head.join(" | ") + " |", "|" + t.head.map(() => "---").join("|") + "|"); t.rows.forEach(row => L.push("| " + row.join(" | ") + " |")); });
    L.push("", "---", "Descriptive analysis of the supplied data only. It does not predict future results and is not financial advice.");
    return L.join("\n");
  };

  /* ---------- browser helpers ---------- */
  QF.ui = {
    metrics(el, list) { el.innerHTML = list.map(m => `<div class="metric"><span>${QF.esc(m.label)}</span><strong>${QF.esc(m.value)}</strong></div>`).join(""); },
    flags(el, list) {
      const tag = { risk: "Risk", warn: "Watch", info: "Note", ok: "OK" };
      el.innerHTML = list.map(f => `<div class="flag ${f.level}"><span class="flag-tag">${tag[f.level]}</span><div><strong>${QF.esc(f.title)}</strong><p>${QF.esc(f.text)}</p></div></div>`).join("");
    },
    table(headEl, bodyEl, head, rows) {
      headEl.innerHTML = "<tr>" + head.map(h => `<th>${QF.esc(h)}</th>`).join("") + "</tr>";
      bodyEl.innerHTML = rows.map(r => "<tr>" + r.map(c => `<td>${QF.esc(c)}</td>`).join("") + "</tr>").join("");
    },
    tableHTML(t) { return `<h3>${QF.esc(t.title)}</h3><div class="table-wrap"><table><thead><tr>${t.head.map(h => `<th>${QF.esc(h)}</th>`).join("")}</tr></thead><tbody>${t.rows.map(r => "<tr>" + r.map(c => `<td>${QF.esc(c)}</td>`).join("") + "</tr>").join("")}</tbody></table></div>`; },
    download(name, text) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  };
  function setup(cv, h) { const rect = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; cv.width = Math.max(300, rect.width * dpr); cv.height = h * dpr; const c = cv.getContext("2d"); c.scale(dpr, dpr); return { c, w: cv.width / dpr, h }; }
  QF.draw = {
    lines(cv, series) {
      const { c, w, h } = setup(cv, 270), pad = 36, vals = series.flatMap(s => s.values), min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1, len = series[0].values.length;
      const x = i => pad + (w - pad - 12) * (i / Math.max(1, len - 1)), y = v => h - 24 - (h - 24 - 12) * (v - min) / range;
      c.strokeStyle = "#263349"; c.lineWidth = 1; c.fillStyle = "#aab4c7"; c.font = "11px Arial";
      for (let i = 0; i < 5; i++) { const yy = 12 + (h - 36) * i / 4; c.beginPath(); c.moveTo(pad, yy); c.lineTo(w - 12, yy); c.stroke(); c.fillText(QF.fmt(max - range * i / 4, 0), 2, yy + 4); }
      series.forEach(s => { c.strokeStyle = s.color; c.lineWidth = 1.8; c.beginPath(); s.values.forEach((v, i) => i ? c.lineTo(x(i), y(v)) : c.moveTo(x(i), y(v))); c.stroke(); });
    },
    hist(cv, values, marks) {
      const { c, w, h } = setup(cv, 240), pad = 36, min = Math.min(...values), max = Math.max(...values), B = 28, bw = (max - min) / B || 1, bins = new Array(B).fill(0);
      values.forEach(v => bins[Math.min(B - 1, Math.floor((v - min) / bw))]++); const mx = Math.max(...bins), x = v => pad + (w - pad - 12) * (v - min) / ((max - min) || 1);
      c.fillStyle = "#3b5f94"; bins.forEach((b, i) => { const bx = pad + (w - pad - 12) * i / B, bh = (h - 44) * b / mx; c.fillRect(bx + 1, h - 24 - bh, (w - pad - 12) / B - 2, bh); });
      c.font = "11px Arial"; c.fillStyle = "#aab4c7"; c.fillText(QF.fmt(min, 0), pad, h - 8); c.textAlign = "right"; c.fillText(QF.fmt(max, 0), w - 12, h - 8); c.textAlign = "left";
      marks.forEach((m, i) => { c.strokeStyle = m.color; c.lineWidth = 2; c.beginPath(); c.moveTo(x(m.value), 8); c.lineTo(x(m.value), h - 24); c.stroke(); c.fillStyle = m.color; c.fillText(m.label, Math.min(x(m.value) + 4, w - 90), 16 + i * 14); });
    }
  };

  QF.draw.heat = function (cv, hm) {
    const cols = hm.xs.length, rows = hm.ys.length, padL = 78, padB = 40, padT = 8, padR = 12, dpr = window.devicePixelRatio || 1, w = Math.max(320, cv.getBoundingClientRect().width);
    const cell = Math.max(16, Math.min(56, Math.floor((w - padL - padR) / cols))), h = padT + rows * cell + padB;
    cv.style.height = h + "px"; cv.width = w * dpr; cv.height = h * dpr; const c = cv.getContext("2d"); c.scale(dpr, dpr);
    const flat = hm.grid.flat().filter(Number.isFinite), mx = Math.max(...flat, 0), mn = Math.min(...flat, 0), base = [26, 39, 64], pos = [101, 221, 176], neg = [255, 146, 146];
    const mix = (a, b, t) => "rgb(" + a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",") + ")";
    c.font = "11px Arial"; c.textBaseline = "middle";
    hm.grid.forEach((row, yi) => row.forEach((v, xi) => {
      const x = padL + xi * cell, y = padT + (rows - 1 - yi) * cell;
      if (!Number.isFinite(v)) { c.strokeStyle = "#263349"; c.setLineDash([3, 3]); c.strokeRect(x + .5, y + .5, cell - 1, cell - 1); c.setLineDash([]); return; }
      const t = v >= 0 ? (mx ? v / mx : 0) : (mn ? v / mn : 0); c.fillStyle = mix(base, v >= 0 ? pos : neg, Math.min(1, t)); c.fillRect(x, y, cell - 1, cell - 1);
      if (cell >= 34) { c.fillStyle = t > 0.55 ? "#07101e" : "#e8edf7"; c.textAlign = "center"; c.fillText(Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(0), x + cell / 2, y + cell / 2); }
    }));
    c.strokeStyle = "#ffd37a"; c.lineWidth = 2; c.strokeRect(padL + hm.bx * cell + 1, padT + (rows - 1 - hm.by) * cell + 1, cell - 3, cell - 3);
    c.fillStyle = "#aab4c7"; c.textAlign = "center"; const sx = cell >= 30 ? 1 : 2;
    hm.xs.forEach((v, i) => { if (i % sx === 0) c.fillText(String(+v.toFixed(4)), padL + i * cell + cell / 2, padT + rows * cell + 12); });
    c.fillText(hm.xName, padL + cols * cell / 2, padT + rows * cell + 28);
    c.textAlign = "right"; hm.ys.forEach((v, i) => { if (i % sx === 0) c.fillText(String(+v.toFixed(4)), padL - 6, padT + (rows - 1 - i) * cell + cell / 2); });
    c.save(); c.translate(10, padT + rows * cell / 2); c.rotate(-Math.PI / 2); c.textAlign = "center"; c.fillText(hm.yName, 0, 0); c.restore();
  };

  QF.draw.bars = function (cv, labels, values) {
    const { c, w, h } = setup(cv, 200), pad = 46, mx = Math.max(...values, 0), mn = Math.min(...values, 0), rg = (mx - mn) || 1, y = v => 10 + (h - 38) * (mx - v) / rg, bw = (w - pad - 12) / values.length;
    c.strokeStyle = "#263349"; c.lineWidth = 1; c.fillStyle = "#aab4c7"; c.font = "11px Arial";
    c.beginPath(); c.moveTo(pad, y(0)); c.lineTo(w - 12, y(0)); c.stroke(); c.textAlign = "right"; c.fillText(QF.fmt(mx, 0), pad - 4, 16); c.fillText(QF.fmt(mn, 0), pad - 4, h - 26); c.fillText("0", pad - 4, y(0) + 4);
    values.forEach((v, i) => { c.fillStyle = v >= 0 ? "#65ddb0" : "#ff9292"; const top = Math.min(y(v), y(0)), ht = Math.max(1, Math.abs(y(v) - y(0))); c.fillRect(pad + i * bw + 2, top, Math.max(2, bw - 4), ht); });
    c.fillStyle = "#aab4c7"; c.textAlign = "left"; c.fillText(labels[0], pad, h - 8); c.textAlign = "right"; c.fillText(labels[labels.length - 1], w - 12, h - 8); c.textAlign = "left";
  };

  root.QF = QF; if (typeof module !== "undefined") module.exports = QF;
})(typeof window !== "undefined" ? window : globalThis);
