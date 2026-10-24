'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const CONFIG = require('../js/config.js');
const MODEL = require('../js/model.js');

const TX = MODEL.RACE_BY_ID['SEN-TX'];
const base = { race: 'SEN-TX', pollster: 'Emerson College', pollsterId: 'emerson', start: '2026-10-20', end: '2026-10-24', n: 800, pop: 'LV', results: { Talarico: 50, Paxton: 46 } };
const settings = (extra) => MODEL.mergeSettings(Object.assign({ asOf: '2026-10-24', sims: 4000 }, extra));

test('there are exactly ten trusted pollsters with weights in (0, 1]', () => {
  assert.equal(CONFIG.POLLSTERS.length, 10);
  const ids = new Set(CONFIG.POLLSTERS.map((p) => p.id));
  assert.equal(ids.size, 10);
  CONFIG.POLLSTERS.forEach((p) => {
    assert.ok(p.weight > 0 && p.weight <= 1, p.id);
    assert.ok(p.aliases.length > 0, p.id);
  });
});

test('race list covers 35 Senate and 36 governor contests', () => {
  const sen = CONFIG.RACES.filter((r) => r.office === 'Senate');
  const gov = CONFIG.RACES.filter((r) => r.office === 'Governor');
  assert.equal(sen.length, 35);
  assert.equal(gov.length, 36);
  const senR = sen.filter((r) => r.holder === 'R').length;
  assert.equal(senR, 22);
  assert.equal(CONFIG.SENATE_HOLDOVERS.D + CONFIG.SENATE_HOLDOVERS.R + sen.length, 100);
  assert.equal(CONFIG.GOVERNORS_NOT_UP.D + CONFIG.GOVERNORS_NOT_UP.R + gov.length, 50);
  CONFIG.RACES.forEach((r) => {
    assert.equal(r.candidates[1].party, 'R', r.id + ' second candidate must be the Republican');
    assert.notEqual(r.candidates[0].party, 'R', r.id);
    if (r.state !== 'US') assert.ok(CONFIG.TILE_GRID[r.state], r.id + ' needs a map tile');
  });
});

test('recency halves weight every half-life', () => {
  const s = settings();
  const fresh = MODEL.weighPolls([base], TX, s)[0];
  const old = MODEL.weighPolls([Object.assign({}, base, { end: '2026-10-03' })], TX, s)[0];
  assert.ok(Math.abs(fresh.f.recency - 1) < 1e-9);
  assert.ok(Math.abs(old.f.recency - 0.5) < 1e-9, String(old.f.recency));
});

test('weights reflect trust, sample size, voter screen and repeats', () => {
  const s = settings();
  const rows = MODEL.weighPolls([
    base,
    Object.assign({}, base, { pollster: 'Quinnipiac', pollsterId: 'quinnipiac' }),
    Object.assign({}, base, { pollsterId: 'nyt-siena', pollster: 'NYT/Siena', n: 3200 }),
    Object.assign({}, base, { pollsterId: 'marist', pollster: 'Marist', pop: 'RV' }),
    Object.assign({}, base, { end: '2026-10-10', start: '2026-10-08' })
  ], TX, s);
  const emersonNew = rows.find((r) => r.pollster.id === 'emerson' && r.poll.end === '2026-10-24');
  const emersonOld = rows.find((r) => r.pollster.id === 'emerson' && r.poll.end === '2026-10-10');
  const quin = rows.find((r) => r.pollster.id === 'quinnipiac');
  const nyt = rows.find((r) => r.pollster.id === 'nyt-siena');
  const marist = rows.find((r) => r.pollster.id === 'marist');
  assert.ok(emersonNew.weight > quin.weight, 'A- outweighs B+');
  assert.equal(nyt.f.size, Math.sqrt(3000 / 800), 'sample size is capped');
  assert.equal(marist.f.pop, 0.85);
  assert.equal(emersonOld.f.repeat, 0.5, 'older poll from the same pollster is discounted');
  assert.equal(emersonNew.f.repeat, 1);
});

test('other pollsters are excluded unless requested, then down-weighted', () => {
  const other = Object.assign({}, base, { pollster: 'Trafalgar Group', pollsterId: null });
  const sponsored = Object.assign({}, other, { pollster: 'Cygnal', partisan: 'R' });
  assert.equal(MODEL.weighPolls([other], TX, settings()).length, 0);
  const rows = MODEL.weighPolls([other, sponsored], TX, settings({ includeOthers: true }));
  const t = rows.find((r) => r.poll.pollster === 'Trafalgar Group');
  const c = rows.find((r) => r.poll.pollster === 'Cygnal');
  assert.equal(t.f.trust, 0.3);
  assert.equal(c.f.trust, 0.15);
});

test('bias correction moves Democratic-leaning pollsters toward Republicans', () => {
  const on = MODEL.weighPolls([base], TX, settings())[0];
  const off = MODEL.weighPolls([base], TX, settings({ applyBias: false }))[0];
  assert.equal(off.adjMargin, 4);
  assert.ok(Math.abs(on.adjMargin - (4 - 0.65)) < 1e-9);
  // No correction for independent-vs-Republican races.
  const ne = MODEL.RACE_BY_ID['SEN-NE'];
  const nePoll = { race: 'SEN-NE', pollster: 'Emerson', pollsterId: 'emerson', start: '2026-10-20', end: '2026-10-22', n: 800, pop: 'LV', results: { Osborn: 48, Ricketts: 47 } };
  assert.equal(MODEL.weighPolls([nePoll], ne, settings())[0].adjMargin, 1);
});

test('polls after the as-of date and stale polls are ignored', () => {
  const s = settings({ asOf: '2026-10-01' });
  assert.equal(MODEL.weighPolls([base], TX, s).length, 0);
  const ancient = Object.assign({}, base, { start: '2025-08-18', end: '2025-08-19' });
  assert.equal(MODEL.weighPolls([ancient], TX, settings()).length, 0);
});

test('prior uses the incumbent result plus part of the national swing', () => {
  const s = settings();
  const me = MODEL.prior(MODEL.RACE_BY_ID['SEN-ME'], 10, s);
  assert.equal(me.basis, 'incumbent');
  assert.ok(Math.abs(me.mean - (-8.6 + 0.7 * (10 - 3.1))) < 1e-9);
  const tx = MODEL.prior(TX, 10, s);
  assert.equal(tx.basis, 'lean');
  assert.ok(Math.abs(tx.mean - (-13.7 + 0.8 * (10 + 1.5))) < 1e-9);
  const vt = MODEL.prior(MODEL.RACE_BY_ID['GOV-VT'], 10, s);
  assert.ok(vt.mean < -35, 'Phil Scott stays a heavy favorite');
});

test('combine leans on polls as they accumulate', () => {
  const s = settings();
  const pr = { mean: -4, sd: 10 };
  const few = MODEL.combine({ margin: 2, nEff: 0.3 }, pr, s);
  const many = MODEL.combine({ margin: 2, nEff: 6 }, pr, s);
  assert.ok(many.pollShare > few.pollShare);
  assert.ok(many.mean > few.mean);
  assert.ok(many.sd < few.sd);
  const none = MODEL.combine(null, pr, s);
  assert.equal(none.mean, -4);
  assert.equal(none.pollShare, 0);
});

test('rating thresholds', () => {
  const r = MODEL.RACE_BY_ID['SEN-GA'];
  assert.equal(MODEL.rating(0.5, r).label, 'Toss-up');
  assert.equal(MODEL.rating(0.7, r).label, 'Lean D');
  assert.equal(MODEL.rating(0.9, r).label, 'Likely D');
  assert.equal(MODEL.rating(0.97, r).label, 'Safe D');
  assert.equal(MODEL.rating(0.03, r).label, 'Safe R');
  assert.equal(MODEL.rating(0.7, MODEL.RACE_BY_ID['SEN-NE']).label, 'Lean I');
});

test('run is deterministic for a fixed seed and internally consistent', () => {
  const polls = require('../data/polls.js').polls;
  const a = MODEL.run(polls, { asOf: '2026-10-24', sims: 3000 });
  const b = MODEL.run(polls, { asOf: '2026-10-24', sims: 3000 });
  assert.equal(a.senate.probR, b.senate.probR);
  const sum = a.senate.probR + a.senate.probD + a.senate.probNeither;
  assert.ok(Math.abs(sum - 1) < 1e-9);
  const histTotal = a.senate.seatsR.hist.reduce((x, y) => x + y, 0);
  assert.ok(Math.abs(histTotal - 1) < 1e-9);
  assert.equal(a.races.length, 71);
  a.races.forEach((r) => {
    assert.ok(r.prob >= 0 && r.prob <= 1, r.race.id);
    assert.ok(isFinite(r.final.mean) && r.final.sd > 0, r.race.id);
  });
  // Safe seats behave like safe seats.
  assert.ok(a.byId['SEN-WV'].prob < 0.02);
  assert.ok(a.byId['SEN-MA'].prob > 0.98);
});

test('a stronger poll lead raises the win probability', () => {
  const lead = (m) => MODEL.run([Object.assign({}, base, { results: { Talarico: 50 + m / 2, Paxton: 50 - m / 2 } })], { asOf: '2026-10-24', sims: 3000 }).byId['SEN-TX'].prob;
  assert.ok(lead(8) > lead(2));
  assert.ok(lead(2) > lead(-4));
});

test('trend returns a dated series ending on the as-of date', () => {
  const polls = require('../data/polls.js').polls;
  const series = MODEL.trend(polls, 'SEN-TX', { asOf: '2026-10-24' }, '2026-09-01', 7);
  assert.ok(series.length > 3);
  assert.equal(series[series.length - 1].date, '2026-10-24');
  assert.ok(series.every((p, i) => i === 0 || p.date > series[i - 1].date));
});

test('fmtMargin labels sides', () => {
  assert.equal(MODEL.fmtMargin(2.34), 'D+2.3');
  assert.equal(MODEL.fmtMargin(-0.04), 'even');
  assert.equal(MODEL.fmtMargin(-7), 'R+7.0');
});
