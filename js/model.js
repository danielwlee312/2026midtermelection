/*
 * Forecast model.
 *
 *   poll weight = pollster trust x recency x sample size x population x repeat
 *   poll average = weighted mean of (optionally bias-adjusted) margins
 *   forecast    = precision-weighted blend of the poll average and a
 *                 fundamentals prior, then a correlated Monte Carlo
 *                 (shared national error + state error, Student-t tails)
 *
 * Margins are always candidates[0] minus candidates[1] (non-Republican
 * minus Republican), in percentage points.
 *
 * Loads as a classic script (window.ElectionModel, needs ElectionConfig
 * first) or as a CommonJS module.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config.js'));
  else root.ElectionModel = factory(root.ElectionConfig);
})(typeof self !== 'undefined' ? self : this, function (CONFIG) {
  'use strict';

  const DAY_MS = 86400000;

  const DEFAULTS = {
    asOf: null,               // ISO date; defaults to today, never past election day
    halfLifeDays: 21,         // a poll loses half its weight every 21 days
    maxAgeDays: 240,          // older polls are ignored
    refSample: 800,           // sample size that earns a size factor of 1.0
    maxSample: 3000,          // cap so one huge sample cannot dominate
    defaultSample: 600,       // assumed when a release gives no sample size
    popWeight: { LV: 1.0, RV: 0.85, A: 0.7 },
    repeatDecay: 0.5,         // each newer poll by the same pollster halves an older one
    includeOthers: false,     // false = trusted ten only
    otherWeight: 0.3,         // trust weight for any other pollster
    partisanFactor: 0.5,      // extra discount for party- or campaign-sponsored polls
    applyBias: true,          // subtract each pollster's historical mean-reverted bias
    sigmaSystematic: 4.0,     // polling-average error that more polls cannot remove
    sigmaPerPoll: 5.0,        // error that shrinks with the effective number of polls
    priorSigma: { incumbent: 9, open: 10, independent: 12, governorExtra: 1 },
    incumbencyBonus: 3.0,     // points for an elected incumbent with no comparable last race
    appointedBonus: 1.5,      // points for an appointed incumbent
    // Share of the national swing (generic ballot vs. the baseline year) a race
    // absorbs. Governor races are less nationalized than Senate races.
    swing: { senateIncumbent: 0.7, senateOpen: 0.8, governorIncumbent: 0.5, governorOpen: 0.6 },
    sigmaLate: 1.5,           // movement still possible before election day
    sigmaNational: 3.0,       // polling error shared by every race
    independentCorrelation: 0.5,
    tDof: 6,
    sims: 20000,
    seed: 20261103,
    envFallback: 8.0          // national environment if no generic-ballot polls exist
  };

  // ------------------------------------------------------------------ utils
  function toDate(iso) {
    const p = String(iso).slice(0, 10).split('-').map(Number);
    return Date.UTC(p[0], p[1] - 1, p[2]);
  }
  function isoDay(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function daysBetween(aIso, bIso) { return Math.round((toDate(bIso) - toDate(aIso)) / DAY_MS); }

  function normName(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function mergeSettings(user) {
    const s = Object.assign({}, DEFAULTS, user || {});
    s.popWeight = Object.assign({}, DEFAULTS.popWeight, user && user.popWeight);
    s.priorSigma = Object.assign({}, DEFAULTS.priorSigma, user && user.priorSigma);
    s.swing = Object.assign({}, DEFAULTS.swing, user && user.swing);
    if (!s.asOf) {
      const today = isoDay(Date.now());
      s.asOf = today < CONFIG.ELECTION_DATE ? today : CONFIG.ELECTION_DATE;
    }
    return s;
  }

  const POLLSTER_BY_ID = {};
  CONFIG.POLLSTERS.forEach(function (p) { POLLSTER_BY_ID[p.id] = p; });
  const RACE_BY_ID = {};
  CONFIG.RACES.forEach(function (r) { RACE_BY_ID[r.id] = r; });

  /** Match free-text pollster names (e.g. a Wikipedia "Poll source" cell). */
  function matchPollster(text) {
    const t = ' ' + String(text || '').toLowerCase().replace(/\s+/g, ' ') + ' ';
    for (let i = 0; i < CONFIG.POLLSTERS.length; i++) {
      const p = CONFIG.POLLSTERS[i];
      for (let j = 0; j < p.aliases.length; j++) {
        if (t.indexOf(p.aliases[j]) !== -1) return p;
      }
    }
    return null;
  }

  /** Percent for a candidate, matching result keys by normalized last name. */
  function share(poll, cand) {
    const want = normName(cand.last);
    const keys = Object.keys(poll.results || {});
    for (let i = 0; i < keys.length; i++) {
      if (normName(keys[i]) === want) {
        const v = poll.results[keys[i]];
        return typeof v === 'number' && isFinite(v) ? v : null;
      }
    }
    return null;
  }

  function pollMargin(poll, race) {
    const a = share(poll, race.candidates[0]);
    const b = share(poll, race.candidates[1]);
    return a == null || b == null ? null : a - b;
  }

  // ----------------------------------------------------------- poll weights
  /**
   * Weight every eligible poll for a race as of settings.asOf.
   * Returns rows sorted newest first, each with its weight components.
   */
  function weighPolls(allPolls, race, s, asOfIso) {
    const asOf = asOfIso || s.asOf;
    const rows = [];
    allPolls.forEach(function (poll) {
      if (poll.race !== race.id || !poll.end || poll.end > asOf) return;
      const pollster = poll.pollsterId ? POLLSTER_BY_ID[poll.pollsterId] : null;
      if (!pollster && !s.includeOthers) return;
      const margin = pollMargin(poll, race);
      if (margin == null) return;
      const age = Math.max(0, daysBetween(poll.end, asOf));
      if (age > s.maxAgeDays) return;
      const trust = pollster ? pollster.weight : s.otherWeight * (poll.partisan ? s.partisanFactor : 1);
      const n = poll.n > 0 ? Math.min(poll.n, s.maxSample) : s.defaultSample;
      const bias = (s.applyBias && pollster && race.candidates[0].party === 'D') ? pollster.bias : 0;
      rows.push({
        poll: poll, pollster: pollster, margin: margin, adjMargin: margin + bias, bias: bias, age: age,
        f: {
          trust: trust,
          recency: Math.pow(0.5, age / s.halfLifeDays),
          size: Math.sqrt(n / s.refSample),
          pop: s.popWeight[poll.pop] != null ? s.popWeight[poll.pop] : s.popWeight.RV,
          repeat: 1
        }
      });
    });
    rows.sort(function (a, b) { return a.poll.end < b.poll.end ? 1 : a.poll.end > b.poll.end ? -1 : 0; });
    const seen = {};
    rows.forEach(function (r) {
      const key = r.pollster ? r.pollster.id : normName(r.poll.pollster);
      const k = seen[key] || 0;
      r.f.repeat = Math.pow(s.repeatDecay, k);
      seen[key] = k + 1;
      r.weight = r.f.trust * r.f.recency * r.f.size * r.f.pop * r.f.repeat;
    });
    return rows;
  }

  function pollAverage(rows, race) {
    const total = rows.reduce(function (sum, r) { return sum + r.weight; }, 0);
    if (!(total > 0)) return null;
    const shares = {};
    race.candidates.forEach(function (cand) {
      let num = 0, den = 0;
      rows.forEach(function (r) {
        const v = share(r.poll, cand);
        if (v != null) { num += v * r.weight; den += r.weight; }
      });
      shares[cand.last] = den > 0 ? num / den : null;
    });
    let m = 0;
    rows.forEach(function (r) { r.share = r.weight / total; m += r.adjMargin * r.share; });
    return { margin: m, shares: shares, nEff: total, count: rows.length, rows: rows, latest: rows[0].poll.end };
  }

  // ---------------------------------------------------------------- prior
  function prior(race, env, s) {
    const sideSign = race.holder === 'D' ? 1 : -1; // incumbency helps the holder's side
    const indep = race.candidates[0].party !== 'D';
    const gov = race.office === 'Governor';
    let mean, sd, basis, detail;
    if (race.incumbent === 'running' && race.last && CONFIG.HOUSE_ENV[race.last.year] != null) {
      const f = race.last.factor != null ? race.last.factor : (gov ? s.swing.governorIncumbent : s.swing.senateIncumbent);
      const envThen = CONFIG.HOUSE_ENV[race.last.year];
      mean = race.last.margin + f * (env - envThen);
      sd = s.priorSigma.incumbent;
      basis = 'incumbent';
      detail = (race.last.basis || 'Incumbent\'s last result (' + race.last.year + ')') + ' ' + fmtMargin(race.last.margin) +
        ', plus ' + Math.round(f * 100) + '% of the national swing since then (' + fmtMargin(envThen) + ' to ' + fmtMargin(env) + ')';
    } else {
      const f = gov ? s.swing.governorOpen : s.swing.senateOpen;
      const pres = CONFIG.PRES_2024[race.state];
      let bonus = 0;
      if (race.incumbent === 'appointed') bonus = sideSign * s.appointedBonus;
      else if (race.incumbent === 'running') bonus = sideSign * s.incumbencyBonus;
      mean = pres + f * (env - CONFIG.PRES_2024_NATIONAL) + bonus;
      sd = s.priorSigma.open;
      basis = 'lean';
      detail = '2024 presidential result ' + fmtMargin(pres) + ', plus ' + Math.round(f * 100) +
        '% of the national swing since then (' + fmtMargin(CONFIG.PRES_2024_NATIONAL) + ' to ' + fmtMargin(env) + ')' +
        (bonus ? ', ' + (bonus > 0 ? '+' : '') + bonus.toFixed(1) + ' for the appointed incumbent' : '');
      if (race.incumbent === 'running') detail = detail.replace('appointed incumbent', 'incumbent');
    }
    if (indep) sd = Math.max(sd, s.priorSigma.independent);
    if (race.office === 'Governor') sd += s.priorSigma.governorExtra;
    return { mean: mean, sd: sd, basis: basis, detail: detail };
  }

  function combine(avg, pr, s) {
    if (avg && avg.nEff > 0) {
      const varPoll = s.sigmaSystematic * s.sigmaSystematic + (s.sigmaPerPoll * s.sigmaPerPoll) / avg.nEff;
      const varPrior = pr.sd * pr.sd;
      const w = (1 / varPoll) / (1 / varPoll + 1 / varPrior);
      const varPost = 1 / (1 / varPoll + 1 / varPrior);
      return { mean: w * avg.margin + (1 - w) * pr.mean, sd: Math.sqrt(varPost + s.sigmaLate * s.sigmaLate), pollShare: w, pollSd: Math.sqrt(varPoll) };
    }
    return { mean: pr.mean, sd: Math.sqrt(pr.sd * pr.sd + s.sigmaLate * s.sigmaLate), pollShare: 0, pollSd: null };
  }

  // ------------------------------------------------------------ simulation
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function normalSampler(rand) {
    let spare = null;
    return function () {
      if (spare != null) { const v = spare; spare = null; return v; }
      let u = 0, v = 0;
      while (u === 0) u = rand();
      v = rand();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    };
  }
  /** Student-t draw rescaled to unit variance. */
  function tSampler(normal, dof) {
    const scale = Math.sqrt((dof - 2) / dof);
    return function () {
      let chi = 0;
      for (let i = 0; i < dof; i++) { const z = normal(); chi += z * z; }
      return normal() / Math.sqrt(chi / dof) * scale;
    };
  }

  function simulate(results, s) {
    const rand = rng(s.seed);
    const t = tSampler(normalSampler(rand), s.tDof);
    const senate = results.filter(function (r) { return r.race.office === 'Senate'; });
    const gov = results.filter(function (r) { return r.race.office === 'Governor'; });
    const all = senate.concat(gov);
    all.forEach(function (r) {
      r._corr = r.race.candidates[0].party === 'D' ? 1 : s.independentCorrelation;
      const nat = r._corr * s.sigmaNational;
      r._sdState = Math.sqrt(Math.max(r.final.sd * r.final.sd - nat * nat, 1));
      r._wins = 0;
      r._marginSum = 0;
    });
    const holdD = CONFIG.SENATE_HOLDOVERS.D, holdR = CONFIG.SENATE_HOLDOVERS.R;
    const senR = new Array(101).fill(0), senD = new Array(101).fill(0), govD = new Array(51).fill(0);
    let rCtrl = 0, dCtrl = 0, govDMaj = 0, govRMaj = 0;
    for (let k = 0; k < s.sims; k++) {
      const eNat = t() * s.sigmaNational;
      let sd = holdD, sr = holdR, gd = CONFIG.GOVERNORS_NOT_UP.D, gr = CONFIG.GOVERNORS_NOT_UP.R;
      for (let i = 0; i < all.length; i++) {
        const r = all[i];
        const m = r.final.mean + r._corr * eNat + t() * r._sdState;
        const challengerWins = m > 0;
        if (challengerWins) r._wins++;
        r._marginSum += m;
        const party = challengerWins ? r.race.candidates[0].party : 'R';
        if (r.race.office === 'Senate') {
          if (party === 'D') sd++; else if (party === 'R') sr++;
        } else {
          if (party === 'D') gd++; else if (party === 'R') gr++;
        }
      }
      senR[sr]++; senD[sd]++; govD[gd]++;
      if (sr >= CONFIG.SENATE_CONTROL.R) rCtrl++;
      else if (sd >= CONFIG.SENATE_CONTROL.D) dCtrl++;
      if (gd >= 26) govDMaj++;
      if (gr >= 26) govRMaj++;
    }
    all.forEach(function (r) {
      r.prob = r._wins / s.sims;
      delete r._wins; delete r._marginSum; delete r._corr; delete r._sdState;
      r.rating = rating(r.prob, r.race);
    });
    function summary(hist) {
      let mean = 0, cum = 0, median = null, mode = 0;
      for (let i = 0; i < hist.length; i++) {
        mean += i * hist[i];
        if (hist[i] > hist[mode]) mode = i;
      }
      for (let i = 0; i < hist.length; i++) {
        cum += hist[i];
        if (median == null && cum >= s.sims / 2) median = i;
      }
      return { mean: mean / s.sims, median: median, mode: mode, hist: hist.map(function (c) { return c / s.sims; }) };
    }
    const senRStats = summary(senR);
    let lo = null, hi = null, cum = 0;
    for (let i = 0; i < senR.length; i++) {
      cum += senR[i];
      if (lo == null && cum >= 0.1 * s.sims) lo = i;
      if (hi == null && cum >= 0.9 * s.sims) hi = i;
    }
    return {
      senate: {
        probR: rCtrl / s.sims, probD: dCtrl / s.sims, probNeither: 1 - (rCtrl + dCtrl) / s.sims,
        seatsR: senRStats, seatsD: summary(senD), range80R: [lo, hi]
      },
      governors: { probDMajority: govDMaj / s.sims, probRMajority: govRMaj / s.sims, seatsD: summary(govD) }
    };
  }

  function rating(prob, race) {
    const p = prob >= 0.5 ? prob : 1 - prob;
    const side = prob >= 0.5 ? race.candidates[0].party : 'R';
    let tier;
    if (p < 0.6) return { tier: 'Toss-up', side: null, label: 'Toss-up', key: 'tossup' };
    if (p < 0.8) tier = 'Lean';
    else if (p < 0.95) tier = 'Likely';
    else tier = 'Safe';
    return { tier: tier, side: side, label: tier + ' ' + side, key: tier.toLowerCase() + '-' + side.toLowerCase() };
  }

  function fmtMargin(m) {
    if (m == null || !isFinite(m)) return 'n/a';
    const v = Math.abs(m) < 0.05 ? 0 : m;
    return v === 0 ? 'even' : (v > 0 ? 'D+' : 'R+') + Math.abs(v).toFixed(1);
  }

  // ---------------------------------------------------------------- run
  function nationalEnvironment(polls, s, asOfIso) {
    const house = RACE_BY_ID['HOUSE-US'];
    const rows = weighPolls(polls, house, s, asOfIso);
    const avg = pollAverage(rows, house);
    return { avg: avg, margin: avg ? avg.margin : s.envFallback, fromPolls: !!avg };
  }

  function run(polls, userSettings) {
    const s = mergeSettings(userSettings);
    const env = nationalEnvironment(polls, s);
    const results = CONFIG.RACES.filter(function (r) { return r.office !== 'House'; }).map(function (race) {
      const rows = weighPolls(polls, race, s);
      const avg = pollAverage(rows, race);
      const pr = prior(race, env.margin, s);
      const fin = combine(avg, pr, s);
      return { race: race, avg: avg, prior: pr, final: fin, coverage: coverage(avg) };
    });
    const sim = simulate(results, s);
    return {
      settings: s,
      asOf: s.asOf,
      env: env,
      races: results,
      byId: results.reduce(function (o, r) { o[r.race.id] = r; return o; }, {}),
      senate: sim.senate,
      governors: sim.governors,
      pollsterTotals: pollsterTotals(results)
    };
  }

  function coverage(avg) {
    if (!avg) return { key: 'none', label: 'No qualifying polls' };
    if (avg.nEff < 0.15) return { key: 'stale', label: 'Only stale polls' };
    if (avg.nEff < 1) return { key: 'thin', label: 'Thin polling' };
    return { key: 'good', label: 'Well polled' };
  }

  function pollsterTotals(results) {
    const totals = {};
    CONFIG.POLLSTERS.forEach(function (p) { totals[p.id] = { polls: 0, races: 0, weight: 0 }; });
    results.forEach(function (r) {
      if (!r.avg) return;
      const touched = {};
      r.avg.rows.forEach(function (row) {
        if (!row.pollster) return;
        const t = totals[row.pollster.id];
        t.polls++; t.weight += row.weight;
        touched[row.pollster.id] = true;
      });
      Object.keys(touched).forEach(function (id) { totals[id].races++; });
    });
    return totals;
  }

  /** Poll-average trend for one race, sampled every stepDays. */
  function trend(polls, raceId, userSettings, fromIso, stepDays) {
    const s = mergeSettings(userSettings);
    const race = RACE_BY_ID[raceId];
    const out = [];
    const step = stepDays || 3;
    for (let d = toDate(fromIso); d <= toDate(s.asOf); d += step * DAY_MS) {
      const day = isoDay(d);
      const avg = pollAverage(weighPolls(polls, race, s, day), race);
      if (avg) out.push({ date: day, margin: avg.margin, nEff: avg.nEff, shares: avg.shares });
    }
    const last = out[out.length - 1];
    if (!last || last.date !== s.asOf) {
      const avg = pollAverage(weighPolls(polls, race, s, s.asOf), race);
      if (avg) out.push({ date: s.asOf, margin: avg.margin, nEff: avg.nEff, shares: avg.shares });
    }
    return out;
  }

  return {
    DEFAULTS: DEFAULTS,
    run: run,
    trend: trend,
    weighPolls: weighPolls,
    pollAverage: pollAverage,
    prior: prior,
    combine: combine,
    rating: rating,
    matchPollster: matchPollster,
    pollMargin: pollMargin,
    share: share,
    fmtMargin: fmtMargin,
    normName: normName,
    mergeSettings: mergeSettings,
    daysBetween: daysBetween,
    POLLSTER_BY_ID: POLLSTER_BY_ID,
    RACE_BY_ID: RACE_BY_ID
  };
});
