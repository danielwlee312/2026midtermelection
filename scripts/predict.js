#!/usr/bin/env node
/*
 * Print the forecast for every race to the terminal.
 *
 *   node scripts/predict.js                 trusted pollsters only
 *   node scripts/predict.js --all           include other pollsters at reduced weight
 *   node scripts/predict.js --as-of 2026-10-24 --json
 */
'use strict';
const MODEL = require('../js/model.js');
const DATA = require('../data/polls.js');

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const settings = { includeOthers: argv.includes('--all'), sims: 20000 };
if (opt('--as-of')) settings.asOf = opt('--as-of');

const out = MODEL.run(DATA.polls, settings);
const pct = (p) => (p > 0.99 ? '>99' : p < 0.01 ? '<1' : String(Math.round(p * 100))) + '%';

if (argv.includes('--json')) {
  console.log(JSON.stringify({
    asOf: out.asOf,
    nationalEnvironment: out.env.margin,
    senate: { probDemControl: out.senate.probD, probRepControl: out.senate.probR, probNoMajority: out.senate.probNeither, meanDemSeats: out.senate.seatsD.mean, meanRepSeats: out.senate.seatsR.mean },
    governors: { probDemMajority: out.governors.probDMajority, meanDemGovernors: out.governors.seatsD.mean },
    races: out.races.map((r) => ({
      id: r.race.id, state: r.race.state, office: r.race.office,
      candidates: r.race.candidates.slice(0, 2).map((c) => c.name + ' (' + c.party + ')'),
      pollAverage: r.avg ? r.avg.margin : null, polls: r.avg ? r.avg.count : 0,
      prior: r.prior.mean, forecastMargin: r.final.mean, sd: r.final.sd,
      probFirstCandidate: r.prob, rating: r.rating.label
    }))
  }, null, 2));
  process.exit(0);
}

console.log(`2026 midterm forecast as of ${out.asOf} (${settings.includeOthers ? 'all pollsters' : 'trusted pollsters only'})`);
console.log(`National environment (generic ballot): ${MODEL.fmtMargin(out.env.margin)}`);
console.log(`Senate: Democratic control ${pct(out.senate.probD)}, Republican control ${pct(out.senate.probR)}, no outright majority ${pct(out.senate.probNeither)}`);
console.log(`        average seats D ${out.senate.seatsD.mean.toFixed(1)}, R ${out.senate.seatsR.mean.toFixed(1)}`);
console.log(`Governors: Democratic majority ${pct(out.governors.probDMajority)}, average D ${out.governors.seatsD.mean.toFixed(1)}`);
['Senate', 'Governor'].forEach((office) => {
  console.log('\n' + office);
  console.log('  ' + 'State'.padEnd(6) + 'Matchup'.padEnd(34) + 'Polls'.padStart(6) + 'Poll avg'.padStart(10) + 'Baseline'.padStart(10) + 'Forecast'.padStart(10) + 'Chance'.padStart(18) + '  Rating');
  out.races.filter((r) => r.race.office === office)
    .sort((a, b) => Math.abs(a.prob - 0.5) - Math.abs(b.prob - 0.5))
    .forEach((r) => {
      const c = r.race.candidates;
      const lead = r.prob >= 0.5 ? c[0] : c[1];
      console.log('  ' + r.race.state.padEnd(6) + (c[0].last + ' (' + c[0].party + ') v ' + c[1].last + ' (R)').padEnd(34) +
        String(r.avg ? r.avg.count : 0).padStart(6) + (r.avg ? MODEL.fmtMargin(r.avg.margin, r.race) : '-').padStart(10) +
        MODEL.fmtMargin(r.prior.mean, r.race).padStart(10) + MODEL.fmtMargin(r.final.mean, r.race).padStart(10) +
        (lead.last + ' ' + pct(Math.max(r.prob, 1 - r.prob))).padStart(18) + '  ' + r.rating.label);
    });
});
