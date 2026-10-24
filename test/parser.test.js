'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CONFIG = require('../js/config.js');
const MODEL = require('../js/model.js');
const WIKI = require('../js/wikipedia.js');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const race = (id) => MODEL.RACE_BY_ID[id];

test('parseDateRange handles the formats Wikipedia uses', () => {
  assert.deepEqual(WIKI.parseDateRange('October 15–19, 2026', 2026), { start: '2026-10-15', end: '2026-10-19' });
  assert.deepEqual(WIKI.parseDateRange('Sep 30 – Oct 2, 2026', 2026), { start: '2026-09-30', end: '2026-10-02' });
  assert.deepEqual(WIKI.parseDateRange('October 5, 2026', 2026), { start: '2026-10-05', end: '2026-10-05' });
  assert.deepEqual(WIKI.parseDateRange('Oct. 1–4', 2026), { start: '2026-10-01', end: '2026-10-04' });
  assert.deepEqual(WIKI.parseDateRange('Dec 28, 2025 – Jan 6, 2026', 2026), { start: '2025-12-28', end: '2026-01-06' });
  assert.deepEqual(WIKI.parseDateRange('December 28 – January 3, 2026', 2026), { start: '2025-12-28', end: '2026-01-03' });
  assert.deepEqual(WIKI.parseDateRange('Dec 28, 2025 – Jan 3', 2026), { start: '2025-12-28', end: '2026-01-03' });
  assert.deepEqual(WIKI.parseDateRange('Dec 28 – Jan 3', 2026), { start: '2025-12-28', end: '2026-01-03' });
  // A garbled range never yields a start after its end.
  const odd = WIKI.parseDateRange('October 30 – 2, 2026', 2026);
  assert.ok(odd.start <= odd.end, JSON.stringify(odd));
  assert.equal(WIKI.parseDateRange('Ken Paxton wins the runoff', 2026), null);
});

test('parseSample and parsePct read sample sizes and percentages', () => {
  assert.deepEqual(WIKI.parseSample('1,398 (LV)'), { n: 1398, pop: 'LV' });
  assert.deepEqual(WIKI.parseSample('– (RV)'), { n: null, pop: 'RV' });
  assert.deepEqual(WIKI.parseSample('800 (A)'), { n: 800, pop: 'A' });
  assert.equal(WIKI.parsePct('48.8%'), 48.8);
  assert.equal(WIKI.parsePct('<1%'), 0.5);
  assert.equal(WIKI.parsePct('–'), null);
});

test('cellText strips footnotes, tags and entities', () => {
  const html = 'Fox News<sup id="cite_ref-9" class="reference"><a href="#cite_note-9">[9]</a></sup> &amp; Co<br />Poll';
  assert.equal(WIKI.cellText(html), 'Fox News & Co Poll');
});

test('pollsForRace reads only the general-election table for the nominees', () => {
  const polls = WIKI.pollsForRace(race('SEN-TX'), fixture('senate-texas.html'), '2026 United States Senate election in Texas');
  const names = polls.map((p) => p.pollster);
  assert.equal(polls.length, 6, names.join(' | '));
  // Primary, aggregate and hypothetical tables are ignored.
  assert.ok(!names.some((n) => /RealClearPolitics/.test(n)));
  assert.ok(polls.every((p) => p.results.Talarico != null && p.results.Paxton != null));
  assert.ok(polls.every((p) => p.results.Cornyn == null));
});

test('pollsForRace prefers the likely-voter version of a multi-row poll', () => {
  const polls = WIKI.pollsForRace(race('SEN-TX'), fixture('senate-texas.html'), 'x');
  const marist = polls.filter((p) => p.pollsterId === 'marist');
  assert.equal(marist.length, 1);
  assert.equal(marist[0].pop, 'LV');
  assert.equal(marist[0].n, 1010);
  assert.deepEqual(marist[0].results, { Talarico: 47, Paxton: 45 });
  assert.equal(marist[0].start, '2026-10-08');
  assert.equal(marist[0].end, '2026-10-11');
});

test('pollsForRace maps trusted pollsters, partisan sponsors and source links', () => {
  const polls = WIKI.pollsForRace(race('SEN-TX'), fixture('senate-texas.html'), 'x');
  const by = (re) => polls.find((p) => re.test(p.pollster));
  assert.equal(by(/AtlasIntel/).pollsterId, 'atlasintel');
  assert.equal(by(/Fox News/).pollsterId, 'fox');
  assert.equal(by(/Emerson/).pollsterId, 'emerson');
  assert.equal(by(/Siena/).pollsterId, 'nyt-siena');
  assert.equal(by(/Siena/).n, null);
  const cygnal = by(/Cygnal/);
  assert.equal(cygnal.pollsterId, null);
  assert.equal(cygnal.partisan, 'R');
  assert.equal(by(/Fox News/).source, 'https://example.org/fox');
  assert.equal(by(/Fox News/).origin, 'wikipedia');
});

test('generic-ballot tables map Democratic and Republican columns', () => {
  const polls = WIKI.pollsForRace(race('HOUSE-US'), fixture('generic-ballot.html'), 'x');
  assert.equal(polls.length, 3);
  const nyt = polls.find((p) => p.pollsterId === 'nyt-siena');
  assert.deepEqual(nyt.results, { Democratic: 52, Republican: 41 });
  assert.equal(nyt.n, 3494);
  const reuters = polls.find((p) => /Reuters/.test(p.pollster));
  assert.equal(reuters.pollsterId, null, 'Reuters/Ipsos is not the Washington Post');
  const marq = polls.find((p) => p.pollsterId === 'marquette');
  assert.equal(marq.start, '2025-12-28');
  assert.equal(marq.pop, 'A');
});

test('parseTables survives nested tables and unclosed cells', () => {
  const html = '<table><tr><th>Poll source<th>Date<tr><td>Emerson<td>Oct 1, 2026</table>' +
    '<table><tr><td><table><tr><td>inner</td></tr></table></td></tr></table>';
  const tables = WIKI.parseTables(html);
  assert.equal(tables.length, 3);
  const grid = WIKI.toGrid(tables[0]);
  assert.equal(grid[1][0].text, 'Emerson');
  assert.equal(grid[1][1].text, 'Oct 1, 2026');
});

test('mergePolls replaces matching rows and adds new ones', () => {
  const base = [
    { race: 'SEN-TX', pollster: 'Fox News', pollsterId: 'fox', start: '2026-10-15', end: '2026-10-19', n: 1398, pop: 'LV', results: { Talarico: 49, Paxton: 49 }, source: 'a' },
    { race: 'SEN-ME', pollster: 'Fox News', pollsterId: 'fox', start: '2026-10-21', end: '2026-10-21', n: null, pop: 'LV', approx: true, results: { Jackson: 49, Collins: 49 }, source: 'b' }
  ];
  const incoming = [
    { race: 'SEN-TX', pollster: 'Fox News', pollsterId: 'fox', start: '2026-10-15', end: '2026-10-19', n: 1398, pop: 'LV', results: { Talarico: 49, Paxton: 49 }, source: 'w' },
    { race: 'SEN-ME', pollster: 'Fox News', pollsterId: 'fox', start: '2026-10-13', end: '2026-10-16', n: 1012, pop: 'LV', results: { Jackson: 49, Collins: 49 }, source: 'w2' },
    { race: 'SEN-TX', pollster: 'AtlasIntel', pollsterId: 'atlasintel', start: '2026-10-20', end: '2026-10-23', n: 1612, pop: 'LV', results: { Talarico: 49, Paxton: 48 }, source: 'w3' }
  ];
  const out = WIKI.mergePolls(base, incoming);
  assert.equal(out.polls.length, 3);
  assert.equal(out.added.length, 1);
  assert.equal(out.added[0].pollsterId, 'atlasintel');
  // The approximate Maine row is replaced by the dated Wikipedia row.
  const me = out.polls.find((p) => p.race === 'SEN-ME');
  assert.equal(me.end, '2026-10-16');
  assert.equal(me.n, 1012);
  assert.equal(out.updated.length, 1);
});

test('mergePolls never lets an older data file overwrite a live Wikipedia row', () => {
  const live = { race: 'SEN-TX', pollster: 'Marist University', pollsterId: 'marist', start: '2026-10-08', end: '2026-10-11', n: 1010, pop: 'LV', results: { Talarico: 47, Paxton: 45 }, source: 'w', origin: 'wikipedia' };
  const stale = Object.assign({}, live, { n: null, origin: undefined, source: 's' });
  const out = WIKI.mergePolls([live], [stale]);
  assert.equal(out.polls.length, 1);
  assert.equal(out.polls[0].n, 1010);
  assert.equal(out.updated.length, 0);
  // Extra third-party columns alone do not count as an update.
  const withThird = Object.assign({}, live, { results: { Talarico: 47, Paxton: 45, Brown: 1 } });
  assert.equal(WIKI.mergePolls([withThird], [live]).updated.length, 0);
});

test('Fox News polls credited to Beacon/Shaw are trusted and not partisan', () => {
  const html = '<table><tr><th>Poll source</th><th>Date(s) administered</th><th>Sample size</th><th>Margin of error</th><th>Sherrod Brown (D)</th><th>Jon Husted (R)</th></tr>' +
    '<tr><td>Beacon Research (D)/ Shaw &amp; Co. Research (R)</td><td>October 15–19, 2026</td><td>1,001 (LV)</td><td>± 3.0%</td><td>52%</td><td>47%</td></tr>' +
    '<tr><td>Cygnal (R)/Beacon Research (D)</td><td>September 18–21, 2026</td><td>600 (LV)</td><td>± 4.0%</td><td>45%</td><td>40%</td></tr>' +
    '<tr><td>Beacon Research (D)</td><td>October 1–6, 2026</td><td>800 (LV)</td><td>± 3.5%</td><td>50%</td><td>44%</td></tr></table>';
  const polls = WIKI.pollsForRace(race('SEN-OH'), html, 'x');
  const fox = polls.find((p) => /Shaw/.test(p.pollster));
  assert.equal(fox.pollsterId, 'fox');
  assert.equal(fox.partisan, null);
  const pair = polls.find((p) => /Cygnal/.test(p.pollster));
  assert.equal(pair.pollsterId, null, 'Cygnal/Beacon is not a Fox News poll');
  assert.equal(pair.partisan, null);
  const beacon = polls.find((p) => p.pollster === 'Beacon Research (D)');
  assert.equal(beacon.pollsterId, null);
  assert.equal(beacon.partisan, 'D');
});

test('primary-style tables with many candidates are skipped', () => {
  const head = ['Xavier Becerra', 'Steve Hilton', 'Katie Porter', 'Chad Bianco', 'Antonio Villaraigosa', 'Tom Steyer'];
  const html = '<table><tr><th>Poll source</th><th>Date(s) administered</th><th>Sample size</th>' + head.map((n) => '<th>' + n + '</th>').join('') + '</tr>' +
    '<tr><td>Emerson College</td><td>May 27–28, 2026</td><td>1,000 (LV)</td><td>28%</td><td>23%</td><td>12%</td><td>10%</td><td>5%</td><td>4%</td></tr></table>' +
    '<table><tr><th>Poll source</th><th>Date(s) administered</th><th>Sample size</th><th>Xavier Becerra (D)</th><th>Steve Hilton (R)</th></tr>' +
    '<tr><td>Emerson College</td><td>October 17–19, 2026</td><td>1,000 (LV)</td><td>60%</td><td>33%</td></tr></table>';
  const polls = WIKI.pollsForRace(race('GOV-CA'), html, 'x');
  assert.equal(polls.length, 1);
  assert.deepEqual(polls[0].results, { Becerra: 60, Hilton: 33 });
});

test('head-to-head-only races ignore first-round ranked-choice tables', () => {
  const html = '<table><tr><th>Poll source</th><th>Date(s) administered</th><th>Jonathan Kreiss-Tomkins (D)</th><th>Bernadette Wilson (R)</th><th>Dave Bronson (R)</th><th>Candi English (R)</th></tr>' +
    '<tr><td>New York Times / Siena University</td><td>September 24 – October 1, 2026</td><td>40%</td><td>20%</td><td>15%</td><td>10%</td></tr></table>' +
    '<table><tr><th>Poll source</th><th>Date(s) administered</th><th>Jonathan Kreiss-Tomkins (D)</th><th>Bernadette Wilson (R)</th></tr>' +
    '<tr><td>New York Times / Siena University</td><td>September 24 – October 1, 2026</td><td>47%</td><td>48%</td></tr></table>';
  const polls = WIKI.pollsForRace(race('GOV-AK'), html, 'x');
  assert.equal(polls.length, 1);
  assert.deepEqual(polls[0].results, { 'Kreiss-Tomkins': 47, Wilson: 48 });
});

test('mergePolls keeps two distinct polls by one firm a few days apart', () => {
  const a = { race: 'SEN-SC', pollster: 'Impact Research (D)', pollsterId: null, start: '2026-10-01', end: '2026-10-03', n: 600, pop: 'LV', results: { Andrews: 41, Graham: 41 }, source: 'w', origin: 'wikipedia' };
  const b = Object.assign({}, a, { start: '2026-10-04', end: '2026-10-05', results: { Andrews: 42, Graham: 39 } });
  const out = WIKI.mergePolls([], [a, b]);
  assert.equal(out.polls.length, 2);
  // An approximate snapshot row pairs with the closest live poll, not the first one seen.
  const approx = { race: 'SEN-TX', pollster: 'NYT/Siena', pollsterId: 'nyt-siena', start: '2026-09-21', end: '2026-10-01', n: 589, pop: 'LV', approx: true, results: { Talarico: 51, Paxton: 45 }, source: 's' };
  const recon = { race: 'SEN-TX', pollster: 'ReconMR/ Siena University', pollsterId: 'nyt-siena', start: '2026-10-05', end: '2026-10-08', n: 900, pop: 'LV', results: { Talarico: 48, Paxton: 44 }, source: 'w', origin: 'wikipedia' };
  const nyt = { race: 'SEN-TX', pollster: 'New York Times / Siena University', pollsterId: 'nyt-siena', start: '2026-09-21', end: '2026-09-30', n: null, pop: 'LV', results: { Talarico: 51, Paxton: 45 }, source: 'w2', origin: 'wikipedia' };
  const merged = WIKI.mergePolls([approx], [recon, nyt]);
  assert.equal(merged.polls.length, 2);
  assert.equal(merged.added.length, 1);
  assert.equal(merged.added[0].pollster, 'ReconMR/ Siena University');
  assert.equal(merged.updated.length, 1, 'the NYT row replaces the approximate snapshot row');
  assert.equal(merged.polls[0].end, '2026-09-30');
  assert.equal(merged.polls[0].n, null, 'an estimated sample is not carried over');
});

test('fetchAll works with an injected fetch and reports failed pages', async () => {
  const tx = fixture('senate-texas.html');
  const fakeFetch = async (url) => {
    const title = decodeURIComponent(new URL(url).searchParams.get('page'));
    if (title === '2026 United States Senate election in Texas') {
      return { ok: true, json: async () => ({ parse: { title, revid: 1, text: tx } }) };
    }
    return { ok: true, json: async () => ({ error: { code: 'missingtitle', info: "The page you specified doesn't exist." } }) };
  };
  const races = [race('SEN-TX'), race('SEN-ME')];
  const progress = [];
  const res = await WIKI.fetchAll({ fetch: fakeFetch, races, concurrency: 2, onProgress: (d, t) => progress.push(d + '/' + t) });
  assert.equal(res.pages.length, 2);
  assert.equal(res.pages.find((p) => p.race === 'SEN-TX').ok, true);
  assert.equal(res.pages.find((p) => p.race === 'SEN-ME').ok, false);
  assert.equal(res.polls.length, 6);
  assert.deepEqual(progress.sort(), ['1/2', '2/2']);
});

test('apiUrl requests CORS-enabled parse output', () => {
  const url = new URL(WIKI.apiUrl('2026 Georgia gubernatorial election'));
  assert.equal(url.origin + url.pathname, CONFIG.WIKI_API);
  assert.equal(url.searchParams.get('origin'), '*');
  assert.equal(url.searchParams.get('action'), 'parse');
  assert.equal(url.searchParams.get('page'), '2026 Georgia gubernatorial election');
});
