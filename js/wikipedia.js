/*
 * Live data source: Wikipedia poll tables.
 *
 * Every 2026 race article on English Wikipedia carries a "Polling" table
 * (Poll source | Date(s) administered | Sample size | Margin of error |
 * candidates...). This module fetches those articles through the
 * MediaWiki API, which allows cross-origin requests with origin=*, parses
 * the tables without needing a DOM, and turns each row into a poll record
 * in the same shape as data/polls.js.
 *
 * Works in the browser (window.WikiSource) and in Node 18+ (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config.js'), require('./model.js'));
  else root.WikiSource = factory(root.ElectionConfig, root.ElectionModel);
})(typeof self !== 'undefined' ? self : this, function (CONFIG, MODEL) {
  'use strict';

  const normName = MODEL.normName;

  // ------------------------------------------------------------ HTML text
  const ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '\u2013', mdash: '\u2014',
    minus: '\u2212', plusmn: '\u00b1', thinsp: ' ', ensp: ' ', emsp: ' ', hellip: '\u2026',
    lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', middot: '\u00b7', times: '\u00d7'
  };
  function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, function (m, e) {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
      }
      const v = ENTITIES[e.toLowerCase()];
      return v != null ? v : m;
    });
  }

  /** Remove citation markers, hidden sort keys and inline styles' text. */
  function stripNoise(html) {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<sup\b[^>]*class="[^"]*\breference\b[^"]*"[^>]*>[\s\S]*?<\/sup>/gi, '')
      .replace(/<span\b[^>]*display:\s*none[^>]*>[\s\S]*?<\/span>/gi, '')
      .replace(/<span\b[^>]*class="[^"]*\bsortkey\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '');
  }

  function cellText(html) {
    return decodeEntities(stripNoise(html)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
  }

  function firstExternalLink(html) {
    const m = /<a\b[^>]*href="(https?:\/\/[^"]+)"/i.exec(stripNoise(html));
    return m ? decodeEntities(m[1]) : null;
  }

  // ---------------------------------------------------------- table parse
  /**
   * Tokenize every <table> into rows of raw cells. Handles nested tables,
   * implicit </td>/</tr> closes and stray markup without a DOM.
   */
  function parseTables(html) {
    const tables = [];
    const stack = [];
    const re = /<(\/?)(table|tr|td|th)\b([^>]*)>/gi;
    let m;
    function closeCell(t, end) {
      if (!t.cell) return;
      if (!t.row) t.row = { cells: [] };
      t.row.cells.push({ tag: t.cell.tag, attrs: t.cell.attrs, html: html.slice(t.cell.start, end) });
      t.cell = null;
    }
    function closeRow(t) {
      if (t.row && t.row.cells.length) t.rows.push(t.row);
      t.row = null;
    }
    while ((m = re.exec(html))) {
      const closing = m[1] === '/';
      const tag = m[2].toLowerCase();
      const t = stack[stack.length - 1];
      if (tag === 'table') {
        if (!closing) {
          stack.push({ attrs: m[3], rows: [], row: null, cell: null, start: m.index });
        } else if (t) {
          closeCell(t, m.index); closeRow(t);
          stack.pop();
          tables.push({ attrs: t.attrs, rows: t.rows, start: t.start });
        }
        continue;
      }
      if (!t) continue;
      if (tag === 'tr') {
        closeCell(t, m.index);
        closeRow(t);
        if (!closing) t.row = { cells: [] };
      } else if (!closing) {
        closeCell(t, m.index);
        t.cell = { tag: tag, attrs: m[3], start: re.lastIndex };
      } else {
        closeCell(t, m.index);
      }
    }
    while (stack.length) {
      const t = stack.pop();
      closeCell(t, html.length); closeRow(t);
      tables.push({ attrs: t.attrs, rows: t.rows, start: t.start });
    }
    tables.sort(function (a, b) { return a.start - b.start; });
    return tables;
  }

  function spanAttr(attrs, name) {
    const m = new RegExp(name + '\\s*=\\s*["\']?(\\d+)', 'i').exec(attrs || '');
    const v = m ? parseInt(m[1], 10) : 1;
    return v > 0 && v < 200 ? v : 1;
  }

  /** Expand rowspan/colspan into a rectangular grid of cell references. */
  function toGrid(table) {
    const grid = [];
    const pending = [];
    table.rows.forEach(function (row) {
      const out = [];
      let col = 0, ci = 0;
      function pendingFrom(c) {
        for (let k = c; k < pending.length; k++) if (pending[k] && pending[k].left > 0) return true;
        return false;
      }
      while (ci < row.cells.length || pendingFrom(col)) {
        const p = pending[col];
        if (p && p.left > 0) { out[col] = p.cell; p.left--; col++; continue; }
        if (ci >= row.cells.length) { col++; continue; }
        const cell = row.cells[ci++];
        if (cell.text == null) cell.text = cellText(cell.html);
        const rs = spanAttr(cell.attrs, 'rowspan'), cs = spanAttr(cell.attrs, 'colspan');
        for (let k = 0; k < cs; k++) {
          out[col + k] = cell;
          pending[col + k] = rs > 1 ? { cell: cell, left: rs - 1 } : null;
        }
        col += cs;
      }
      grid.push(out);
    });
    return grid;
  }

  // -------------------------------------------------------- field parsers
  const MONTHS = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
    jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
  };
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /**
   * "October 15–19, 2026", "Sep 28 – Oct 5, 2026", "October 5, 2026",
   * "Oct. 1–4" -> { start, end } ISO dates. defaultYear fills a missing year.
   */
  function parseDateRange(text, defaultYear) {
    const t = String(text || '').replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\./g, ' ').replace(/,/g, ' ')
      .replace(/\s+/g, ' ').trim().toLowerCase();
    if (!t) return null;
    const parts = t.split(/\s*-\s*/);
    function piece(s) {
      const out = {};
      s.split(' ').forEach(function (w) {
        if (MONTHS[w]) out.month = MONTHS[w];
        else if (/^\d{4}$/.test(w)) out.year = +w;
        else if (/^\d{1,2}$/.test(w)) out.day = +w;
      });
      return out;
    }
    const a = piece(parts[0]);
    const b = parts.length > 1 ? piece(parts[parts.length - 1]) : {};
    const end = { month: b.month || a.month, day: b.day != null ? b.day : a.day };
    const start = { month: a.month || end.month, day: a.day != null ? a.day : end.day };
    if (!end.month || !end.day || !start.month || !start.day) return null;
    const wraps = start.month > end.month; // e.g. December 28 - January 3
    if (b.year) {
      end.year = b.year;
      start.year = a.year || (wraps ? b.year - 1 : b.year);
    } else if (a.year) {
      start.year = a.year;
      end.year = wraps ? a.year + 1 : a.year;
    } else {
      end.year = defaultYear;
      start.year = wraps ? defaultYear - 1 : defaultYear;
    }
    const iso = function (d) { return d.year + '-' + pad(d.month) + '-' + pad(d.day); };
    const s = iso(start), e = iso(end);
    return { start: s <= e ? s : e, end: e };
  }

  /** "1,398 (LV)" -> { n: 1398, pop: 'LV' }. */
  function parseSample(text) {
    const t = String(text || '');
    const num = /(\d[\d,]*)/.exec(t);
    const pop = /\b(LV|RV|A|V)\b/i.exec(t);
    let code = pop ? pop[1].toUpperCase() : null;
    if (code === 'V') code = 'RV';
    const n = num ? parseInt(num[1].replace(/,/g, ''), 10) : null;
    return { n: n && n >= 50 ? n : null, pop: code };
  }

  /** "49%", "48.8%", "<1%" -> number or null. */
  function parsePct(text) {
    const t = String(text || '').trim();
    if (/^<\s*1/.test(t)) return 0.5;
    const m = /(\d+(?:\.\d+)?)\s*%?/.exec(t);
    if (!m) return null;
    const v = parseFloat(m[1]);
    return v >= 0 && v <= 100 ? v : null;
  }

  const NON_CANDIDATE = /\b(other|others|undecided|unsure|lead|margin|refused|someone else|would not vote|none|don.?t know|no opinion|n\/a)\b/i;
  // General-election tables list two to five candidates; more means a primary.
  const MAX_CANDIDATES = 5;

  /** Party tag in a pollster cell, unless the poll is a bipartisan pairing. */
  function partisanTag(text) {
    const d = /\(D\)/.test(text), r = /\(R\)/.test(text);
    return d && !r ? 'D' : r && !d ? 'R' : null;
  }

  /**
   * Find every poll table in an article and return its header roles and
   * data rows. Aggregate tables ("Source of poll aggregation") are skipped.
   */
  function extractPollTables(html, defaultYear) {
    const out = [];
    parseTables(html).forEach(function (table) {
      const grid = toGrid(table);
      let h = -1, pollCol = -1;
      for (let r = 0; r < Math.min(grid.length, 4) && h < 0; r++) {
        for (let c = 0; c < grid[r].length; c++) {
          const cell = grid[r][c];
          if (cell && cell.tag === 'th' && /^(poll(ing)?\s*(source|firm|organization)|pollster)\b/i.test(cell.text)) {
            h = r; pollCol = c; break;
          }
        }
      }
      if (h < 0) return;
      const head = grid[h];
      let dateCol = -1, sampleCol = -1, moeCol = -1;
      head.forEach(function (cell, c) {
        if (!cell) return;
        if (dateCol < 0 && /date/i.test(cell.text)) dateCol = c;
        else if (sampleCol < 0 && /sample/i.test(cell.text)) sampleCol = c;
        else if (moeCol < 0 && /margin\s*of\s*error|\bmoe\b/i.test(cell.text)) moeCol = c;
      });
      if (dateCol < 0) return;
      const firstCand = Math.max(pollCol, dateCol, sampleCol, moeCol) + 1;
      const candidates = [];
      for (let c = firstCand; c < head.length; c++) {
        const cell = head[c];
        if (!cell || cell === head[c - 1] || !cell.text || NON_CANDIDATE.test(cell.text)) continue;
        const party = /\((D|R|I|L|G|DFL|Ind\.?|Lib\.?|Grn\.?|Rep\.?|Dem\.?)\)/i.exec(cell.text);
        candidates.push({ col: c, header: cell.text, norm: ' ' + normName(cell.text) + ' ', party: party ? party[1].toUpperCase().replace('.', '') : null });
      }
      if (!candidates.length || candidates.length > MAX_CANDIDATES) return;
      const rows = [];
      for (let r = h + 1; r < grid.length; r++) {
        const row = grid[r];
        const pc = row[pollCol];
        if (!pc || pc.tag === 'th' || !pc.text) continue;
        const dc = row[dateCol];
        const dates = dc ? parseDateRange(dc.text, defaultYear) : null;
        if (!dates) continue;
        const sample = sampleCol >= 0 && row[sampleCol] ? parseSample(row[sampleCol].text) : { n: null, pop: null };
        const values = candidates.map(function (cand) {
          const cell = row[cand.col];
          return cell && cell !== pc && cell !== dc ? parsePct(cell.text) : null;
        });
        rows.push({
          pollster: pc.text.replace(/\s*\[[^\]]*\]\s*/g, ' ').trim(),
          partisan: partisanTag(pc.text),
          link: firstExternalLink(pc.html),
          start: dates.start, end: dates.end, n: sample.n, pop: sample.pop, values: values
        });
      }
      if (rows.length) out.push({ candidates: candidates, rows: rows });
    });
    return out;
  }

  // ------------------------------------------------------- race matching
  function candidateKeys(cand) {
    return (cand.match || [cand.last]).map(function (k) { return ' ' + normName(k) + ' '; });
  }

  function columnFor(table, cand) {
    const keys = candidateKeys(cand);
    for (let i = 0; i < table.candidates.length; i++) {
      for (let j = 0; j < keys.length; j++) {
        if (table.candidates[i].norm.indexOf(keys[j]) !== -1) return i;
      }
    }
    return -1;
  }

  const POP_RANK = { LV: 0, RV: 1, A: 2 };

  /**
   * Turn an article's poll tables into poll records for one race. Only
   * tables that contain both main candidates are used, so primary and
   * hypothetical-matchup tables drop out. When a poll has several versions
   * (LV/RV, with or without leaners) the likely-voter version wins.
   */
  function pollsForRace(race, html, pageTitle) {
    const year = parseInt(CONFIG.ELECTION_DATE.slice(0, 4), 10);
    const tables = extractPollTables(html, year);
    const best = {};
    const order = [];
    tables.forEach(function (table) {
      const cols = race.candidates.map(function (cand) { return columnFor(table, cand); });
      if (cols[0] < 0 || cols[1] < 0) return;
      if (race.headToHeadOnly && table.candidates.length !== 2) return;
      table.rows.forEach(function (row) {
        const results = {};
        race.candidates.forEach(function (cand, i) {
          if (cols[i] >= 0 && row.values[cols[i]] != null) results[cand.last] = row.values[cols[i]];
        });
        if (results[race.candidates[0].last] == null || results[race.candidates[1].last] == null) return;
        const pollster = MODEL.matchPollster(row.pollster);
        const poll = {
          race: race.id,
          pollster: row.pollster,
          pollsterId: pollster ? pollster.id : null,
          start: row.start, end: row.end, n: row.n, pop: row.pop || 'RV',
          results: results,
          partisan: row.partisan,
          source: row.link || ('https://en.wikipedia.org/wiki/' + encodeURIComponent(pageTitle.replace(/ /g, '_'))),
          origin: 'wikipedia'
        };
        const key = (poll.pollsterId || normName(poll.pollster).slice(0, 40)) + '|' + poll.end;
        const prev = best[key];
        if (!prev) { best[key] = poll; order.push(key); return; }
        const rank = function (p) { return POP_RANK[p.pop] != null ? POP_RANK[p.pop] : 3; };
        if (rank(poll) < rank(prev)) best[key] = poll;
      });
    });
    return order.map(function (k) { return best[k]; });
  }

  // ------------------------------------------------------------- fetching
  function apiUrl(title) {
    return CONFIG.WIKI_API + '?action=parse&format=json&formatversion=2&prop=text%7Crevid&redirects=1' +
      '&disableeditsection=1&disablelimitreport=1&disabletoc=1&origin=*&page=' + encodeURIComponent(title);
  }

  async function fetchArticle(title, fetchImpl, headers) {
    const res = await fetchImpl(apiUrl(title), headers ? { headers: headers } : undefined);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (json.error) throw new Error(json.error.info || json.error.code || 'API error');
    return { title: json.parse.title, html: json.parse.text, revid: json.parse.revid };
  }

  async function fetchRace(race, fetchImpl, headers) {
    let lastErr = null;
    for (let i = 0; i < race.wiki.length; i++) {
      try {
        const page = await fetchArticle(race.wiki[i], fetchImpl, headers);
        const polls = pollsForRace(race, page.html, page.title);
        return { race: race.id, title: page.title, revid: page.revid, ok: true, polls: polls };
      } catch (err) {
        lastErr = err;
      }
    }
    return { race: race.id, title: race.wiki[0], ok: false, error: String(lastErr && lastErr.message || lastErr), polls: [] };
  }

  /**
   * Fetch every race article with limited concurrency.
   * options: { fetch, races, concurrency, headers, onProgress(done, total, result) }
   */
  async function fetchAll(options) {
    const opts = options || {};
    const fetchImpl = opts.fetch || (typeof fetch === 'function' ? fetch.bind(typeof self !== 'undefined' ? self : globalThis) : null);
    if (!fetchImpl) throw new Error('No fetch implementation available');
    const races = opts.races || CONFIG.RACES;
    const results = new Array(races.length);
    let next = 0, done = 0;
    async function worker() {
      while (next < races.length) {
        const i = next++;
        results[i] = await fetchRace(races[i], fetchImpl, opts.headers);
        done++;
        if (opts.onProgress) opts.onProgress(done, races.length, results[i]);
      }
    }
    const n = Math.min(opts.concurrency || 6, races.length);
    const workers = [];
    for (let i = 0; i < n; i++) workers.push(worker());
    await Promise.all(workers);
    const polls = [];
    results.forEach(function (r) { polls.push.apply(polls, r.polls); });
    return { fetchedAt: new Date().toISOString(), pages: results, polls: polls };
  }

  // -------------------------------------------------------------- merging
  function sourceKey(p) {
    return p.race + '|' + (p.pollsterId || normName(p.pollster).slice(0, 24));
  }

  /** Field-date gap in days if a and b can be the same poll, else -1. */
  function matchGap(a, b) {
    const gap = Math.abs(MODEL.daysBetween(a.end, b.end));
    return gap <= 3 || ((a.approx || b.approx) && gap <= 12) ? gap : -1;
  }

  /** True when two rows for the same poll report different numbers. */
  function differs(prev, poll) {
    const race = MODEL.RACE_BY_ID[poll.race];
    const cands = race ? race.candidates : [];
    for (let i = 0; i < cands.length; i++) {
      const a = MODEL.share(prev, cands[i]), b = MODEL.share(poll, cands[i]);
      if (a != null && b != null && Math.abs(a - b) > 1e-9) return true;
      if (i < 2 && (a == null) !== (b == null)) return true;
    }
    return prev.end !== poll.end || (prev.n != null && poll.n != null && prev.n !== poll.n) || prev.pop !== poll.pop;
  }

  /**
   * Merge polls into an existing list. A matching existing row (same race,
   * pollster and field dates) is replaced unless it came from Wikipedia and
   * the incoming row did not, so a stale data file never overwrites a
   * fresher live read. Anything unmatched is added. Returns the merged list
   * plus what changed.
   */
  function mergePolls(existing, incoming) {
    const merged = existing.slice();
    const added = [], updated = [];
    // Pair each incoming poll with at most one existing row, closest field dates first,
    // so two distinct polls by one firm a few days apart never collapse into one.
    const byKey = {};
    existing.forEach(function (p, i) { (byKey[sourceKey(p)] = byKey[sourceKey(p)] || []).push(i); });
    const pairs = [];
    incoming.forEach(function (poll, j) {
      (byKey[sourceKey(poll)] || []).forEach(function (i) {
        const gap = matchGap(existing[i], poll);
        if (gap >= 0) pairs.push({ i: i, j: j, gap: gap });
      });
    });
    pairs.sort(function (a, b) { return a.gap - b.gap; });
    const matchOf = new Array(incoming.length).fill(-1);
    const taken = {};
    pairs.forEach(function (pr) {
      if (matchOf[pr.j] < 0 && !taken[pr.i]) { matchOf[pr.j] = pr.i; taken[pr.i] = true; }
    });
    incoming.forEach(function (poll, j) {
      const i = matchOf[j];
      if (i < 0) { merged.push(poll); added.push(poll); return; }
      const prev = existing[i];
      if (prev.origin === 'wikipedia' && poll.origin !== 'wikipedia') return;
      const changed = differs(prev, poll);
      merged[i] = Object.assign({}, poll, {
        note: poll.note || (changed ? undefined : prev.note),
        n: poll.n != null ? poll.n : (prev.approx ? null : prev.n)
      });
      if (!merged[i].note) delete merged[i].note;
      if (changed) updated.push({ before: prev, after: merged[i] });
    });
    return { polls: merged, added: added, updated: updated };
  }

  return {
    apiUrl: apiUrl,
    parseTables: parseTables,
    toGrid: toGrid,
    cellText: cellText,
    parseDateRange: parseDateRange,
    parseSample: parseSample,
    parsePct: parsePct,
    extractPollTables: extractPollTables,
    pollsForRace: pollsForRace,
    fetchArticle: fetchArticle,
    fetchRace: fetchRace,
    fetchAll: fetchAll,
    mergePolls: mergePolls
  };
});
