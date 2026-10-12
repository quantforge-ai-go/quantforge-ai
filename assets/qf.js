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
    return { dow: dt.getUTCDay(), hour: h, hasTime: !!m[4] };
  };
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
    return { mode: "trades", label: "Trade analysis", metrics, flags, breakdowns, series: [{ name: "Cumulative net P/L", color: "#70aaff", values: cum }],
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
    return { mode: "graph", label: "Balance & equity analysis", metrics, flags, breakdowns: [],
      series: [{ name: "Balance", color: "#70aaff", values: data.map(x => x.balance) }, { name: "Equity", color: "#65ddb0", values: data.map(x => x.equity) }],
      preview: { head: ["#", "Date", "Balance", "Equity", "Deposit load"], rows: data.slice(0, 10).map((x, i) => [i + 1, x.date, QF.money(x.balance), QF.money(x.equity), Number.isFinite(x.load) ? x.load.toFixed(4) + "%" : "—"]) } };
  };

  /* ---------- optimization analysis ---------- */
  const KNOWN = { pass: "pass", result: "result", profit: "profit", expectedpayoff: "payoff", profitfactor: "pf", recoveryfactor: "rf", sharperatio: "sharpe", custom: "custom", equityddpct: "eqdd", balanceddpct: "baldd", trades: "trades", forwardresult: "fwd", backresult: "back" };
  QF.toOptimization = function (p) {
    const N = p.rows.length, cols = p.headers.map((h, j) => { const vals = p.rows.map(r => QF.num(r[j])); return { j, name: h, key: KNOWN[p.norm[j]] || null, vals, share: vals.filter(Number.isFinite).length / N }; });
    const idx = {}; cols.forEach(c => { if (c.key && c.share > 0.5) idx[c.key] = c.j; });
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
    trades() {
      const r = rng(7), L = ["Time,Symbol,Type,Volume,Commission,Swap,Profit"]; let t = Date.UTC(2026, 0, 2, 8);
      for (let i = 0; i < 220; i++) {
        t += (4 + Math.floor(r() * 20)) * 3600e3; const d = new Date(t), win = r() < 0.68;
        let p = win ? 22 + Math.abs(gauss(r)) * 14 : -(24 + Math.abs(gauss(r)) * 30); if (i === 90) p = 520; if (i === 150) p = -260;
        const ts = `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:00:00`;
        L.push([ts, i % 3 ? "EURUSD" : "XAUUSD", r() < 0.55 ? "buy" : "sell", "0.10", -0.7, (-0.1 * r()).toFixed(2), p.toFixed(2)].join(","));
      }
      return L.join("\n");
    },
    graph() {
      const r = rng(11), L = ["DATE,BALANCE,EQUITY,DEPOSIT LOAD"]; let bal = 3000;
      for (let i = 0; i < 300; i++) { if (i % 6 === 0) bal += gauss(r) * 18 + 2; const fl = r() < 0.35 ? 0 : (i > 120 && i < 170 ? Math.abs(gauss(r)) * 140 : Math.abs(gauss(r)) * 15), dd = new Date(Date.UTC(2026, 0, 1 + (i >> 1))); L.push(`${dd.getUTCFullYear()}.${String(dd.getUTCMonth() + 1).padStart(2, "0")}.${String(dd.getUTCDate()).padStart(2, "0")},${bal.toFixed(2)},${(bal - fl).toFixed(2)},${(fl / 40 + r() * 3).toFixed(2)}`); }
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

  root.QF = QF; if (typeof module !== "undefined") module.exports = QF;
})(typeof window !== "undefined" ? window : globalThis);
