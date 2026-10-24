/*
 * Dashboard UI: renders the forecast from ElectionModel and refreshes the
 * poll list from Wikipedia on demand. Plain DOM + SVG, no framework.
 */
(function () {
  'use strict';

  const C = window.ElectionConfig;
  const M = window.ElectionModel;
  const W = window.WikiSource;
  const SNAP = window.POLL_SNAPSHOT;

  const STORE_KEY = 'midterm2026.polls.v1';
  const PREF_KEY = 'midterm2026.prefs.v1';
  const SIMS = 10000;
  const TRUSTED_COUNT = C.POLLSTERS.length;
  const POLLSTER = M.POLLSTER_BY_ID;

  const state = {
    polls: SNAP.polls.slice(),
    data: { origin: 'snapshot', compiled: SNAP.meta.compiled, fetchedAt: SNAP.meta.refreshed || null },
    settings: { includeOthers: false, halfLifeDays: 21, applyBias: true },
    result: null,
    tab: 'senate',
    sort: { Senate: { key: 'close', dir: 1 }, Governor: { key: 'close', dir: 1 } },
    filter: { Senate: 'all', Governor: 'all' },
    refreshing: false,
    openRace: null
  };

  // ------------------------------------------------------------- helpers
  const $ = function (id) { return document.getElementById(id); };
  const SVGNS = 'http://www.w3.org/2000/svg';

  function build(doc, ns) {
    return function (tag, attrs) {
      const node = ns ? doc.createElementNS(ns, tag) : doc.createElement(tag);
      if (attrs) {
        Object.keys(attrs).forEach(function (k) {
          const v = attrs[k];
          if (v == null || v === false) return;
          if (k === 'class') node.setAttribute('class', v);
          else if (k === 'text') node.textContent = v;
          else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
          else node.setAttribute(k, v === true ? '' : String(v));
        });
      }
      for (let i = 2; i < arguments.length; i++) append(node, arguments[i]);
      return node;
    };
  }
  function append(node) {
    for (let i = 1; i < arguments.length; i++) appendOne(node, arguments[i]);
    return node;
  }
  function appendOne(node, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { appendOne(node, c); }); return; }
    node.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
  const h = build(document);
  const sv = build(document, SVGNS);
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  function localISO(d) {
    const x = d || new Date();
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  }
  function asOf() {
    const today = localISO();
    return today < C.ELECTION_DATE ? today : C.ELECTION_DATE;
  }
  const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dparts(iso) { const p = iso.split('-').map(Number); return { y: p[0], m: p[1], d: p[2] }; }
  function fmtDay(iso) { const p = dparts(iso); return MONTH_ABBR[p.m - 1] + ' ' + p.d; }
  function fmtDayYear(iso) { const p = dparts(iso); return MONTH_ABBR[p.m - 1] + ' ' + p.d + ', ' + p.y; }
  function fmtRange(a, b) {
    if (!a || a === b) return fmtDay(b || a);
    const pa = dparts(a), pb = dparts(b);
    return pa.m === pb.m ? MONTH_ABBR[pa.m - 1] + ' ' + pa.d + '–' + pb.d : fmtDay(a) + ' – ' + fmtDay(b);
  }
  function fmtTime(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch (e) { return iso; }
  }
  function fmtProb(p) {
    if (p == null) return '–';
    if (p > 0.99) return '>99%';
    if (p < 0.01) return '<1%';
    return Math.round(p * 100) + '%';
  }
  const fmtMargin = M.fmtMargin;
  function sideOf(party) { return party === 'D' ? 'd' : party === 'R' ? 'r' : 'i'; }
  function partyWord(party) { return party === 'D' ? 'Democrat' : party === 'R' ? 'Republican' : 'Independent'; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function raceTitle(race) { return race.stateName + ' ' + (race.office === 'Senate' ? 'Senate' + (race.special ? ' (special)' : '') : race.office === 'Governor' ? 'governor' : 'generic ballot'); }
  function fillClass(r) { return 'fill-' + r.rating.key; }
  function ratingColorVar(key) {
    const map = { 'safe-d': '--d3', 'likely-d': '--d2', 'lean-d': '--d1', 'safe-r': '--r3', 'likely-r': '--r2', 'lean-r': '--r1', 'safe-i': '--i3', 'likely-i': '--i2', 'lean-i': '--i1', tossup: '--toss' };
    return 'var(' + (map[key] || '--toss') + ')';
  }

  // ------------------------------------------------------------- storage
  function readStore(key) {
    try { const raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function writeStore(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function dropStore(key) { try { window.localStorage.removeItem(key); } catch (e) { /* storage unavailable */ } }

  function loadSaved() {
    const prefs = readStore(PREF_KEY);
    if (prefs && typeof prefs === 'object') {
      if (typeof prefs.includeOthers === 'boolean') state.settings.includeOthers = prefs.includeOthers;
      if ([7, 14, 21, 30].indexOf(prefs.halfLifeDays) !== -1) state.settings.halfLifeDays = prefs.halfLifeDays;
      if (typeof prefs.applyBias === 'boolean') state.settings.applyBias = prefs.applyBias;
    }
    const saved = readStore(STORE_KEY);
    if (saved && SNAP.meta.refreshed && saved.fetchedAt && saved.fetchedAt < SNAP.meta.refreshed) {
      // The bundled data was pulled from Wikipedia after this saved copy, so it supersedes it.
      dropStore(STORE_KEY);
    } else if (saved && Array.isArray(saved.polls) && saved.polls.length && saved.fetchedAt) {
      // Keep any hand-compiled rows the saved copy predates, then lay the saved rows on top.
      state.polls = W.mergePolls(SNAP.polls.slice(), saved.polls).polls;
      state.data = { origin: saved.origin || 'wikipedia', compiled: SNAP.meta.compiled, fetchedAt: saved.fetchedAt, pagesOk: saved.pagesOk, pagesTotal: saved.pagesTotal };
    }
  }

  // ------------------------------------------------------------- compute
  function recompute() {
    const s = Object.assign({}, state.settings, { asOf: asOf(), sims: SIMS });
    state.result = M.run(state.polls, s);
    renderAll();
  }

  function renderAll() {
    renderStatus();
    renderSummary();
    renderOffice('Senate');
    renderOffice('Governor');
    renderHouse();
    renderPollsters();
    renderMethod();
    if (state.openRace && $('race-dialog').open) renderRace(state.openRace);
  }

  // ------------------------------------------------------------- status
  function trustedCount() {
    return state.polls.filter(function (p) { return p.pollsterId && POLLSTER[p.pollsterId]; }).length;
  }

  function renderStatus() {
    const box = clear($('data-status'));
    const n = trustedCount();
    if (state.data.fetchedAt && state.data.origin !== 'snapshot') {
      append(box, 'Refreshed ' + fmtTime(state.data.fetchedAt) +
        (state.data.pagesTotal ? ' from ' + state.data.pagesOk + ' of ' + state.data.pagesTotal + ' pages' : '') +
        ' · ' + plural(n, 'trusted poll') + ' · ');
      append(box, h('button', { type: 'button', class: 'btn-link', onclick: resetToSnapshot, text: 'Use bundled snapshot' }));
    } else if (SNAP.meta.refreshed) {
      append(box, 'Bundled data, last pulled from Wikipedia ' + fmtTime(SNAP.meta.refreshed) + ' · ' + plural(n, 'trusted poll'));
    } else {
      append(box, 'Bundled snapshot, compiled ' + fmtDayYear(state.data.compiled) + ' · ' + plural(n, 'trusted poll'));
    }
    const days = M.daysBetween(localISO(), C.ELECTION_DATE);
    $('countdown').textContent = days > 1 ? days + ' days to go' : days === 1 ? 'Tomorrow' : days === 0 ? 'Today' : 'Results pending';
    $('sim-count').textContent = SIMS.toLocaleString();
  }

  function resetToSnapshot() {
    dropStore(STORE_KEY);
    state.polls = SNAP.polls.slice();
    state.data = { origin: 'snapshot', compiled: SNAP.meta.compiled, fetchedAt: SNAP.meta.refreshed || null };
    $('change-banner').hidden = true;
    recompute();
  }

  // ------------------------------------------------------------- summary
  function renderSummary() {
    const r = state.result;
    const sen = r.senate;
    const dLead = sen.probD >= sen.probR;
    $('hero-party').textContent = dLead ? 'Democrats' : 'Republicans';
    $('hero-value').textContent = fmtProb(dLead ? sen.probD : sen.probR);
    $('hero-sub').textContent = (dLead ? 'Republicans ' + fmtProb(sen.probR) : 'Democrats ' + fmtProb(sen.probD)) +
      ' · no outright majority ' + fmtProb(sen.probNeither);

    const bar = clear($('control-bar'));
    [['var(--dem)', sen.probD], ['var(--toss)', sen.probNeither], ['var(--rep)', sen.probR]].forEach(function (seg) {
      if (seg[1] > 0) append(bar, h('span', { style: 'flex:' + seg[1].toFixed(4) + ';background:' + seg[0] }));
    });
    const leg = clear($('control-legend'));
    [['var(--dem)', 'Democrats (51+ seats)', sen.probD], ['var(--toss)', 'Independents decide', sen.probNeither], ['var(--rep)', 'Republicans (50+ with VP)', sen.probR]].forEach(function (x) {
      append(leg, h('li', null, h('span', { class: 'swatch', style: 'background:' + x[0] }), x[1] + ' ', h('strong', { text: fmtProb(x[2]) })));
    });

    const dSeats = sen.seatsD.mean, rSeats = sen.seatsR.mean, iSeats = Math.max(0, 100 - dSeats - rSeats);
    seatLine($('kpi-seats'), [['D', dSeats], ['R', rSeats]]);
    $('kpi-seats-note').textContent = 'Average across simulations' +
      (iSeats >= 0.05 ? ', plus ' + iSeats.toFixed(1) + ' for independents such as Dan Osborn' : '') +
      '. Republicans win ' + sen.range80R[0] + '–' + sen.range80R[1] + ' seats in 80% of them.';
    const g = r.governors;
    const gD = g.seatsD.mean;
    seatLine($('kpi-gov'), [['D', gD], ['R', 50 - gD]]);
    $('kpi-gov-note').textContent = 'Chance Democrats hold a majority (26+): ' + fmtProb(g.probDMajority) + '. Today: 24 D, 26 R.';
    const env = r.env;
    $('kpi-env').textContent = fmtMargin(env.margin);
    $('kpi-env-note').textContent = env.fromPolls
      ? 'Generic-ballot average of ' + plural(env.avg.count, 'poll') + (state.settings.includeOthers ? '' : ' from trusted pollsters') + '. Sets the baseline for every race.'
      : 'No generic-ballot polls available; using a default baseline.';
  }

  function seatLine(node, parts) {
    clear(node);
    parts.forEach(function (p, i) {
      if (i) append(node, h('span', { class: 'sep', 'aria-hidden': 'true', text: ' · ' }));
      append(node, h('span', { class: 'nowrap', text: p[0] + ' ' + Math.round(p[1]) }));
    });
  }

  // ------------------------------------------------------ office renders
  function officeResults(office) {
    return state.result.races.filter(function (x) { return x.race.office === office; });
  }

  function renderOffice(office) {
    const key = office === 'Senate' ? 'senate' : 'governor';
    const results = officeResults(office);
    renderMap($('map-' + key), results);
    renderLegend($('legend-' + key), results, office);
    renderBalance($('balance-' + key), results, office);
    renderHistogram(key, office);
    renderRaceTable($('table-' + key), results, office);
  }

  function chanceFor(r) {
    const c0 = r.race.candidates[0], c1 = r.race.candidates[1];
    const lead = r.prob >= 0.5 ? c0 : c1;
    return { lead: lead, p: r.prob >= 0.5 ? r.prob : 1 - r.prob, c0: c0, c1: c1 };
  }

  function raceSummaryNodes(r) {
    const ch = chanceFor(r);
    return [
      h('div', { class: 'tt-value', text: raceTitle(r.race) }),
      h('div', null, ch.c0.name + ' (' + ch.c0.party + ') ' + fmtProb(r.prob) + ' · ' + ch.c1.name + ' (R) ' + fmtProb(1 - r.prob)),
      h('div', { class: 'tt-dim' }, 'Forecast ' + fmtMargin(r.final.mean, r.race) + ' · ' + r.rating.label + ' · ' + coverageText(r))
    ];
  }
  function coverageText(r) {
    if (!r.avg) return 'no qualifying polls';
    const t = r.avg.rows.filter(function (x) { return x.pollster; }).length;
    const o = r.avg.count - t;
    return plural(t, 'trusted poll') + (o ? ' + ' + o + ' other' : '');
  }

  function renderMap(root, results) {
    clear(root);
    const byState = {};
    results.forEach(function (r) { byState[r.race.state] = r; });
    Object.keys(C.TILE_GRID).forEach(function (st) {
      const pos = C.TILE_GRID[st];
      const r = byState[st];
      const style = 'grid-column:' + (pos[0] + 1) + ';grid-row:' + (pos[1] + 1);
      if (!r) {
        append(root, h('div', { class: 'tile empty', style: style, 'aria-hidden': 'true' }, h('span', { class: 'abbr', text: st })));
        return;
      }
      const ch = chanceFor(r);
      const tile = h('button', {
        type: 'button',
        class: 'tile ' + fillClass(r) + (r.race.special ? ' special' : ''),
        style: style,
        'aria-label': raceTitle(r.race) + ': ' + ch.lead.name + ' ' + fmtProb(ch.p) + ', ' + r.rating.label,
        onclick: function () { openRace(r.race.id); }
      }, h('span', { class: 'abbr', text: st }), h('span', { class: 'pct', text: ch.lead.party + ' ' + Math.round(ch.p * 100) }));
      tipOn(tile, function () { return raceSummaryNodes(r); });
      append(root, tile);
    });
  }

  const RATING_ORDER = ['safe-d', 'likely-d', 'lean-d', 'safe-i', 'likely-i', 'lean-i', 'tossup', 'lean-r', 'likely-r', 'safe-r'];
  const RATING_LABEL = { 'safe-d': 'Safe D', 'likely-d': 'Likely D', 'lean-d': 'Lean D', 'safe-i': 'Safe I', 'likely-i': 'Likely I', 'lean-i': 'Lean I', tossup: 'Toss-up', 'lean-r': 'Lean R', 'likely-r': 'Likely R', 'safe-r': 'Safe R' };

  function renderLegend(root, results, office) {
    clear(root);
    const present = {};
    results.forEach(function (r) { present[r.rating.key] = true; });
    RATING_ORDER.forEach(function (k) {
      if (!present[k] && k.slice(-2) === '-i') return;
      append(root, h('li', null, h('span', { class: 'swatch', style: 'background:' + ratingColorVar(k) }), RATING_LABEL[k]));
    });
    append(root, h('li', { class: 'note', text: 'Safe 95%+, Likely 80%+, Lean 60%+' }));
    if (office === 'Senate') append(root, h('li', { class: 'note', text: '• marks a special election' }));
  }

  function renderBalance(root, results, office) {
    clear(root);
    const counts = {};
    results.forEach(function (r) { counts[r.rating.key] = (counts[r.rating.key] || 0) + 1; });
    const holdD = office === 'Senate' ? C.SENATE_HOLDOVERS.D : C.GOVERNORS_NOT_UP.D;
    const holdR = office === 'Senate' ? C.SENATE_HOLDOVERS.R : C.GOVERNORS_NOT_UP.R;
    const total = office === 'Senate' ? 100 : 50;
    const mark = office === 'Senate' ? 50 : 25;
    const segs = [{ key: 'hold-d', n: holdD, label: 'Democrats not up' }]
      .concat(RATING_ORDER.map(function (k) { return { key: k, n: counts[k] || 0, label: RATING_LABEL[k] }; }))
      .concat([{ key: 'hold-r', n: holdR, label: 'Republicans not up' }])
      .filter(function (s) { return s.n > 0; });
    const bar = h('div', { class: 'balance-bar', role: 'img', 'aria-label': segs.map(function (s) { return s.label + ' ' + s.n; }).join(', ') });
    segs.forEach(function (s) {
      const seg = h('div', { class: 'seg fill-' + s.key, style: 'flex:' + s.n }, s.n >= (office === 'Senate' ? 3 : 2) ? String(s.n) : '');
      tipOn(seg, function () { return [h('div', { class: 'tt-value', text: s.n + ' ' + (office === 'Senate' ? 'seats' : 'governorships') }), h('div', { text: s.label })]; });
      append(bar, seg);
    });
    append(bar, h('div', { class: 'balance-mark', style: 'left:' + (mark / total * 100) + '%', title: 'Majority line' }));
    const dAtLeast = holdD + ['safe-d', 'likely-d', 'lean-d'].reduce(function (a, k) { return a + (counts[k] || 0); }, 0);
    const rAtLeast = holdR + ['safe-r', 'likely-r', 'lean-r'].reduce(function (a, k) { return a + (counts[k] || 0); }, 0);
    const iAtLeast = ['safe-i', 'likely-i', 'lean-i'].reduce(function (a, k) { return a + (counts[k] || 0); }, 0);
    append(root, bar, h('div', { class: 'balance-scale' },
      h('span', null, 'Democrats ', h('strong', { text: String(dAtLeast) }), ' at least lean'),
      h('span', null, h('strong', { text: String(counts.tossup || 0) }), ' toss-up' + (iAtLeast ? ', ' + iAtLeast + ' independent' : '')),
      h('span', null, 'Republicans ', h('strong', { text: String(rAtLeast) }), ' at least lean')));
  }

  function renderHistogram(key, office) {
    const root = clear($('hist-' + key));
    const table = clear($('hist-' + key + '-table'));
    const stats = office === 'Senate' ? state.result.senate.seatsR : state.result.governors.seatsD;
    const hist = stats.hist;
    let lo = hist.findIndex(function (p) { return p >= 0.002; });
    let hi = hist.length - 1 - hist.slice().reverse().findIndex(function (p) { return p >= 0.002; });
    const threshold = office === 'Senate' ? C.SENATE_CONTROL.R : 26;
    lo = Math.min(lo, threshold - 3); hi = Math.max(hi, threshold + 2);
    const width = Math.max(280, Math.round(root.getBoundingClientRect().width || 520));
    const height = 170, pad = { l: 36, r: 8, t: 18, b: 28 };
    const n = hi - lo + 1;
    const band = (width - pad.l - pad.r) / n;
    const bw = Math.min(24, Math.max(3, band - 2));
    const maxP = Math.max.apply(null, hist.slice(lo, hi + 1)) || 1;
    const tickPct = maxP > 0.3 ? 10 : 5;
    const yMax = Math.ceil(maxP * 100 / tickPct) * tickPct / 100;
    const y = function (p) { return pad.t + (height - pad.t - pad.b) * (1 - p / yMax); };
    const svg = sv('svg', { viewBox: '0 0 ' + width + ' ' + height, width: width, height: height, role: 'img', 'aria-label': (office === 'Senate' ? 'Republican Senate seats' : 'Democratic governorships') + ' by share of simulations' });
    for (let t = 0; t <= Math.round(yMax * 100); t += tickPct) {
      append(svg, sv('line', { class: 'grid-line', x1: pad.l, x2: width - pad.r, y1: y(t / 100), y2: y(t / 100) }));
      append(svg, sv('text', { class: 'axis-text', x: pad.l - 6, y: y(t / 100) + 4, 'text-anchor': 'end', text: t + '%' }));
    }
    for (let k = lo; k <= hi; k++) {
      const x = pad.l + (k - lo) * band + (band - bw) / 2;
      const p = hist[k] || 0;
      const top = y(p), base = y(0);
      const hBar = Math.max(0, base - top);
      const cls = office === 'Senate' ? (k >= threshold ? 'bar-r' : 'bar-d') : (k >= threshold ? 'bar-d' : 'bar-r');
      if (hBar > 0.5) {
        const r = Math.min(4, bw / 2, hBar);
        append(svg, sv('path', { class: cls, d: 'M' + x + ',' + base + 'V' + (top + r) + 'Q' + x + ',' + top + ' ' + (x + r) + ',' + top + 'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + top + ' ' + (x + bw) + ',' + (top + r) + 'V' + base + 'Z' }));
      }
      if ((k - lo) % (n > 14 ? 2 : 1) === 0 || k === threshold) {
        append(svg, sv('text', { class: k === threshold ? 'label-strong' : 'axis-text', x: x + bw / 2, y: height - pad.b + 16, 'text-anchor': 'middle', text: String(k) }));
      }
      const hit = sv('rect', { class: 'hit', x: pad.l + (k - lo) * band, y: pad.t, width: band, height: height - pad.t - pad.b, tabindex: '0', 'aria-label': k + ': ' + (p * 100).toFixed(1) + '%' });
      (function (seats, prob) {
        tipOn(hit, function () {
          return [h('div', { class: 'tt-value', text: (prob * 100).toFixed(1) + '% of simulations' }),
            h('div', { text: seats + (office === 'Senate' ? ' Republican seats' : ' Democratic governorships') })];
        });
      })(k, p);
      append(svg, hit);
    }
    append(svg, sv('line', { class: 'axis-line', x1: pad.l, x2: width - pad.r, y1: y(0), y2: y(0) }));
    const tx = pad.l + (threshold - lo) * band;
    append(svg, sv('line', { x1: tx, x2: tx, y1: pad.t - 6, y2: y(0), stroke: 'var(--ink)', 'stroke-width': 1.5 }));
    append(svg, sv('text', { class: 'label-text', x: tx + 4, y: pad.t - 6, text: office === 'Senate' ? '50+ = Republican control' : '26+ = Democratic majority' }));
    append(root, svg);

    append(table, h('thead', null, h('tr', null, h('th', { text: office === 'Senate' ? 'Republican seats' : 'Democratic governorships' }), h('th', { class: 'num', text: 'Share of simulations' }))));
    const body = h('tbody');
    for (let k = lo; k <= hi; k++) append(body, h('tr', null, h('td', { text: String(k) }), h('td', { class: 'num', text: ((hist[k] || 0) * 100).toFixed(1) + '%' })));
    append(table, body);
  }

  // ------------------------------------------------------------ race table
  const SORTS = {
    close: function (r) { return Math.abs(r.prob - 0.5); },
    state: function (r) { return r.race.stateName; },
    chance: function (r) { return -r.prob; },
    margin: function (r) { return -r.final.mean; },
    polls: function (r) { return -(r.avg ? r.avg.nEff : 0); },
    latest: function (r) { return r.avg ? -M.daysBetween('2000-01-01', r.avg.latest) : 0; }
  };

  function renderRaceTable(table, results, office) {
    clear(table);
    const sort = state.sort[office];
    const filter = state.filter[office];
    let rows = results.slice();
    if (filter === 'competitive') rows = rows.filter(function (r) { return r.rating.tier !== 'Safe' && r.rating.tier !== 'Likely'; });
    if (filter === 'polled') rows = rows.filter(function (r) { return r.avg && r.avg.rows.some(function (x) { return x.pollster; }); });
    const f = SORTS[sort.key];
    rows.sort(function (a, b) {
      const va = f(a), vb = f(b);
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return cmp * sort.dir || a.race.stateName.localeCompare(b.race.stateName);
    });
    const cols = [
      ['state', 'State'], [null, 'Race'], ['chance', 'Chance of winning'], ['margin', 'Forecast', 'col-margin'],
      ['close', 'Rating', 'col-rating'], ['polls', 'Trusted polls', 'col-polls'], ['latest', 'Latest poll', 'col-latest']
    ];
    const head = h('tr');
    cols.forEach(function (c) {
      if (!c[0]) { append(head, h('th', { scope: 'col', text: c[1] })); return; }
      const active = sort.key === c[0];
      const btn = h('button', {
        type: 'button', class: 'sort-btn',
        'aria-sort': active ? (sort.dir > 0 ? 'ascending' : 'descending') : null,
        onclick: function () {
          state.sort[office] = { key: c[0], dir: active ? -sort.dir : 1 };
          renderRaceTable(table, results, office);
        }
      }, c[1]);
      append(head, h('th', { scope: 'col', class: [c[0] === 'margin' ? 'num' : '', c[2] || ''].join(' ').trim() || null, 'aria-sort': active ? (sort.dir > 0 ? 'ascending' : 'descending') : null }, btn));
    });
    append(table, h('thead', null, head));
    const body = h('tbody');
    rows.forEach(function (r) {
      const race = r.race;
      const c0 = race.candidates[0], c1 = race.candidates[1];
      const incumbent = race.candidates.find(function (c) { return c.inc; });
      const what = (race.special ? 'Special · ' : '') + (race.incumbent === 'running' && incumbent ? 'Incumbent ' + incumbent.last :
        race.incumbent === 'appointed' && incumbent ? 'Appointed incumbent ' + incumbent.last : 'Open seat') +
        ' · ' + (race.holder === 'D' ? 'D-held' : 'R-held');
      const trusted = r.avg ? r.avg.rows.filter(function (x) { return x.pollster; }).length : 0;
      const nEff = r.avg ? r.avg.nEff : 0;
      const bars = h('span', { class: 'bars', 'aria-hidden': 'true' });
      [0.15, 0.6, 1.2, 2.2].forEach(function (t, i) { append(bars, h('i', { class: nEff >= t ? 'on' : null, style: 'height:' + (4 + i * 3) + 'px' })); });
      const tr = h('tr', { onclick: function () { openRace(race.id); } },
        h('td', { class: 'state-cell' }, h('button', { type: 'button', 'aria-label': 'Open ' + raceTitle(race) + ' details', onclick: function (e) { e.stopPropagation(); openRace(race.id); }, text: race.state })),
        h('td', null, h('div', { class: 'race-name' },
          h('span', { class: 'who' }, c0.name + ' (' + c0.party + ')', h('span', { class: 'muted', text: ' vs. ' }), c1.name + ' (R)'),
          h('span', { class: 'what' }, h('span', { class: 'what-rating', text: r.rating.label + ' · ' + fmtMargin(r.final.mean, race) + ' · ' }), what))),
        h('td', null, chanceCell(r)),
        h('td', { class: 'num col-margin', text: fmtMargin(r.final.mean, race) }),
        h('td', { class: 'col-rating' }, h('span', { class: 'pill ' + fillClass(r), text: r.rating.label })),
        h('td', { class: 'col-polls' }, h('span', { class: 'coverage' }, bars, trusted ? String(trusted) : h('span', { class: 'muted', text: 'none' }))),
        h('td', { class: 'col-latest', text: r.avg ? fmtDay(r.avg.latest) : '–' }));
      append(body, tr);
    });
    if (!rows.length) append(body, h('tr', null, h('td', { colspan: cols.length, class: 'muted', text: 'No races match this filter.' })));
    append(table, body);
  }

  function chanceCell(r) {
    const c0 = r.race.candidates[0];
    const p = r.prob;
    return h('div', { class: 'chance', 'aria-label': c0.last + ' ' + fmtProb(p) + ', ' + r.race.candidates[1].last + ' ' + fmtProb(1 - p) },
      h('span', { class: 'lhs', text: fmtProb(p) }),
      h('span', { class: 'chance-track', 'aria-hidden': 'true' },
        p > 0.004 ? h('span', { style: 'flex:' + p.toFixed(4) + ';background:var(--' + (c0.party === 'D' ? 'dem' : 'ind') + ')' }) : null,
        p < 0.996 ? h('span', { style: 'flex:' + (1 - p).toFixed(4) + ';background:var(--rep)' }) : null),
      h('span', { text: fmtProb(1 - p) }));
  }

  // --------------------------------------------------------- trend chart
  function trendChart(root, raceId, fromIso) {
    clear(root);
    const race = M.RACE_BY_ID[raceId];
    const s = state.result.settings;
    const series = M.trend(state.polls, raceId, s, fromIso, 3);
    const rows = M.weighPolls(state.polls, race, s, s.asOf).filter(function (x) { return x.poll.end >= fromIso; });
    if (!series.length && !rows.length) {
      append(root, h('p', { class: 'muted', text: 'No qualifying polls to chart yet.' }));
      return;
    }
    const width = Math.max(300, Math.round(root.getBoundingClientRect().width || 640));
    const height = width < 480 ? 210 : 250;
    const pad = { l: 46, r: 58, t: 14, b: 26 };
    const x0 = M.daysBetween(fromIso, fromIso), x1 = M.daysBetween(fromIso, s.asOf);
    const xs = function (iso) { return pad.l + (width - pad.l - pad.r) * (M.daysBetween(fromIso, iso) - x0) / Math.max(1, x1 - x0); };
    let ext = 6;
    series.forEach(function (p) { ext = Math.max(ext, Math.abs(p.margin)); });
    rows.forEach(function (p) { ext = Math.max(ext, Math.abs(p.adjMargin)); });
    const step = ext > 20 ? 10 : ext > 10 ? 5 : 2;
    ext = Math.ceil((ext + 0.5) / step) * step;
    const ys = function (m) { return pad.t + (height - pad.t - pad.b) * (ext - m) / (2 * ext); };
    const svg = sv('svg', { viewBox: '0 0 ' + width + ' ' + height, width: width, height: height, role: 'img', 'aria-label': 'Polling average over time for ' + raceTitle(race) });
    const c0 = race.candidates[0];
    append(svg, sv('rect', { x: pad.l, y: pad.t, width: width - pad.l - pad.r, height: ys(0) - pad.t, fill: c0.party === 'D' ? 'var(--dem-wash)' : 'var(--surface-2)' }));
    append(svg, sv('rect', { x: pad.l, y: ys(0), width: width - pad.l - pad.r, height: height - pad.b - ys(0), fill: 'var(--rep-wash)' }));
    for (let m = -ext; m <= ext + 1e-9; m += step) {
      append(svg, sv('line', { class: m === 0 ? 'axis-line' : 'grid-line', x1: pad.l, x2: width - pad.r, y1: ys(m), y2: ys(m) }));
      const lab = m === 0 ? 'Even' : (m > 0 ? c0.party : 'R') + '+' + Math.abs(m);
      append(svg, sv('text', { class: 'axis-text', x: pad.l - 6, y: ys(m) + 4, 'text-anchor': 'end', text: lab }));
    }
    const p0 = dparts(fromIso), pe = dparts(s.asOf);
    for (let y = p0.y, mo = p0.m; y < pe.y || (y === pe.y && mo <= pe.m); mo++) {
      if (mo > 12) { mo = 1; y++; }
      const iso = y + '-' + String(mo).padStart(2, '0') + '-01';
      if (iso >= fromIso && iso <= s.asOf) {
        append(svg, sv('line', { class: 'grid-line', x1: xs(iso), x2: xs(iso), y1: pad.t, y2: height - pad.b }));
        append(svg, sv('text', { class: 'axis-text', x: xs(iso), y: height - 8, 'text-anchor': 'middle', text: MONTH_ABBR[mo - 1] }));
      }
    }
    const maxW = rows.reduce(function (a, r) { return Math.max(a, r.weight); }, 0) || 1;
    rows.slice().reverse().forEach(function (r) {
      const rad = 3 + 4 * Math.sqrt(r.weight / maxW);
      append(svg, sv('circle', {
        cx: xs(r.poll.end), cy: ys(r.adjMargin), r: rad,
        fill: r.pollster ? 'var(--ink-2)' : 'none', stroke: r.pollster ? 'var(--surface)' : 'var(--ink-2)', 'stroke-width': r.pollster ? 2 : 1.5,
        opacity: r.pollster ? 0.75 : 0.8
      }));
    });
    if (series.length > 1) {
      const d = series.map(function (p, i) { return (i ? 'L' : 'M') + xs(p.date).toFixed(1) + ',' + ys(p.margin).toFixed(1); }).join('');
      append(svg, sv('path', { d: d, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    }
    if (series.length) {
      const last = series[series.length - 1];
      append(svg, sv('circle', { cx: xs(last.date), cy: ys(last.margin), r: 4.5, fill: 'var(--ink)', stroke: 'var(--surface)', 'stroke-width': 2 }));
      append(svg, sv('text', { class: 'label-strong', x: xs(last.date) + 8, y: ys(last.margin) + 4, text: fmtMargin(last.margin, race) }));
    }
    const cross = sv('line', { x1: 0, x2: 0, y1: pad.t, y2: height - pad.b, stroke: 'var(--ink)', 'stroke-width': 1, opacity: 0 });
    append(svg, cross);
    const overlay = sv('rect', { x: pad.l, y: pad.t, width: width - pad.l - pad.r, height: height - pad.t - pad.b, fill: 'transparent' });
    function nearest(evtX) {
      const rect = svg.getBoundingClientRect();
      const px = (evtX - rect.left) * (width / rect.width);
      let best = null, bd = Infinity;
      series.forEach(function (p) { const d = Math.abs(xs(p.date) - px); if (d < bd) { bd = d; best = p; } });
      return best;
    }
    overlay.addEventListener('pointermove', function (e) {
      const p = nearest(e.clientX);
      if (!p) return;
      cross.setAttribute('x1', xs(p.date)); cross.setAttribute('x2', xs(p.date)); cross.setAttribute('opacity', 0.35);
      const nearPolls = rows.filter(function (r) { return Math.abs(M.daysBetween(r.poll.end, p.date)) <= 1; });
      showTip(e.clientX, e.clientY, [
        h('div', { class: 'tt-value', text: fmtMargin(p.margin, race) }),
        h('div', { text: 'Average on ' + fmtDay(p.date) }),
        nearPolls.map(function (r) { return h('div', { class: 'tt-dim', text: shortPollster(r.poll) + ': ' + fmtMargin(r.adjMargin, race) }); })
      ]);
    });
    overlay.addEventListener('pointerleave', function () { cross.setAttribute('opacity', 0); hideTip(); });
    append(svg, overlay);
    append(root, svg);
    append(root, h('ul', { class: 'legend' },
      h('li', null, h('span', { class: 'tt-key', style: 'background:var(--ink);height:2px;width:14px' }), 'Weighted average'),
      h('li', null, h('span', { class: 'swatch', style: 'background:var(--ink-2);border-radius:50%' }), 'Trusted poll (size = weight)'),
      state.settings.includeOthers ? h('li', null, h('span', { class: 'swatch', style: 'border:1.5px solid var(--ink-2);border-radius:50%' }), 'Other pollster') : null));
  }

  function shortPollster(poll) {
    const p = poll.pollsterId && POLLSTER[poll.pollsterId];
    return p ? p.short : poll.pollster;
  }

  // ---------------------------------------------------------------- house
  function renderHouse() {
    const env = state.result.env;
    const house = M.RACE_BY_ID['HOUSE-US'];
    trendChart($('chart-house'), 'HOUSE-US', '2026-06-01');
    const table = clear($('table-house'));
    append(table, h('thead', null, h('tr', null,
      h('th', { text: 'Pollster' }), h('th', { text: 'Field dates' }), h('th', { text: 'Sample' }),
      h('th', { class: 'num', text: 'Dem' }), h('th', { class: 'num', text: 'Rep' }), h('th', { class: 'num', text: 'Margin' }),
      h('th', { class: 'num', text: 'Weight' }))));
    const body = h('tbody');
    const rows = env.avg ? env.avg.rows : [];
    rows.forEach(function (r) {
      append(body, h('tr', null,
        h('td', null, sourceLink(r.poll)),
        h('td', null, dateCell(r.poll)),
        h('td', { text: sampleText(r.poll) }),
        h('td', { class: 'num', text: String(M.share(r.poll, house.candidates[0])) }),
        h('td', { class: 'num', text: String(M.share(r.poll, house.candidates[1])) }),
        h('td', { class: 'num', text: fmtMargin(r.margin) }),
        h('td', { class: 'num', text: Math.round(r.share * 100) + '%' })));
    });
    if (!rows.length) append(body, h('tr', null, h('td', { colspan: 7, class: 'muted', text: 'No generic-ballot polls in range.' })));
    append(table, body);
    $('house-note').textContent = 'Which party voters prefer for the House: ' + fmtMargin(env.margin) + ' across ' +
      plural(env.avg ? env.avg.count : 0, 'poll') + '. This national margin also sets the baseline for every race on the other tabs.';
  }

  function sampleText(poll) {
    return (poll.n ? poll.n.toLocaleString() + ' ' : '') + (poll.pop || '');
  }
  function dateCell(poll) {
    return poll.approx ? h('span', { title: poll.note || 'Approximate date' }, fmtRange(poll.start, poll.end), h('span', { class: 'approx', text: ' ≈' })) : fmtRange(poll.start, poll.end);
  }
  function sourceLink(poll) {
    const name = poll.pollster;
    const safe = poll.source && /^https?:\/\//.test(poll.source) ? poll.source : null;
    return h('span', null, safe ? h('a', { href: safe, target: '_blank', rel: 'noopener', text: name }) : name,
      poll.partisan ? h('span', { class: 'muted', text: ' (' + poll.partisan + '-affiliated)' }) : null);
  }

  // ------------------------------------------------------------ pollsters
  function renderPollsters() {
    const table = clear($('table-pollsters'));
    const totals = state.result.pollsterTotals;
    const allWeight = Object.keys(totals).reduce(function (a, k) { return a + totals[k].weight; }, 0) || 1;
    append(table, h('thead', null, h('tr', null,
      h('th', { text: 'Pollster' }), h('th', { text: 'Rating' }), h('th', { text: 'Trust weight' }),
      h('th', { text: 'Historical lean' }), h('th', { class: 'num', text: 'Polls in model' }),
      h('th', { class: 'num', text: 'Share of weight' }), h('th', { text: 'Why it is trusted' }))));
    const body = h('tbody');
    C.POLLSTERS.forEach(function (p) {
      const t = totals[p.id];
      const lean = p.bias ? (p.bias < 0 ? 'D+' : 'R+') + Math.abs(p.bias).toFixed(2) : 'n/a';
      append(body, h('tr', null,
        h('td', null, h('div', { class: 'race-name' }, h('span', { class: 'who', text: p.name }), h('span', { class: 'what', text: p.media }))),
        h('td', null, h('div', { class: 'race-name' }, h('span', { class: 'grade', text: p.grade }), h('span', { class: 'what', text: p.standing }))),
        h('td', null, h('div', { class: 'meter' }, h('span', { text: p.weight.toFixed(2) }),
          h('span', { class: 'meter-track' }, h('span', { class: 'meter-fill', style: 'display:block;width:' + (p.weight * 100) + '%' })))),
        h('td', { title: p.biasNote || 'Silver Bulletin mean-reverted bias; subtracted when the correction setting is on.' }, lean),
        h('td', { class: 'num', text: t.polls ? t.polls + ' in ' + plural(t.races, 'race') : '0' }),
        h('td', { class: 'num', text: Math.round(t.weight / allWeight * 100) + '%' }),
        h('td', { class: 'evidence', text: p.evidence })));
    });
    append(table, body);
    const ex = clear($('excluded-list'));
    [
      ['YouGov', 'Very prolific (CBS News, The Economist) but graded B, 77th in the 2025 Silver Bulletin update.'],
      ['SSRS (CNN)', 'Graded C in the 2025 update after weak 2024 results.'],
      ['Gallup', 'Graded B+, but it no longer publishes election horse-race polls.'],
      ['Monmouth University', 'Closed its polling institute in 2025.'],
      ['Selzer & Co.', 'Ann Selzer retired from election polling after 2024.'],
      ['Partisan and lower-rated firms', 'Trafalgar, InsiderAdvantage, Quantus, co/efficient, Rasmussen and campaign-sponsored polls. They enter only when you choose "Add other pollsters", at 30% weight (15% if sponsored by a party or campaign).']
    ].forEach(function (x) { append(ex, h('li', null, h('strong', { text: x[0] + ': ' }), x[1])); });
  }

  // --------------------------------------------------------------- method
  function renderMethod() {
    const root = clear($('method'));
    const s = state.result.settings;
    function p(text) { return h('p', null, text); }
    append(root,
      h('h2', { text: 'How the forecast works' }),
      p('Every number on this page comes from public polls by ten pollsters with the strongest accuracy records, combined with a simple fundamentals baseline and run through ' + s.sims.toLocaleString() + ' simulated elections.'),
      h('h3', { text: '1. Weight every poll' }),
      h('p', { class: 'formula' }, 'poll weight = pollster trust × recency × sample size × voter screen × repeat discount'),
      h('ul', null,
        h('li', null, h('strong', { text: 'Pollster trust ' }), '(0.70 to 1.00) comes from the Silver Bulletin grade: A+ 1.00, A 0.90, A− 0.80, B+ 0.70. Other pollsters get ' + s.otherWeight.toFixed(2) + ' when you include them, half that if a party or campaign paid for the poll.'),
        h('li', null, h('strong', { text: 'Recency ' }), 'halves a poll\'s weight every ' + s.halfLifeDays + ' days after its last field date. Polls older than ' + s.maxAgeDays + ' days are dropped.'),
        h('li', null, h('strong', { text: 'Sample size ' }), 'scales with the square root of respondents, relative to ' + s.refSample + ' and capped at ' + s.maxSample.toLocaleString() + '. When a release gives no sample size, ' + s.defaultSample + ' is assumed.'),
        h('li', null, h('strong', { text: 'Voter screen: ' }), 'likely voters 1.00, registered voters 0.85, all adults 0.70.'),
        h('li', null, h('strong', { text: 'Repeat discount: ' }), 'when a pollster has several polls of one race, each newer one halves the weight of the older ones, so one prolific firm cannot dominate.')),
      h('h3', { text: '2. Correct for historical lean' }),
      p('With the correction on, each poll\'s margin is shifted by the pollster\'s mean-reverted bias from the Silver Bulletin ratings (for example Emerson has leaned 0.65 points toward Democrats, so its margins move 0.65 points toward Republicans). Firms without a published number are left as is. The correction applies only to Democrat-versus-Republican races.'),
      h('h3', { text: '3. Blend with a fundamentals baseline' }),
      p('Each race also gets a baseline that does not depend on its own polls. For incumbents it is their last result plus part of the national swing since then (70% for senators, 50% for governors). For open seats it is the state\'s 2024 presidential margin plus 80% (Senate) or 60% (governor) of the national swing measured by the generic ballot. The poll average and the baseline are combined in proportion to their precision. A race with several fresh trusted polls ends up about 80% polls; a race with none is all baseline.'),
      h('h3', { text: '4. Simulate' }),
      p('Each simulation draws one national polling error shared by every race (standard deviation ' + s.sigmaNational + ' points, fat-tailed) plus an independent error for each race, then counts seats. Republicans keep the Senate with 50 seats because Vice President JD Vance breaks ties. Democrats need 51. Independents such as Dan Osborn are counted separately, so some simulations end with no outright majority.'),
      h('h3', { text: '5. Refresh' }),
      p('"Refresh polls" downloads every race article from Wikipedia through its public API, reads each poll table, keeps tables that list both nominees, prefers likely-voter versions of each poll, and merges new rows into the dataset. Everything then recalculates. Refreshed data is saved in this browser only. The bundled snapshot was compiled by hand on ' + fmtDayYear(SNAP.meta.compiled) + ' from pollster releases and news reports, with a source link on every poll' +
        (SNAP.meta.refreshed ? ', then merged with Wikipedia\'s poll tables on ' + fmtTime(SNAP.meta.refreshed) : '') + '. Rows marked ≈ have release dates standing in for unpublished field dates.'),
      h('h3', { text: 'Limits' }),
      h('ul', null,
        h('li', null, 'Only the ten trusted pollsters count by default, so races they have not polled lean on the baseline. Switch on "Add other pollsters" to see how the picture changes with every public poll.'),
        h('li', null, 'Ranked-choice (Alaska) and three-way races (Montana) are modeled as the top two candidates.'),
        h('li', null, 'Expert ratings shown in race details are context only and do not enter the model.')),
      h('h3', { text: 'Sources' }),
      h('ul', null,
        h('li', null, h('a', { href: 'https://www.natesilver.net/p/pollster-ratings-silver-bulletin', target: '_blank', rel: 'noopener', text: 'Silver Bulletin pollster ratings, January 2026 update' })),
        h('li', null, h('a', { href: 'https://today.marquette.edu/2026/02/marquette-law-school-poll-again-ranked-no-2-in-annual-national-pollster-ratings/', target: '_blank', rel: 'noopener', text: 'Marquette: ranked No. 2; Washington Post No. 1 (Feb 2026)' })),
        h('li', null, h('a', { href: 'https://atlasintel.org/media/atlasintel-has-an-a-rating-and-is-the-no1-pollster-in-america-according-to-the-2025-us-pollster-ratings', target: '_blank', rel: 'noopener', text: 'AtlasIntel: A+ and No. 1 in the 2025 update' })),
        h('li', null, h('a', { href: 'https://mediabiasfactcheck.com/pollster-sources/', target: '_blank', rel: 'noopener', text: 'Media Bias/Fact Check pollster profiles (grades and mean-reverted bias)' })),
        h('li', null, h('a', { href: 'https://en.wikipedia.org/wiki/2026_United_States_Senate_elections', target: '_blank', rel: 'noopener', text: 'Wikipedia: 2026 Senate, governor and House polling articles (live refresh source)' }))));
  }

  // ---------------------------------------------------------- race detail
  function openRace(id) {
    state.openRace = id;
    renderRace(id);
    const dlg = $('race-dialog');
    if (!dlg.open) {
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    }
    hideTip();
  }

  function renderRace(id) {
    const r = state.result.byId[id];
    if (!r) return;
    const race = r.race;
    const c0 = race.candidates[0], c1 = race.candidates[1];
    $('race-eyebrow').textContent = (race.office === 'Senate' ? 'Senate' + (race.special ? ' special election' : '') : 'Governor') +
      ' · ' + (race.holder === 'D' ? 'Democratic-held' : 'Republican-held') + ' · ' + r.rating.label;
    $('race-title').textContent = race.stateName + (race.office === 'Senate' ? ' Senate' : ' governor');
    const body = clear($('race-body'));

    function cand(c, prob, right) {
      const sh = r.avg && r.avg.shares[c.last];
      return h('div', { class: 'cand' + (right ? ' right' : '') },
        h('span', { class: 'prob', text: fmtProb(prob) }),
        h('span', { class: 'name', text: c.name + (c.inc ? ' (incumbent)' : '') }),
        h('span', { class: 'meta', text: partyWord(c.party) + (sh != null ? ' · ' + sh.toFixed(1) + '% in polls' : '') }));
    }
    append(body, h('div', { class: 'matchup' }, cand(c0, r.prob, false), h('span', { class: 'vs', text: 'vs.' }), cand(c1, 1 - r.prob, true)));
    append(body, h('div', { class: 'big-track', role: 'img', 'aria-label': c0.last + ' ' + fmtProb(r.prob) + ', ' + c1.last + ' ' + fmtProb(1 - r.prob) },
      r.prob > 0.004 ? h('span', { style: 'flex:' + r.prob.toFixed(4) + ';background:var(--' + (c0.party === 'D' ? 'dem' : 'ind') + ')' }) : null,
      r.prob < 0.996 ? h('span', { style: 'flex:' + (1 - r.prob).toFixed(4) + ';background:var(--rep)' }) : null));

    const lo = r.final.mean - 1.2816 * r.final.sd, hi = r.final.mean + 1.2816 * r.final.sd;
    const pollPart = r.avg
      ? plural(r.avg.count, 'poll') + ' · ' + Math.round(r.final.pollShare * 100) + '% of the forecast'
      : 'No qualifying polls; forecast uses the baseline only';
    append(body, h('div', { class: 'build' },
      h('div', { class: 'step' }, h('span', { class: 'k', text: state.settings.includeOthers ? 'Poll average (all pollsters)' : 'Poll average (trusted pollsters)' }),
        h('span', { class: 'v', text: r.avg ? fmtMargin(r.avg.margin, race) : '–' }), h('span', { class: 's', text: pollPart })),
      h('div', { class: 'step' }, h('span', { class: 'k', text: 'Fundamentals baseline' }),
        h('span', { class: 'v', text: fmtMargin(r.prior.mean, race) }), h('span', { class: 's', text: r.prior.detail })),
      h('div', { class: 'step' }, h('span', { class: 'k', text: 'Forecast margin' }),
        h('span', { class: 'v', text: fmtMargin(r.final.mean, race) }), h('span', { class: 's', text: '80% range ' + fmtMargin(lo, race) + ' to ' + fmtMargin(hi, race) }))));

    const chartBox = h('div', { class: 'chart' });
    append(body, h('h3', { class: 'sub-head', text: 'Polling average since August (margin, ' + c0.last + ' minus ' + c1.last + ')' }), chartBox);

    const table = h('table', { class: 'data-table' });
    append(table, h('thead', null, h('tr', null,
      h('th', { text: 'Pollster' }), h('th', { text: 'Field dates' }), h('th', { text: 'Sample' }),
      h('th', { class: 'num', text: c0.last + '–' + c1.last }), h('th', { class: 'num', text: 'Margin' }),
      h('th', { text: 'Weight factors' }), h('th', { class: 'num', text: 'Share' }))));
    const tb = h('tbody');
    (r.avg ? r.avg.rows : []).forEach(function (row) {
      const f = row.f;
      const res = M.share(row.poll, c0) + '–' + M.share(row.poll, c1);
      append(tb, h('tr', null,
        h('td', null, sourceLink(row.poll)),
        h('td', null, dateCell(row.poll)),
        h('td', { text: sampleText(row.poll) }),
        h('td', { class: 'num', text: res }),
        h('td', { class: 'num', title: row.bias ? 'Raw ' + fmtMargin(row.margin, race) + ', corrected for historical lean' : null, text: fmtMargin(row.adjMargin, race) }),
        h('td', { class: 'weights', text: 'trust ' + f.trust.toFixed(2) + ' × recency ' + f.recency.toFixed(2) + ' × size ' + f.size.toFixed(2) + ' × screen ' + f.pop.toFixed(2) + (f.repeat < 1 ? ' × repeat ' + f.repeat.toFixed(2) : '') }),
        h('td', { class: 'num', text: Math.round(row.share * 100) + '%' })));
    });
    if (!r.avg) append(tb, h('tr', null, h('td', { colspan: 7, class: 'muted', text: 'None of the trusted pollsters has polled this race in the last ' + state.result.settings.maxAgeDays + ' days.' })));
    append(table, tb);
    append(body, h('h3', { class: 'sub-head', text: 'Polls in the average' }), h('div', { class: 'table-scroll' }, table));

    if (!state.settings.includeOthers) {
      const others = state.polls.filter(function (p) { return p.race === race.id && !p.pollsterId && M.pollMargin(p, race) != null; })
        .sort(function (a, b) { return a.end < b.end ? 1 : -1; });
      if (others.length) {
        const list = h('ul', { class: 'race-notes' });
        others.slice(0, 12).forEach(function (p) {
          append(list, h('li', null, sourceLink(p), ' · ' + fmtRange(p.start, p.end) + ' · ' + fmtMargin(M.pollMargin(p, race), race)));
        });
        append(body, h('details', { class: 'table-toggle' }, h('summary', { text: plural(others.length, 'poll') + ' from other pollsters, not used (turn on "Add other pollsters" to include them)' }), list));
      }
    }

    const notes = h('ul', { class: 'race-notes' });
    if (race.note) append(notes, h('li', { text: race.note }));
    if (race.expert) append(notes, h('li', { text: 'Expert rating for context: ' + race.expert + '.' }));
    append(notes, h('li', null, 'Poll tables: ', h('a', { href: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(race.wiki[0].replace(/ /g, '_')), target: '_blank', rel: 'noopener', text: race.wiki[0] })));
    append(body, notes);
    requestAnimationFrame(function () { trendChart(chartBox, race.id, '2026-08-01'); });
  }

  // -------------------------------------------------------------- tooltip
  let tipTimer = null;
  function showTip(x, y, nodes) {
    const tip = $('tooltip');
    clear(tip);
    append(tip, nodes);
    tip.hidden = false;
    const w = tip.offsetWidth, hgt = tip.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = x + 14, top = y + 14;
    if (left + w > vw - 8) left = Math.max(8, x - w - 14);
    if (top + hgt > vh - 8) top = Math.max(8, y - hgt - 14);
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  function hideTip() { clearTimeout(tipTimer); $('tooltip').hidden = true; }
  function tipOn(node, content) {
    node.addEventListener('pointermove', function (e) { if (e.pointerType !== 'touch') showTip(e.clientX, e.clientY, content()); });
    node.addEventListener('pointerleave', hideTip);
    node.addEventListener('focus', function () { const b = node.getBoundingClientRect(); showTip(b.left + b.width / 2, b.bottom, content()); });
    node.addEventListener('blur', hideTip);
  }

  // -------------------------------------------------------------- refresh
  function probsById() {
    const out = {};
    state.result.races.forEach(function (r) { out[r.race.id] = r.prob; });
    return out;
  }

  async function refresh() {
    if (state.refreshing) return;
    state.refreshing = true;
    const btn = $('refresh-btn'), label = $('refresh-label');
    btn.setAttribute('aria-busy', 'true');
    $('main').classList.add('is-refreshing');
    const before = probsById();
    const artifact = hostedEnv().hosted === 'artifact'; // a claude.ai Artifact may not call other sites
    let res = null, error = null;
    try {
      if (!artifact) {
        res = await W.fetchAll({
          concurrency: 6,
          onProgress: function (done, total) { label.textContent = 'Reading ' + done + ' of ' + total + ' pages'; }
        });
      }
    } catch (e) { error = e; }
    const ok = res ? res.pages.filter(function (p) { return p.ok; }) : [];
    if (ok.length) {
      const merged = W.mergePolls(state.polls, res.polls);
      state.polls = merged.polls;
      state.data = { origin: 'wikipedia', compiled: SNAP.meta.compiled, fetchedAt: res.fetchedAt, pagesOk: ok.length, pagesTotal: res.pages.length };
      writeStore(STORE_KEY, { origin: 'wikipedia', fetchedAt: res.fetchedAt, pagesOk: ok.length, pagesTotal: res.pages.length, polls: state.polls });
      recompute();
      showChanges(merged, res, before);
    } else {
      label.textContent = 'Loading the published data file';
      const fallback = await loadPublishedData();
      if (fallback) {
        const refreshed = fallback.meta && fallback.meta.refreshed;
        // A file older than the data already loaded may add polls but never rolls rows back.
        const older = !!(refreshed && state.data.fetchedAt && refreshed < state.data.fetchedAt);
        const merged = W.mergePolls(state.polls, fallback.polls, { addOnly: older });
        state.polls = merged.polls;
        if (!older) state.data = { origin: 'repository', compiled: SNAP.meta.compiled, fetchedAt: refreshed || new Date().toISOString() };
        writeStore(STORE_KEY, Object.assign({}, state.data, { polls: state.polls }));
        recompute();
        showBanner(false, 'This page can\'t call Wikipedia directly, so it loaded the published data file (' +
          (refreshed ? 'last refreshed from Wikipedia ' + fmtTime(refreshed) + (older ? ', older than the data already here' : '') : 'the hand-compiled snapshot; the repository\'s "Update polls" action has not run yet') + '): ' +
          plural(merged.added.length, 'new poll') + ', ' + plural(merged.updated.length, 'updated row') + '.' +
          (artifact ? ' For a live pull, open the dashboard from its GitHub Pages site or a local copy.' : ''), null);
      } else if (artifact) {
        showBanner(true, 'This copy of the dashboard can\'t call Wikipedia and has no published data file to load. Open it from the repository\'s GitHub Pages site or a local copy for live refreshes.', null);
      } else {
        showBanner(true, 'Could not reach Wikipedia' + (error ? ' (' + error.message + ')' : '') + '. Check your connection, or open the dashboard from the repository\'s GitHub Pages site or a local copy, where the browser can call the Wikipedia API directly. The forecast still shows the last data loaded.', null);
      }
    }
    btn.removeAttribute('aria-busy');
    label.textContent = 'Refresh polls';
    $('main').classList.remove('is-refreshing');
    state.refreshing = false;
  }

  async function loadPublishedData() {
    if (location.protocol === 'file:') return null;
    try {
      const resp = await fetch('data/polls.json', { cache: 'no-store' });
      if (!resp.ok) return null;
      const json = await resp.json();
      return json && Array.isArray(json.polls) ? json : null;
    } catch (e) { return null; }
  }

  function hostedEnv() { return window.DASHBOARD_ENV || {}; }

  function showChanges(merged, res, before) {
    const after = probsById();
    const trustedNew = merged.added.filter(function (p) { return p.pollsterId; });
    const otherNew = merged.added.length - trustedNew.length;
    const failed = res.pages.filter(function (p) { return !p.ok; });
    const moves = Object.keys(after).map(function (id) { return { id: id, d: after[id] - before[id] }; })
      .filter(function (m) { return Math.abs(m.d) >= 0.02; })
      .sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); }).slice(0, 6);
    const nodes = [];
    nodes.push(h('h2', { text: 'Refreshed from Wikipedia at ' + fmtTime(res.fetchedAt) + ': read ' + (res.pages.length - failed.length) + ' of ' + res.pages.length + ' pages' }));
    nodes.push(h('p', { text: plural(trustedNew.length, 'new poll') + ' from trusted pollsters, ' + plural(merged.updated.length, 'updated row') + ', ' + plural(otherNew, 'poll') + ' from other pollsters (used only when you add other pollsters).' }));
    if (trustedNew.length) {
      const ul = h('ul');
      trustedNew.slice(0, 8).forEach(function (p) {
        const race = M.RACE_BY_ID[p.race];
        append(ul, h('li', { text: shortPollster(p) + ' · ' + raceTitle(race) + ' · ' + fmtRange(p.start, p.end) + ' · ' + fmtMargin(M.pollMargin(p, race), race) }));
      });
      if (trustedNew.length > 8) append(ul, h('li', { text: 'and ' + (trustedNew.length - 8) + ' more' }));
      nodes.push(ul);
    }
    if (moves.length) {
      nodes.push(h('p', { text: 'Biggest moves: ' + moves.map(function (m) {
        const r = state.result.byId[m.id];
        return raceTitle(r.race) + ' ' + r.race.candidates[0].last + ' ' + fmtProb(before[m.id]) + ' → ' + fmtProb(after[m.id]);
      }).join('; ') + '.' }));
    } else {
      nodes.push(h('p', { text: 'No race moved by two points or more.' }));
    }
    if (failed.length) nodes.push(h('p', { class: 'muted', text: 'Could not read: ' + failed.map(function (f) { return f.title + ' (' + f.error + ')'; }).slice(0, 5).join('; ') + (failed.length > 5 ? '; and ' + (failed.length - 5) + ' more' : '') + '.' }));
    showBanner(false, null, nodes);
  }

  function showBanner(isError, text, nodes) {
    const b = clear($('change-banner'));
    b.classList.toggle('is-error', !!isError);
    if (text) append(b, h('p', { text: text }));
    if (nodes) append(b, nodes);
    append(b, h('div', { class: 'banner-actions' }, h('button', { type: 'button', class: 'btn-link', onclick: function () { b.hidden = true; }, text: 'Dismiss' })));
    b.hidden = false;
  }

  // ------------------------------------------------------------- controls
  function savePrefs() { writeStore(PREF_KEY, state.settings); }

  function wireControls() {
    $('refresh-btn').addEventListener('click', refresh);
    const trusted = $('opt-trusted'), all = $('opt-all');
    function syncSeg() {
      trusted.setAttribute('aria-checked', String(!state.settings.includeOthers));
      all.setAttribute('aria-checked', String(state.settings.includeOthers));
      trusted.tabIndex = state.settings.includeOthers ? -1 : 0;
      all.tabIndex = state.settings.includeOthers ? 0 : -1;
    }
    function setOthers(v) { state.settings.includeOthers = v; syncSeg(); savePrefs(); recompute(); }
    trusted.addEventListener('click', function () { setOthers(false); });
    all.addEventListener('click', function () { setOthers(true); });
    [trusted, all].forEach(function (b) {
      b.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); setOthers(!state.settings.includeOthers); (state.settings.includeOthers ? all : trusted).focus(); }
      });
    });
    syncSeg();
    const hl = $('opt-halflife');
    hl.value = String(state.settings.halfLifeDays);
    hl.addEventListener('change', function () { state.settings.halfLifeDays = parseInt(hl.value, 10); savePrefs(); recompute(); });
    const bias = $('opt-bias');
    bias.checked = state.settings.applyBias;
    bias.addEventListener('change', function () { state.settings.applyBias = bias.checked; savePrefs(); recompute(); });
    ['Senate', 'Governor'].forEach(function (office) {
      const key = office === 'Senate' ? 'senate' : 'governor';
      const sel = $('filter-' + key);
      sel.addEventListener('change', function () { state.filter[office] = sel.value; renderRaceTable($('table-' + key), officeResults(office), office); });
    });
    $('race-close').addEventListener('click', function () { $('race-dialog').close(); });
    $('race-dialog').addEventListener('click', function (e) { if (e.target === $('race-dialog')) $('race-dialog').close(); });
    $('race-dialog').addEventListener('close', function () { state.openRace = null; });
  }

  const TABS = ['senate', 'governor', 'house', 'pollsters', 'method'];
  function selectTab(name, focus) {
    if (TABS.indexOf(name) === -1) name = 'senate';
    state.tab = name;
    TABS.forEach(function (t) {
      const tab = $('tab-' + t), panel = $('panel-' + t);
      const on = t === name;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
    });
    if (focus) $('tab-' + name).focus();
    try { if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name); } catch (e) { /* sandboxed */ }
    // Charts measure their container, so draw the newly visible ones now.
    requestAnimationFrame(function () {
      if (name === 'senate') renderHistogram('senate', 'Senate');
      if (name === 'governor') renderHistogram('governor', 'Governor');
      if (name === 'house') renderHouse();
    });
  }
  function wireTabs() {
    TABS.forEach(function (t, i) {
      const tab = $('tab-' + t);
      tab.addEventListener('click', function () { selectTab(t); });
      tab.addEventListener('keydown', function (e) {
        let j = null;
        if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
        if (e.key === 'ArrowLeft') j = (i - 1 + TABS.length) % TABS.length;
        if (e.key === 'Home') j = 0;
        if (e.key === 'End') j = TABS.length - 1;
        if (j != null) { e.preventDefault(); selectTab(TABS[j], true); }
      });
    });
  }

  let resizeTimer = null;
  function wireResize() {
    let lastW = window.innerWidth;
    window.addEventListener('resize', function () {
      if (Math.abs(window.innerWidth - lastW) < 24) return;
      lastW = window.innerWidth;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        renderHistogram('senate', 'Senate');
        renderHistogram('governor', 'Governor');
        if (state.tab === 'house') renderHouse();
        if (state.openRace && $('race-dialog').open) renderRace(state.openRace);
      }, 150);
    });
  }

  // ----------------------------------------------------------------- boot
  function start() {
    loadSaved();
    wireControls();
    wireTabs();
    wireResize();
    recompute();
    const hash = (location.hash || '').slice(1);
    selectTab(TABS.indexOf(hash) !== -1 ? hash : 'senate');
  }

  window.MidtermDashboard = { state: state, refresh: refresh, openRace: openRace, recompute: recompute };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
