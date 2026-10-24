/*
 * Static configuration for the 2026 midterm forecast: the ten trusted
 * pollsters, every Senate and governor race on the ballot, and the
 * state-level baselines the model's prior is built from.
 *
 * Loads as a classic browser script (window.ElectionConfig) or as a
 * CommonJS module (require('./config')).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ElectionConfig = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ELECTION_DATE = '2026-11-03';

  // ---------------------------------------------------------------------
  // The ten trusted pollsters.
  //
  // grade:  Silver Bulletin pollster grade (accuracy + transparency blend).
  //         WaPo, Marquette and NYT/Siena are the top three of 500+ firms in
  //         the January 2026 update; AtlasIntel was A+ and #1 in 2025.
  // weight: trust weight used by the model, mapped from the grade
  //         (A+ 1.00, A 0.90, A- 0.80, B+ 0.70).
  // bias:   Silver Bulletin "mean-reverted bias" in points of D-R margin;
  //         negative = historically leaned Democratic. 0 where no numeric
  //         value was published (see biasNote). Subtracted when the
  //         "historical bias adjustment" setting is on.
  // aliases: lower-case substrings that identify the pollster in a
  //         Wikipedia "Poll source" cell.
  // ---------------------------------------------------------------------
  const POLLSTERS = [
    {
      id: 'nyt-siena', name: 'The New York Times / Siena College', short: 'NYT/Siena',
      grade: 'A+', standing: 'Top 3 of 500+ (Jan 2026)', weight: 1.0, bias: 0,
      biasNote: 'Rated as minimally favoring Republicans; no numeric value published.',
      aliases: ['new york times', 'nytimes', 'nyt/', 'siena'],
      media: 'The New York Times; Siena polls for Newsday, Times Union',
      evidence: 'Among the top three pollsters in the Silver Bulletin January 2026 ratings; FiveThirtyEight named it the most accurate pollster in America (3.0 stars, 2024).'
    },
    {
      id: 'wapo', name: 'The Washington Post (with Ipsos / George Mason Schar School)', short: 'Wash. Post',
      grade: 'A+', standing: '#1 of 500+ (Jan 2026)', weight: 1.0, bias: 0,
      biasNote: 'No Silver Bulletin numeric bias retrieved.',
      aliases: ['washington post'],
      media: 'The Washington Post, ABC News',
      evidence: 'Ranked first in the Silver Bulletin January 2026 pollster ratings; ABC News/Washington Post held FiveThirtyEight\'s top 3.0-star rating (2024).'
    },
    {
      id: 'marquette', name: 'Marquette Law School Poll', short: 'Marquette',
      grade: 'A+', standing: '#2 of 500+ (Jan 2026)', weight: 1.0, bias: -0.35,
      aliases: ['marquette'],
      media: 'Wisconsin and national media; Supreme Court polling',
      evidence: 'Ranked second in the Silver Bulletin January 2026 update; FiveThirtyEight gave it a 10/10 transparency score (2024).'
    },
    {
      id: 'atlasintel', name: 'AtlasIntel', short: 'AtlasIntel',
      grade: 'A+', standing: '#1 in the 2025 update', weight: 1.0, bias: -0.16,
      aliases: ['atlasintel', 'atlas intel'],
      media: 'Bloomberg and international outlets',
      evidence: 'A+ and first overall in the Silver Bulletin 2025 update after the most accurate 2020 and 2024 presidential results; no 2026 U.S. race polls found yet.'
    },
    {
      id: 'fox', name: 'Fox News Poll (Beacon Research / Shaw & Co.)', short: 'Fox News',
      grade: 'A', standing: 'Grade A', weight: 0.9, bias: 0,
      biasNote: 'Rated as moderately favoring Democrats; no numeric value retrieved.',
      // Wikipedia credits Fox polls to "Beacon Research (D)/Shaw & Co. Research (R)".
      // Beacon alone (or paired with another firm) is a different, partisan poll.
      aliases: ['fox news', 'shaw & co', 'shaw and co'],
      media: 'Fox News',
      evidence: 'Conducted by a bipartisan team (Beacon Research, D; Shaw & Co., R) graded A in Silver Bulletin ratings.'
    },
    {
      id: 'surveyusa', name: 'SurveyUSA', short: 'SurveyUSA',
      grade: 'A', standing: 'Grade A', weight: 0.9, bias: -0.09,
      aliases: ['surveyusa', 'survey usa'],
      media: 'Local TV partners (KSTP and others)',
      evidence: 'Graded A in Silver Bulletin ratings with one of the smallest historical biases of any firm.'
    },
    {
      id: 'emerson', name: 'Emerson College Polling', short: 'Emerson',
      grade: 'A-', standing: 'Grade A-', weight: 0.8, bias: -0.65,
      aliases: ['emerson'],
      media: 'The Hill, Nexstar Media',
      evidence: 'Graded A- in Silver Bulletin ratings; the most prolific high-quality state pollster of the cycle.'
    },
    {
      id: 'marist', name: 'Marist Poll', short: 'Marist',
      grade: 'A-', standing: 'Grade A-', weight: 0.8, bias: -0.52,
      aliases: ['marist'],
      media: 'NPR, PBS News',
      evidence: 'Graded A- in Silver Bulletin ratings; 2.9 of 3 stars from FiveThirtyEight (2024).'
    },
    {
      id: 'suffolk', name: 'Suffolk University', short: 'Suffolk',
      grade: 'A-', standing: 'Grade A-', weight: 0.8, bias: -0.89,
      aliases: ['suffolk'],
      media: 'USA Today, Boston Globe',
      evidence: 'Graded A- in Silver Bulletin ratings; topped FiveThirtyEight\'s most-accurate list for 2021-22.'
    },
    {
      id: 'quinnipiac', name: 'Quinnipiac University', short: 'Quinnipiac',
      grade: 'B+', standing: 'Grade B+', weight: 0.7, bias: -0.62,
      aliases: ['quinnipiac'],
      media: 'Widely cited by national and regional media',
      evidence: 'Graded B+ in Silver Bulletin ratings; long-running live-interview state polls.'
    }
  ];

  // 2024 presidential margin, D minus R, in points (certified results, rounded).
  const PRES_2024 = {
    AL: -30.5, AK: -13.1, AZ: -5.5, AR: -30.6, CA: 20.1, CO: 11.0, CT: 14.5, DE: 14.7,
    FL: -13.1, GA: -2.2, HI: 23.1, ID: -36.5, IL: 10.9, IN: -19.0, IA: -13.2, KS: -16.1,
    KY: -30.5, LA: -22.0, ME: 6.9, MD: 28.5, MA: 25.2, MI: -1.4, MN: 4.2, MS: -22.9,
    MO: -18.4, MT: -19.9, NE: -20.5, NV: -3.1, NH: 2.8, NJ: 5.9, NM: 6.0, NY: 12.6,
    NC: -3.2, ND: -36.5, OH: -11.2, OK: -34.3, OR: 14.3, PA: -1.7, RI: 13.8, SC: -17.9,
    SD: -29.2, TN: -29.7, TX: -13.7, UT: -21.6, VT: 31.5, VA: 5.8, WA: 18.2, WV: -41.9,
    WI: -0.9, WY: -45.8
  };
  const PRES_2024_NATIONAL = -1.5;

  // National House popular-vote margin (D minus R) by year: the "national
  // environment" an incumbent's last result was earned in.
  const HOUSE_ENV = { 2020: 3.1, 2022: -2.8, 2024: -2.6 };

  const STATE_NAMES = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
    CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
    IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
    ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
    MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
    NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
    ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
    RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
    UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
    WI: 'Wisconsin', WY: 'Wyoming', US: 'United States'
  };

  // Tile-grid map positions [column, row] on a 12 x 8 grid.
  const TILE_GRID = {
    AK: [0, 0], ME: [11, 0], VT: [9, 1], NH: [10, 1],
    WA: [1, 2], ID: [2, 2], MT: [3, 2], ND: [4, 2], MN: [5, 2], IL: [6, 2], WI: [7, 2], MI: [8, 2], NY: [9, 2], RI: [10, 2], MA: [11, 2],
    OR: [1, 3], NV: [2, 3], WY: [3, 3], SD: [4, 3], IA: [5, 3], IN: [6, 3], OH: [7, 3], PA: [8, 3], NJ: [9, 3], CT: [10, 3],
    CA: [1, 4], UT: [2, 4], CO: [3, 4], NE: [4, 4], MO: [5, 4], KY: [6, 4], WV: [7, 4], VA: [8, 4], MD: [9, 4], DE: [10, 4],
    AZ: [2, 5], NM: [3, 5], KS: [4, 5], AR: [5, 5], TN: [6, 5], NC: [7, 5], SC: [8, 5],
    OK: [4, 6], LA: [5, 6], MS: [6, 6], AL: [7, 6], GA: [8, 6],
    HI: [0, 7], TX: [4, 7], FL: [9, 7]
  };

  // ---------------------------------------------------------------------
  // Races. candidates[0] is always the main non-Republican candidate and
  // candidates[1] the Republican; the model forecasts margin = c0 - c1.
  //   holder:    party that holds the seat now
  //   incumbent: 'running' (elected incumbent), 'appointed', or null (open)
  //   last:      the incumbent's last result for this office as a c0 - c1
  //              margin, with the year it was earned
  //   expert:    published expert rating, shown for context only
  // ---------------------------------------------------------------------
  function c(name, party, extra) {
    const parts = name.split(' ');
    return Object.assign({ name: name, last: parts[parts.length - 1], party: party }, extra || {});
  }
  function senateWiki(stateName, special) {
    return '2026 United States Senate ' + (special ? 'special election' : 'election') + ' in ' + stateName;
  }

  const SENATE = [
    { state: 'AL', holder: 'R', incumbent: null, candidates: [c('Everett Wess', 'D'), c('Barry Moore', 'R')], note: 'Open: Tommy Tuberville is running for governor.' },
    { state: 'AK', holder: 'R', incumbent: 'running', last: { margin: -12.7, year: 2020 }, candidates: [c('Mary Peltola', 'D'), c('Dan Sullivan', 'R', { inc: true })], expert: 'Leans D (Sabato, Oct 6)' },
    { state: 'AR', holder: 'R', incumbent: 'running', candidates: [c('Hallie Shoffner', 'D'), c('Tom Cotton', 'R', { inc: true })], note: 'Cotton had no Democratic opponent in 2020, so the prior uses state lean.' },
    { state: 'CO', holder: 'D', incumbent: 'running', last: { margin: 9.3, year: 2020 }, candidates: [c('John Hickenlooper', 'D', { inc: true }), c('Mark Baisley', 'R')] },
    { state: 'DE', holder: 'D', incumbent: 'running', last: { margin: 21.5, year: 2020 }, candidates: [c('Chris Coons', 'D', { inc: true }), c('Michael Katz', 'R')], expert: 'Solid D (Cook)' },
    { state: 'FL', special: true, holder: 'R', incumbent: 'appointed', candidates: [c('Angie Nixon', 'D'), c('Ashley Moody', 'R', { inc: true })], note: 'Special election for the rest of Marco Rubio\'s term.' },
    { state: 'GA', holder: 'D', incumbent: 'running', last: { margin: 1.2, year: 2020 }, candidates: [c('Jon Ossoff', 'D', { inc: true }), c('Mike Collins', 'R')], expert: 'Likely D (Cook)' },
    { state: 'ID', holder: 'R', incumbent: 'running', last: { margin: -29.4, year: 2020 }, candidates: [c('Todd Achilles', 'I'), c('Jim Risch', 'R', { inc: true })], note: 'Democratic nominee withdrew; independent Todd Achilles is the main challenger.' },
    { state: 'IL', holder: 'D', incumbent: null, candidates: [c('Juliana Stratton', 'D'), c('Don Tracy', 'R')], note: 'Open: Dick Durbin is retiring.' },
    { state: 'IA', holder: 'R', incumbent: null, candidates: [c('Josh Turek', 'D'), c('Ashley Hinson', 'R')], expert: 'Toss-up (Sabato, Oct 14)', note: 'Open: Joni Ernst is retiring.' },
    { state: 'KS', holder: 'R', incumbent: 'running', last: { margin: -11.4, year: 2020 }, candidates: [c('Adam Hamilton', 'D'), c('Roger Marshall', 'R', { inc: true })], expert: 'Toss-up (Sabato, Oct 14; Cook, Oct 6)' },
    { state: 'KY', holder: 'R', incumbent: null, candidates: [c('Charles Booker', 'D'), c('Andy Barr', 'R')], note: 'Open: Mitch McConnell is retiring.' },
    { state: 'LA', holder: 'R', incumbent: null, candidates: [c('Jamie Davis', 'D'), c('Julia Letlow', 'R')], note: 'Bill Cassidy lost the Republican primary.' },
    { state: 'ME', holder: 'R', incumbent: 'running', last: { margin: -8.6, year: 2020 }, candidates: [c('Troy Jackson', 'D'), c('Susan Collins', 'R', { inc: true })], expert: 'Toss-up (Sabato, Oct 14)' },
    { state: 'MA', holder: 'D', incumbent: 'running', last: { margin: 33.2, year: 2020 }, candidates: [c('Ed Markey', 'D', { inc: true }), c('John Deaton', 'R')] },
    { state: 'MI', holder: 'D', incumbent: null, candidates: [c('Abdul El-Sayed', 'D'), c('Mike Rogers', 'R')], expert: 'Leans D (Sabato, Oct 6)', note: 'Open: Gary Peters is retiring.' },
    { state: 'MN', holder: 'D', incumbent: null, candidates: [c('Peggy Flanagan', 'D'), c('Michele Tafoya', 'R')], expert: 'Leans D (Sabato, Oct 14)', note: 'Open: Tina Smith is retiring.' },
    { state: 'MS', holder: 'R', incumbent: 'running', last: { margin: -10.0, year: 2020 }, candidates: [c('Scott Colom', 'D'), c('Cindy Hyde-Smith', 'R', { inc: true })], expert: 'Likely R (Sabato, Oct 14)' },
    { state: 'MT', holder: 'R', incumbent: null, candidates: [c('Seth Bodnar', 'I'), c('Kurt Alme', 'R'), c('Alani Bankhead', 'D')], note: 'Open: Steve Daines withdrew. Three-way race; independent Seth Bodnar runs second in polls.' },
    { state: 'NE', holder: 'R', incumbent: 'running', last: { margin: -6.7, year: 2024, factor: 0.5, basis: 'Dan Osborn\'s 2024 result against Deb Fischer' }, candidates: [c('Dan Osborn', 'I'), c('Pete Ricketts', 'R', { inc: true })], expert: 'Leans R (Sabato, Oct 14)', note: 'Independent Dan Osborn says he would not caucus with either party.' },
    { state: 'NH', holder: 'D', incumbent: null, candidates: [c('Chris Pappas', 'D'), c('John E. Sununu', 'R', { last: 'Sununu' })], expert: 'Likely D (Sabato, Oct 14); Lean D (Cook, Oct 6)', note: 'Open: Jeanne Shaheen is retiring.' },
    { state: 'NJ', holder: 'D', incumbent: 'running', last: { margin: 16.3, year: 2020 }, candidates: [c('Cory Booker', 'D', { inc: true }), c('Justin Murphy', 'R')] },
    { state: 'NM', holder: 'D', incumbent: 'running', last: { margin: 6.1, year: 2020 }, candidates: [c('Ben Ray Luján', 'D', { inc: true, last: 'Luján' }), c('Larry Marker', 'R')] },
    { state: 'NC', holder: 'R', incumbent: null, candidates: [c('Roy Cooper', 'D'), c('Michael Whatley', 'R')], expert: 'Likely D (Cook, Oct 6)', note: 'Open: Thom Tillis is retiring.' },
    { state: 'OH', special: true, holder: 'R', incumbent: 'appointed', candidates: [c('Sherrod Brown', 'D'), c('Jon Husted', 'R', { inc: true })], expert: 'Toss-up (Sabato, Oct 14)', note: 'Special election for the rest of JD Vance\'s term.' },
    { state: 'OK', holder: 'R', incumbent: null, candidates: [c('N\'Kiyla Jasmine Thomas', 'D', { last: 'Thomas' }), c('Kevin Hern', 'R')], note: 'Markwayne Mullin left to lead Homeland Security; interim Sen. Alan Armstrong is not running.' },
    { state: 'OR', holder: 'D', incumbent: 'running', last: { margin: 17.7, year: 2020 }, candidates: [c('Jeff Merkley', 'D', { inc: true }), c('David Brock Smith', 'R')], expert: 'Solid D (Cook)' },
    { state: 'RI', holder: 'D', incumbent: 'running', last: { margin: 33.1, year: 2020 }, candidates: [c('Jack Reed', 'D', { inc: true }), c('Raymond McKay', 'R')], expert: 'Solid D (Cook)' },
    { state: 'SC', holder: 'R', incumbent: 'appointed', candidates: [c('Annie Andrews', 'D'), c('Darline Graham', 'R', { inc: true })], expert: 'Likely R (Sabato, Oct 6)', note: 'Sen. Lindsey Graham died in July 2026; his sister Darline Graham was appointed and won the nomination.' },
    { state: 'SD', holder: 'R', incumbent: 'running', last: { margin: -31.4, year: 2020 }, candidates: [c('Brian Bengs', 'I'), c('Mike Rounds', 'R', { inc: true })], expert: 'Solid R (Cook)' },
    { state: 'TN', holder: 'R', incumbent: 'running', last: { margin: -27.0, year: 2020 }, candidates: [c('Marquita Bradshaw', 'D'), c('Bill Hagerty', 'R', { inc: true })], expert: 'Solid R (Cook)' },
    { state: 'TX', holder: 'R', incumbent: null, candidates: [c('James Talarico', 'D'), c('Ken Paxton', 'R')], expert: 'Toss-up (Sabato, Oct 14)', note: 'John Cornyn lost the Republican primary to Ken Paxton.' },
    { state: 'VA', holder: 'D', incumbent: 'running', last: { margin: 12.0, year: 2020 }, candidates: [c('Mark Warner', 'D', { inc: true }), c('Bert Mizusawa', 'R')] },
    { state: 'WV', holder: 'R', incumbent: 'running', last: { margin: -43.3, year: 2020 }, candidates: [c('Rachel Fetty Anderson', 'D', { last: 'Anderson' }), c('Shelley Moore Capito', 'R', { inc: true })] },
    { state: 'WY', holder: 'R', incumbent: null, candidates: [c('James W. Byrd', 'D', { last: 'Byrd' }), c('Harriet Hageman', 'R')] }
  ];

  const GOVERNOR = [
    { state: 'AL', holder: 'R', incumbent: null, candidates: [c('Doug Jones', 'D'), c('Tommy Tuberville', 'R')] },
    { state: 'AK', holder: 'R', incumbent: null, headToHeadOnly: true, candidates: [c('Jonathan Kreiss-Tomkins', 'D'), c('Bernadette Wilson', 'R')], note: 'Ranked-choice general with three Republicans (Wilson, Dave Bronson, Candi English). First-round polls split the Republican vote, so only head-to-head (final-round) polls are used.' },
    { state: 'AZ', holder: 'D', incumbent: 'running', last: { margin: 0.7, year: 2022 }, candidates: [c('Katie Hobbs', 'D', { inc: true }), c('Andy Biggs', 'R')] },
    { state: 'AR', holder: 'R', incumbent: 'running', last: { margin: -28.1, year: 2022 }, candidates: [c('Fredrick Love', 'D'), c('Sarah Huckabee Sanders', 'R', { inc: true, last: 'Sanders' })] },
    { state: 'CA', holder: 'D', incumbent: null, candidates: [c('Xavier Becerra', 'D'), c('Steve Hilton', 'R')] },
    { state: 'CO', holder: 'D', incumbent: null, candidates: [c('Phil Weiser', 'D'), c('Victor Marx', 'R')] },
    { state: 'CT', holder: 'D', incumbent: 'running', last: { margin: 13.0, year: 2022 }, candidates: [c('Ned Lamont', 'D', { inc: true }), c('Ryan Fazio', 'R')] },
    { state: 'FL', holder: 'R', incumbent: null, candidates: [c('David Jolly', 'D'), c('Byron Donalds', 'R')] },
    { state: 'GA', holder: 'R', incumbent: null, candidates: [c('Keisha Lance Bottoms', 'D', { last: 'Bottoms' }), c('Rick Jackson', 'R')], expert: 'Toss-up (Sabato, Oct 22)' },
    { state: 'HI', holder: 'D', incumbent: 'running', last: { margin: 26.4, year: 2022 }, candidates: [c('Josh Green', 'D', { inc: true }), c('Gary Cordery', 'R')] },
    { state: 'ID', holder: 'R', incumbent: 'running', last: { margin: -40.2, year: 2022 }, candidates: [c('Terri Pickens', 'D'), c('Brad Little', 'R', { inc: true })] },
    { state: 'IL', holder: 'D', incumbent: 'running', last: { margin: 12.5, year: 2022 }, candidates: [c('JB Pritzker', 'D', { inc: true }), c('Darren Bailey', 'R')] },
    { state: 'IA', holder: 'R', incumbent: null, candidates: [c('Rob Sand', 'D'), c('Zach Lahn', 'R')], expert: 'Leans D (Sabato, Sep 3)' },
    { state: 'KS', holder: 'D', incumbent: null, candidates: [c('Cindy Holscher', 'D'), c('Ty Masterson', 'R')] },
    { state: 'ME', holder: 'D', incumbent: null, candidates: [c('Hannah Pingree', 'D'), c('Bobby Charles', 'R'), c('Rick Bennett', 'I')] },
    { state: 'MD', holder: 'D', incumbent: 'running', last: { margin: 32.4, year: 2022 }, candidates: [c('Wes Moore', 'D', { inc: true }), c('Dan Cox', 'R')] },
    { state: 'MA', holder: 'D', incumbent: 'running', last: { margin: 29.1, year: 2022 }, candidates: [c('Maura Healey', 'D', { inc: true }), c('Michael Minogue', 'R')] },
    { state: 'MI', holder: 'D', incumbent: null, candidates: [c('Jocelyn Benson', 'D'), c('John James', 'R')], expert: 'Likely D (Sabato, Oct 22)' },
    { state: 'MN', holder: 'D', incumbent: null, candidates: [c('Amy Klobuchar', 'D'), c('Lisa Demuth', 'R')], note: 'Tim Walz is not seeking a third term.' },
    { state: 'NE', holder: 'R', incumbent: 'running', last: { margin: -23.7, year: 2022 }, candidates: [c('Lynne Walz', 'D'), c('Jim Pillen', 'R', { inc: true })] },
    { state: 'NV', holder: 'R', incumbent: 'running', last: { margin: -1.5, year: 2022 }, candidates: [c('Aaron Ford', 'D'), c('Joe Lombardo', 'R', { inc: true })], expert: 'Toss-up (Sabato, Oct 22)' },
    { state: 'NH', holder: 'R', incumbent: 'running', last: { margin: -9.6, year: 2024 }, candidates: [c('Cinde Warmington', 'D'), c('Kelly Ayotte', 'R', { inc: true })] },
    { state: 'NM', holder: 'D', incumbent: null, candidates: [c('Deb Haaland', 'D'), c('Gregg Hull', 'R')] },
    { state: 'NY', holder: 'D', incumbent: 'running', last: { margin: 6.4, year: 2022 }, candidates: [c('Kathy Hochul', 'D', { inc: true }), c('Bruce Blakeman', 'R')] },
    { state: 'OH', holder: 'R', incumbent: null, candidates: [c('Amy Acton', 'D'), c('Vivek Ramaswamy', 'R')], expert: 'Leans D (Sabato, Oct 22)' },
    { state: 'OK', holder: 'R', incumbent: null, candidates: [c('Cyndi Munson', 'D'), c('Mike Mazzei', 'R')] },
    { state: 'OR', holder: 'D', incumbent: 'running', last: { margin: 3.5, year: 2022 }, candidates: [c('Tina Kotek', 'D', { inc: true }), c('Christine Drazan', 'R')] },
    { state: 'PA', holder: 'D', incumbent: 'running', last: { margin: 14.8, year: 2022 }, candidates: [c('Josh Shapiro', 'D', { inc: true }), c('Stacy Garrity', 'R')] },
    { state: 'RI', holder: 'D', incumbent: null, candidates: [c('Helena Foulkes', 'D'), c('Aaron Guckian', 'R')], note: 'Gov. Dan McKee lost the Democratic primary.' },
    { state: 'SC', holder: 'R', incumbent: null, candidates: [c('Jermaine Johnson', 'D'), c('Alan Wilson', 'R')] },
    { state: 'SD', holder: 'R', incumbent: 'appointed', candidates: [c('Dan Ahlers', 'D'), c('Larry Rhoden', 'R', { inc: true })], note: 'Rhoden succeeded Kristi Noem in 2025 and has not yet won a governor\'s race.' },
    { state: 'TN', holder: 'R', incumbent: null, candidates: [c('Jerri Green', 'D'), c('Marsha Blackburn', 'R')] },
    { state: 'TX', holder: 'R', incumbent: 'running', last: { margin: -11.0, year: 2022 }, candidates: [c('Gina Hinojosa', 'D'), c('Greg Abbott', 'R', { inc: true })] },
    { state: 'VT', holder: 'R', incumbent: 'running', last: { margin: -51.3, year: 2024 }, candidates: [c('Amanda Janoo', 'D'), c('Phil Scott', 'R', { inc: true })] },
    { state: 'WI', holder: 'D', incumbent: null, candidates: [c('David Crowley', 'D'), c('Tom Tiffany', 'R')], note: 'Open: Tony Evers is retiring.' },
    { state: 'WY', holder: 'R', incumbent: null, candidates: [c('Ken Casner', 'D'), c('Eric Barlow', 'R')] }
  ];

  const RACES = []
    .concat(SENATE.map(function (r) {
      return Object.assign({
        id: 'SEN-' + r.state, office: 'Senate', stateName: STATE_NAMES[r.state],
        wiki: [senateWiki(STATE_NAMES[r.state], r.special)]
      }, r);
    }))
    .concat(GOVERNOR.map(function (r) {
      return Object.assign({
        id: 'GOV-' + r.state, office: 'Governor', stateName: STATE_NAMES[r.state],
        wiki: ['2026 ' + STATE_NAMES[r.state] + ' gubernatorial election']
      }, r);
    }))
    .concat([{
      id: 'HOUSE-US', office: 'House', state: 'US', stateName: 'United States', holder: 'R', incumbent: null,
      candidates: [
        { name: 'Democrats', last: 'Democratic', party: 'D', match: ['Democratic', 'Democrats', 'Democrat', 'Dem'] },
        { name: 'Republicans', last: 'Republican', party: 'R', match: ['Republican', 'Republicans', 'Rep', 'GOP'] }
      ],
      // No Wikipedia article lists individual national generic-ballot polls this
      // cycle (the House article only carries aggregator averages), so these
      // titles usually miss and the bundled generic-ballot polls are used.
      wiki: [
        'Opinion polling for the 2026 United States House of Representatives elections',
        'Generic ballot polling for the 2026 United States House of Representatives elections'
      ],
      note: 'Generic congressional ballot: which party voters prefer for the House.'
    }]);

  return {
    ELECTION_DATE: ELECTION_DATE,
    POLLSTERS: POLLSTERS,
    RACES: RACES,
    PRES_2024: PRES_2024,
    PRES_2024_NATIONAL: PRES_2024_NATIONAL,
    HOUSE_ENV: HOUSE_ENV,
    STATE_NAMES: STATE_NAMES,
    TILE_GRID: TILE_GRID,
    // Seats not on the 2026 ballot (King and Sanders counted with Democrats).
    SENATE_HOLDOVERS: { D: 34, R: 31 },
    SENATE_CONTROL: { R: 50, D: 51 }, // Republicans hold ties via VP JD Vance
    GOVERNORS_NOT_UP: { D: 6, R: 8 },
    WIKI_API: 'https://en.wikipedia.org/w/api.php'
  };
});
