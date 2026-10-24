'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const CONFIG = require('../js/config.js');
const MODEL = require('../js/model.js');
const DATA = require('../data/polls.js');

const ISO = /^\d{4}-\d{2}-\d{2}$/;

test('every snapshot poll is well formed', () => {
  assert.ok(Array.isArray(DATA.polls) && DATA.polls.length > 50);
  DATA.polls.forEach((p, i) => {
    const where = '#' + i + ' ' + p.race + ' ' + p.pollster;
    const race = MODEL.RACE_BY_ID[p.race];
    assert.ok(race, where + ': unknown race');
    assert.match(p.start, ISO, where);
    assert.match(p.end, ISO, where);
    assert.ok(p.start <= p.end, where + ': start after end');
    assert.ok(p.end <= CONFIG.ELECTION_DATE, where);
    assert.ok(['LV', 'RV', 'A'].includes(p.pop), where + ': population');
    assert.ok(p.n == null || (Number.isInteger(p.n) && p.n > 50), where + ': sample');
    assert.ok(MODEL.pollMargin(p, race) != null, where + ': missing a main candidate');
    assert.match(p.source, /^https?:\/\//, where + ': source');
    if (p.pollsterId) assert.ok(MODEL.POLLSTER_BY_ID[p.pollsterId], where + ': pollsterId');
  });
});

test('pollster names resolve to the same trusted pollster the row claims', () => {
  DATA.polls.forEach((p) => {
    const matched = MODEL.matchPollster(p.pollster);
    assert.equal(matched ? matched.id : null, p.pollsterId || null, p.pollster);
  });
});

test('no duplicate polls in the snapshot', () => {
  const seen = new Set();
  DATA.polls.forEach((p) => {
    const key = [p.race, p.pollsterId || p.pollster, p.start, p.end].join('|');
    assert.ok(!seen.has(key), 'duplicate ' + key);
    seen.add(key);
  });
});

test('all ten trusted pollsters are defined and most have polls', () => {
  const used = new Set(DATA.polls.map((p) => p.pollsterId).filter(Boolean));
  assert.ok(used.size >= 8, 'only ' + used.size + ' pollsters represented');
});
