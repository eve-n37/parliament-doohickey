// Government sim: bills and divisions, events, the economy, polling,
// elections and by-elections, plus achievements.
(function (PB) {
  const esc = PB.esc;
  const gov = () => PB.state.gov;

  // Every roll goes through a seeded generator (mulberry32) whose state is
  // saved with the sim, so the same seed and the same choices replay exactly.
  const hashSeed = (seed) => {
    let h = 2166136261;
    for (const ch of String(seed).toUpperCase()) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h | 0;
  };

  function random() {
    const g = gov();
    if (g.rng === null) g.rng = hashSeed(g.seed);
    let t = (g.rng = (g.rng + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const rand = (a, b) => a + random() * (b - a);
  const randInt = (a, b) => a + Math.floor(random() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(random() * arr.length)];
  const shuffle = (list) => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);

  // Seats go roughly with votes cubed under first-past-the-post (the "cube rule").
  const POWER = { fptp: 3, pr: 1 };
  // Approval drifts back to this, and polls swing for or against the
  // government by how far it is above or below it.
  const NEUTRAL = 45;
  // Vote share the government gains per point of approval above neutral.
  const SWING = 0.0035;
  // Vote share a government sheds over a full term ("time for a change").
  const FATIGUE = 0.01;
  // How far an upper-house result can wander from the national vote.
  const UPPER_DRIFT = 0.04;
  // Long-run growth (% a year) and the unemployment rate the economy settles back to.
  const TREND = 2;
  const NATURAL = 4.5;

  PB.govDate = (turn) => `Q${(turn % 4) + 1} ${gov().startYear + Math.floor(turn / 4)}`;

  // --- Parties ------------------------------------------------------------
  PB.isVacant = (p) => /^\s*vacan/i.test(String(p.name || ''));
  PB.isIndependent = (p) => /^\s*(independents?|non-partisan)\s*$/i.test(String(p.name || '')) || /^\s*ind\.?\s*$/i.test(String(p.short || ''));
  const isParty = (p) => !PB.isVacant(p) && !PB.isIndependent(p);

  // Lean on a -3 (far-left) .. +3 (far-right) scale, read from the infobox
  // "Political position". Ranges like "Centre-left to left-wing" average out;
  // anything unrecognised counts as centre.
  const LEANS = [
    [/far[- ]?left/g, -3],
    [/far[- ]?right/g, 3],
    [/cent(re|er)[- ]?left/g, -1],
    [/cent(re|er)[- ]?right/g, 1],
    [/left/g, -2],
    [/right/g, 2],
    [/cent(re|er|rist)|big tent|syncretic/g, 0],
  ];

  PB.leanOf = (p) => {
    let text = String(p.info.position || '').toLowerCase();
    const found = [];
    for (const [re, v] of LEANS) {
      text = text.replace(re, () => {
        found.push(v);
        return ' ';
      });
    }
    return found.length ? sum(found, (v) => v) / found.length : 0;
  };

  PB.leanLabel = (lean) =>
    lean <= -2.5 ? 'Far-left' : lean <= -1.5 ? 'Left' : lean <= -0.5 ? 'Centre-left' : lean < 0.5 ? 'Centre' : lean < 1.5 ? 'Centre-right' : lean < 2.5 ? 'Right' : 'Far-right';

  PB.chamberName = (c) => PB.state.chambers[c].name || (c ? 'upper house' : 'lower house');

  // Who's in government in chamber `c`: ticked coalition parties with seats
  // there. Governments are made and unmade in the lower house (chamber 0).
  PB.govInfo = (c = 0) => {
    const total = PB.totalSeats(c);
    const members = PB.state.parties.filter((p) => p.coalition && p.seats[c] > 0 && !PB.isVacant(p));
    const seats = sum(members, (p) => p.seats[c]);
    const majority = PB.majority(total);
    const leader = members.reduce((best, p) => (!best || p.seats[c] > best.seats[c] ? p : best), null);
    return { members, seats, total, majority, isMajority: seats >= majority, leader };
  };

  // Everyone who votes with the government, in either chamber: its parties
  // plus any independents ticked as coalition. Empty while nobody governs.
  function govIds() {
    if (!PB.govInfo().members.length) return new Set();
    return new Set(PB.state.parties.filter((p) => p.coalition && !PB.isVacant(p)).map((p) => p.id));
  }

  PB.govLabel = (info = PB.govInfo()) => {
    if (!info.members.length) return 'No government';
    const kind = info.isMajority ? 'majority' : 'minority';
    if (info.members.length === 1) return `${info.leader.name} ${kind} government`;
    const names = [info.leader, ...info.members.filter((p) => p !== info.leader)].map((p) => p.short || p.name);
    return `${names.join('–')} coalition (${kind})`;
  };

  // --- Bills ----------------------------------------------------------------
  // lean: where the bill sits left to right. pop: how voters feel about it.
  // econ: growth is a one-off kick that fades, budget a lasting change to the
  // balance (% of GDP), jobs a change to unemployment.
  PB.BILLS = [
    ['infrastructure', 'Infrastructure Renewal Act', 0, 3, 'Fix roads, bridges and water pipes across the country.', { growth: 0.8, budget: -0.4 }],
    ['childcare', 'Universal Childcare Act', -1.5, 3, 'Free childcare for every family with kids under five.', { growth: 0.2, budget: -0.6, jobs: -0.1 }],
    ['minwage', 'Minimum Wage Act', -1, 2, 'Raise the federal minimum wage to $18 an hour.', { jobs: 0.2 }],
    ['carbon', 'Carbon Dividend Act', -1.5, 1, 'Tax carbon emissions and send the money back as a cheque.', { growth: -0.2 }],
    ['broadband', 'Public Broadband Act', -1, 2, 'Fibre internet for every rural town.', { growth: 0.3, budget: -0.2 }],
    ['drugprices', 'Drug Prices Act', -1, 3, 'Let the government negotiate prescription drug prices.', { budget: 0.3 }],
    ['studentdebt', 'Student Debt Relief Act', -2, 1, 'Cancel up to $20,000 of student debt per borrower.', { growth: 0.2, budget: -0.5 }],
    ['wealthtax', 'Wealth Tax Act', -2.5, 1, 'A 2% yearly tax on fortunes over $50 million.', { growth: -0.2, budget: 0.6 }],
    ['ai', 'AI Accountability Act', -0.5, 2, 'Safety testing and audits for the most powerful AI models.', { growth: -0.1 }],
    ['rail', 'High-Speed Rail Act', -0.5, 1, 'Bullet trains between the biggest cities.', { growth: 0.4, budget: -0.4 }],
    ['housing', 'Housing Supply Act', 0, 2, 'Overrule local zoning to get more homes built.', { growth: 0.5 }],
    ['districts', 'Fair Districts Act', -0.5, 0, 'Independent commissions to draw district maps.', {}],
    ['taxsimple', 'Tax Simplification Act', 1, 2, 'Fewer brackets and a bigger standard deduction.', { growth: 0.2, budget: -0.3 }],
    ['border', 'Border Security Act', 2, 1, 'More agents, more fencing and faster deportations.', { budget: -0.2 }],
    ['corptax', 'Corporate Tax Cut', 2, -1, 'Cut the corporate tax rate from 21% to 15%.', { growth: 0.5, budget: -0.8 }],
    ['redtape', 'Red Tape Reduction Act', 1.5, 0, 'Scrap a thousand federal regulations in one go.', { growth: 0.4 }],
    ['budget', 'Balanced Budget Act', 1.5, 1, 'Make deficits illegal except in wartime.', { growth: -0.4, budget: 1 }],
    ['police', 'Safe Streets Act', 1.5, 1, 'Federal money for 50,000 new police officers.', { budget: -0.3 }],
    ['energy', 'Energy Independence Act', 1, 1, 'Fast-track drilling, pipelines and nuclear plants.', { growth: 0.4, budget: 0.1 }],
    ['defence', 'Defence Modernisation Act', 1, 0, 'New ships, drones and cyber units for the armed forces.', { growth: 0.2, budget: -0.5 }],
    ['farms', 'Family Farms Act', 0.5, 0, 'Bigger subsidies and crop insurance for farmers.', { budget: -0.2 }],
    ['payrise', 'Members\' Pay Rise', 0, -4, 'A 20% pay rise for members of the House. Brave.', {}],
  ].map(([id, name, lean, pop, desc, econ]) => ({ id, name, lean, pop, desc, econ }));

  PB.billById = (id) => PB.BILLS.find((b) => b.id === id);

  // Three bills to choose from each quarter, skipping ones already passed this term.
  function newOffer() {
    const g = gov();
    let pool = PB.BILLS.filter((b) => !g.enacted.includes(b.id));
    if (pool.length < 3) pool = [...PB.BILLS];
    return shuffle(pool).slice(0, 3).map((b) => b.id);
  }

  // --- Divisions ----------------------------------------------------------------
  // A plan says how each party votes: `aye` is the chance its whips back the
  // motion and `rebel` the chance any one member defies them. Independents
  // have no whip and vote one by one with chance `free`.
  const ABSENT = 0.02;

  function divide(plan, c, expected = false) {
    const rows = [];
    PB.state.parties.forEach((p) => {
      const seats = p.seats[c];
      if (!seats) return;
      const row = { name: p.name, short: p.short, color: p.color, ayes: 0, noes: 0, absent: 0 };
      if (PB.isVacant(p)) {
        row.absent = seats;
      } else {
        const v = plan(p);
        const free = v.free !== undefined;
        if (expected) {
          const present = seats * (1 - ABSENT);
          row.ayes = present * (free ? v.free : v.aye * (1 - v.rebel) + (1 - v.aye) * v.rebel);
          row.noes = present - row.ayes;
          row.absent = seats - present;
        } else {
          const whipAye = !free && random() < v.aye;
          for (let i = 0; i < seats; i++) {
            if (random() < ABSENT) row.absent++;
            else if (free ? random() < v.free : whipAye !== (random() < v.rebel)) row.ayes++;
            else row.noes++;
          }
        }
      }
      rows.push(row);
    });
    return { chamber: c, rows, ayes: sum(rows, (r) => r.ayes), noes: sum(rows, (r) => r.noes), absent: sum(rows, (r) => r.absent) };
  }

  function billPlan(bill) {
    const g = gov();
    const ids = govIds();
    // Backbenchers get restless when the government is unpopular.
    const grumble = Math.max(0, 40 - g.approval) * 0.002;
    return (p) => {
      const dist = Math.abs(bill.lean - PB.leanOf(p));
      if (ids.has(p.id)) return { aye: 1, rebel: 0.01 + 0.06 * Math.max(0, dist - 1) + grumble };
      if (PB.isIndependent(p)) return { free: clamp(0.5 + bill.pop * 0.08 - Math.abs(bill.lean) * 0.1, 0.05, 0.95) };
      // Opposition whips weigh the bill against the urge to oppose the government.
      const score = 0.4 - dist + bill.pop * 0.25;
      return { aye: 1 / (1 + Math.exp(-2.2 * score)), rebel: 0.03 };
    };
  }

  function confidencePlan() {
    const g = gov();
    const members = PB.govInfo().members;
    const ids = govIds();
    return (p) => {
      if (ids.has(p.id)) return { aye: 0, rebel: Math.max(0, 45 - g.approval) * 0.004 };
      if (PB.isIndependent(p)) return { free: clamp((60 - g.approval) / 60, 0.1, 0.9) };
      // Parties close to the government are less keen to bring it down.
      const dist = Math.min(...members.map((m) => Math.abs(PB.leanOf(m) - PB.leanOf(p))));
      return { aye: dist >= 1 ? 0.9 : 0.55, rebel: 0.05 };
    };
  }

  // Rough whip count before a vote, so the player knows what they're risking.
  // Parties vote as a bloc, so each one is counted on its likelier side, and a
  // party that could go either way and would swing the result is named.
  // With two chambers the bill is only as safe as its shakier one.
  PB.forecast = (bill) => {
    const plan = billPlan(bill);
    const rank = { safe: 0, close: 1, fail: 2 };
    const chambers = PB.chambersInUse().map((c) => forecastIn(plan, c));
    const worst = chambers.reduce((a, f) => (rank[f.verdict] > rank[a.verdict] ? f : a));
    return { chambers, verdict: worst.verdict, swing: worst.swing };
  };

  function forecastIn(plan, c) {
    const side = (v, aye) => (v.free !== undefined ? v : { ...v, aye });
    const likely = (p) => side(plan(p), plan(p).aye >= 0.5 ? 1 : 0);
    const d = divide(likely, c, true);
    const margin = (d.ayes - d.noes) / Math.max(1, d.ayes + d.noes);
    const swing = PB.state.parties.find((p) => {
      if (!p.seats[c] || PB.isVacant(p)) return false;
      const v = plan(p);
      if (v.free !== undefined || v.aye < 0.25 || v.aye > 0.75) return false;
      const flipped = divide((q) => (q === p ? side(v, v.aye >= 0.5 ? 0 : 1) : likely(q)), c, true);
      return (flipped.ayes > flipped.noes) !== (d.ayes > d.noes);
    });
    const verdict = swing || Math.abs(margin) <= 0.06 ? 'close' : margin > 0 ? 'safe' : 'fail';
    return { chamber: c, ayes: Math.round(d.ayes), noes: Math.round(d.noes), verdict, swing };
  }

  PB.voteOnBill = (id) => {
    const g = gov();
    const bill = PB.billById(id);
    if (g.voted || !bill || !g.offer.includes(id) || !PB.govInfo().members.length) return null;
    // Bills start in the lower house and have to clear every chamber in use.
    const divisions = [];
    for (const c of PB.chambersInUse()) {
      const d = divide(billPlan(bill), c);
      d.passed = d.ayes > d.noes;
      divisions.push(d);
      if (!d.passed) break;
    }
    const passed = divisions.every((d) => d.passed);
    const both = PB.chambersInUse().length > 1;
    // Being blocked by the upper house stings less than losing in the lower.
    const blocked = !passed && divisions.length > 1;
    const outcome = passed
      ? both ? 'passed both houses' : 'passed'
      : blocked ? `was blocked in the ${PB.chamberName(1)}` : both ? `was defeated in the ${PB.chamberName(0)}` : 'was defeated';
    g.voted = true;
    g.lastVote = { title: bill.name, kind: 'bill', turn: g.turn, passed, outcome, divisions };
    if (passed) {
      g.enacted.push(id);
      g.record.passed = (g.record.passed || 0) + 1;
      nudge(bill.pop * 0.6);
      applyEconomy(bill.econ);
      earn('first-law');
      if (divisions.length > 1) earn('both-houses');
      if (id === 'payrise') earn('pay-rise');
    } else {
      g.record.failed = (g.record.failed || 0) + 1;
      nudge(blocked ? -1.5 : -3);
      if (blocked) earn('blocked');
    }
    log(`${bill.name} ${outcome} (${divisions.map((d) => `${d.ayes}–${d.noes}`).join(', ')}).`, passed ? 'good' : 'bad');
    return g.lastVote;
  };

  function confidenceVote() {
    const g = gov();
    const d = divide(confidencePlan(), 0);
    const passed = (d.passed = d.ayes > d.noes);
    const outcome = passed ? 'was carried: the government falls' : 'was defeated: the government survives';
    g.lastVote = { title: 'Motion of no confidence', kind: 'confidence', turn: g.turn, passed, outcome, divisions: [d], ayes: d.ayes, noes: d.noes };
    if (passed) log(`The government loses a confidence vote, ${d.ayes}–${d.noes}.`, 'bad');
    else {
      log(`The government survives a confidence vote, ${d.ayes}–${d.noes}.`, 'good');
      nudge(1);
      earn('survivor');
    }
    return g.lastVote;
  }

  // --- Approval and polling ---------------------------------------------------------
  function setApproval(v) {
    const g = gov();
    g.approval = clamp(v, 3, 97);
    g.history[g.history.length - 1] = Math.round(g.approval);
    if (g.approval >= 65) earn('beloved');
    if (g.approval <= 30) earn('tomatoes');
  }
  const nudge = (delta) => setApproval(gov().approval + delta);

  function log(text, kind = '') {
    const g = gov();
    g.log.unshift({ turn: g.turn, text, kind });
    if (g.log.length > 40) g.log.length = 40;
  }

  // Vote shares worked back from seats: under first-past-the-post seats go
  // with votes cubed, so take the cube root. Independents run their own races.
  function seatBase() {
    const parties = PB.state.parties.filter((p) => !PB.isVacant(p));
    const seatsOf = (p) => p.seats[0];
    const total = sum(parties, seatsOf) || 1;
    const power = POWER[gov().system];
    const base = {};
    let fixed = 0;
    parties.forEach((p) => {
      if (PB.isIndependent(p) || !seatsOf(p)) {
        base[p.id] = PB.isIndependent(p) ? seatsOf(p) / total : 0.01;
        fixed += base[p.id];
      }
    });
    const seated = parties.filter((p) => isParty(p) && seatsOf(p));
    const weight = sum(seated, (p) => seatsOf(p) ** (1 / power));
    seated.forEach((p) => (base[p.id] = (seatsOf(p) ** (1 / power) / weight) * Math.max(0, 1 - fixed)));
    return netOfLift(base);
  }

  // Take out the boost (or drag) the government gets from its current
  // approval, so the polls start out matching the shares given.
  function netOfLift(shares) {
    const ids = govIds();
    const lift = (gov().approval - NEUTRAL) * SWING;
    const parties = PB.state.parties.filter((p) => isParty(p) && p.id in shares);
    const govVotes = sum(parties.filter((p) => ids.has(p.id)), (p) => shares[p.id]);
    const oppVotes = sum(parties.filter((p) => !ids.has(p.id)), (p) => shares[p.id]);
    if (!govVotes || !oppVotes) return shares;
    parties.forEach((p) => {
      shares[p.id] *= ids.has(p.id) ? Math.max(0.01, govVotes - lift) / govVotes : Math.max(0.01, oppVotes + lift) / oppVotes;
    });
    return shares;
  }

  function ensureBase() {
    const g = gov();
    if (PB.state.parties.some((p) => !PB.isVacant(p) && !(p.id in g.base))) g.base = seatBase();
  }

  // The government's share swings with approval and wears down over the term,
  // the opposition splits what's left, and every party gets a little noise.
  PB.polls = () => {
    const g = gov();
    ensureBase();
    const ids = govIds();
    const voting = PB.state.parties.filter((p) => !PB.isVacant(p));
    const inGov = voting.filter((p) => isParty(p) && ids.has(p.id));
    const inOpp = voting.filter((p) => isParty(p) && !ids.has(p.id));
    const free = 1 - sum(voting.filter(PB.isIndependent), (p) => g.base[p.id]);
    const govBase = sum(inGov, (p) => g.base[p.id]);
    const oppBase = sum(inOpp, (p) => g.base[p.id]);
    const worn = FATIGUE * clamp(1 - (g.electionDue - g.turn) / g.termTurns, 0, 1);
    let govShare = govBase ? clamp(govBase + (g.approval - NEUTRAL) * SWING - worn, 0.02, free - 0.02) : 0;
    if (!oppBase) govShare = free;

    const rows = voting.map((p) => {
      let share = g.base[p.id];
      if (inGov.includes(p)) share = (share / govBase) * govShare;
      else if (inOpp.includes(p) && oppBase) share = (share / oppBase) * (free - govShare);
      return { party: p, share: Math.max(0.002, share + (g.noise[p.id] || 0) / 100) };
    });
    const total = sum(rows, (r) => r.share) || 1;
    rows.forEach((r) => (r.share /= total));
    return rows;
  };

  function allocate(weights, seats) {
    const total = sum(weights, (w) => w) || 1;
    const exact = weights.map((w) => (w / total) * seats);
    const out = exact.map(Math.floor);
    const order = exact.map((e, i) => [e - out[i], i]).sort((a, b) => b[0] - a[0]);
    for (let left = seats - sum(out, (n) => n), k = 0; left > 0 && order.length; left--, k++) out[order[k % order.length][1]]++;
    return out;
  }

  // Seats in chamber `c` from vote shares. Independents keep `indieSeats(p)`
  // seats, vacancies are filled, and the parties split everything else.
  function seatsFor(votes, c, indieSeats) {
    const out = new Map();
    let left = PB.totalSeats(c);
    votes.forEach((v) => {
      if (!PB.isIndependent(v.party)) return;
      const s = Math.min(left, indieSeats(v.party));
      out.set(v.party, s);
      left -= s;
    });
    const contest = votes.filter((v) => isParty(v.party));
    const won = allocate(contest.map((v) => v.share ** POWER[gov().system]), left);
    contest.forEach((v, i) => out.set(v.party, won[i]));
    return out;
  }

  // One map of party -> seats per chamber in use.
  PB.projection = (polls = PB.polls()) => PB.chambersInUse().map((c) => seatsFor(polls, c, (p) => p.seats[c]));

  // --- Elections ---------------------------------------------------------------------
  // Pick who governs: the old coalition if it still has the numbers, else a
  // single-party majority, else the smallest winning coalition of neighbours on
  // the left-right scale that includes the largest party. Parties too far apart
  // won't share a cabinet, so sometimes it's a minority government instead.
  const MAX_SPREAD = 2.5;

  PB.formGovernment = () => {
    const parties = PB.state.parties;
    const maj = PB.majority(PB.totalSeats(0));
    const seatsOf = (list) => sum(list, (p) => p.seats[0]);
    const regular = parties.filter((p) => p.seats[0] > 0 && isParty(p));
    const old = regular.filter((p) => p.coalition);
    const largest = [...regular].sort((a, b) => b.seats[0] - a.seats[0])[0];
    let chosen = [];
    if (old.length && seatsOf(old) >= maj) chosen = old;
    else if (largest && largest.seats[0] >= maj) chosen = [largest];
    else if (largest) {
      const line = [...regular].sort((a, b) => PB.leanOf(a) - PB.leanOf(b) || b.seats[0] - a.seats[0]);
      const at = line.indexOf(largest);
      let best = null;
      for (let i = 0; i <= at; i++) {
        for (let j = at; j < line.length && PB.leanOf(line[j]) - PB.leanOf(line[i]) <= MAX_SPREAD; j++) {
          const span = line.slice(i, j + 1);
          const s = seatsOf(span);
          if (s >= maj && (!best || span.length < best.length || (span.length === best.length && s < seatsOf(best)))) best = span;
        }
      }
      chosen = best || [largest];
    }
    const ids = new Set(chosen.map((p) => p.id));
    // Independents who sided with the old government stay with it if it carries on.
    const carryOn = chosen.some((p) => old.includes(p));
    parties.forEach((p) => (p.coalition = ids.has(p.id) || (PB.isIndependent(p) && p.coalition && carryOn)));
    return chosen;
  };

  function holdElection(snap) {
    const g = gov();
    // Polls are never quite right on the night.
    const votes = PB.polls().map((v) => ({ party: v.party, share: Math.max(0.001, v.share + rand(-0.02, 0.02)) }));
    if (!votes.some((v) => isParty(v.party))) return null;
    const total = sum(votes, (v) => v.share);
    votes.forEach((v) => (v.share /= total));

    const before = new Map(PB.state.parties.map((p) => [p, [...p.seats]]));
    const oldLabel = PB.govLabel();
    const oldLeader = PB.govInfo().leader;
    const chambers = PB.chambersInUse();
    // Every chamber in use is elected from the same national vote, but the
    // upper house has its own electorate, so its result can drift a little.
    chambers.forEach((c) => {
      const local = c ? votes.map((v) => ({ party: v.party, share: Math.max(0.001, v.share + rand(-UPPER_DRIFT, UPPER_DRIFT)) })) : votes;
      const won = seatsFor(local, c, (p) => (p.seats[c] ? Math.max(0, p.seats[c] + randInt(-1, 1)) : 0));
      PB.state.parties.forEach((p) => (p.seats[c] = won.get(p) || 0));
    });
    const chosen = PB.formGovernment();
    const after = PB.govInfo();
    if (oldLeader && after.leader) earn(after.leader === oldLeader ? 'reelected' : 'change');
    if (after.seats * 3 >= after.total * 2) earn('landslide');

    g.noise = {};
    g.byElections = [];
    g.enacted = [];
    g.record = { passed: 0, failed: 0 };
    g.electionDue = g.turn + g.termTurns;
    // A fresh government gets a honeymoon; a re-elected one, less so.
    setApproval(PB.govLabel() === oldLabel ? randInt(47, 53) : randInt(52, 60));
    g.base = netOfLift(Object.fromEntries(votes.map((v) => [v.party.id, v.share])));

    const results = chambers.map((c) => ({
      chamber: c,
      rows: PB.state.parties
        .filter((p) => p.seats[c] || before.get(p)[c])
        .map((p) => ({ name: p.name, short: p.short, seats: p.seats[c], change: p.seats[c] - before.get(p)[c] }))
        .sort((a, b) => b.seats - a.seats),
    }));
    const label = PB.govLabel();
    const sign = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');
    const line = (r) => r.rows.map((x) => `${x.short || x.name} ${x.seats} (${sign(x.change)})`).join(', ');
    const parts = results.map((r) => (results.length > 1 ? `${PB.chamberName(r.chamber)}: ${line(r)}` : line(r)));
    log(`${snap ? 'Snap election' : 'General election'}: ${parts.join('. ')}. ${label}.`, 'election');
    return { snap, results, label, formed: chosen.length > 0 };
  }

  // --- Cabinet --------------------------------------------------------------------------
  const POSTS = ['Prime Minister', 'Finance', 'Foreign Affairs', 'Home Affairs', 'Health', 'Defence'];
  const FIRST = ['Alex', 'Jordan', 'Maria', 'James', 'Priya', 'Daniel', 'Grace', 'Samuel', 'Elena', 'Marcus', 'Hannah', 'Luis', 'Olivia', 'Wei', 'Fatima', 'Thomas', 'Rachel', 'Andre', 'Nora', 'Kenji', 'Aisha', 'Connor', 'Sofia', 'Malik', 'Ingrid', 'Diego', 'Leah', 'Omar', 'Claire', 'Theo'];
  const LAST = ['Carter', 'Okafor', 'Nguyen', 'Hughes', 'Delgado', 'Brennan', 'Patel', 'Whitfield', 'Morales', 'Kowalski', 'Reyes', 'Lindqvist', 'Abernathy', 'Chen', 'Osei', 'Harlow', 'Sato', 'Mercer', 'Vance', 'Duarte', 'Fitzgerald', 'Haddad', 'Novak', 'Castillo', 'Bergman', 'Adeyemi', 'Sullivan', 'Moreau', 'Kaur', 'Blackwood'];
  const randomName = () => `${pick(FIRST)} ${pick(LAST)}`;

  // The biggest coalition party gets the top job; the rest go out by D'Hondt on seats.
  function cabinetPlan(members) {
    if (!members.length) return [];
    const sorted = [...members].sort((a, b) => b.seats[0] - a.seats[0]);
    const posts = new Map(sorted.map((p) => [p, 0]));
    const out = [sorted[0]];
    posts.set(sorted[0], 1);
    while (out.length < POSTS.length) {
      const next = sorted.reduce((best, p) => (p.seats[0] / (posts.get(p) + 1) > best.seats[0] / (posts.get(best) + 1) ? p : best));
      posts.set(next, posts.get(next) + 1);
      out.push(next);
    }
    return out.map((p) => p.id);
  }

  // Reshuffle when the government changes, keeping anyone whose post stays with their party.
  function syncCabinet() {
    const g = gov();
    const plan = cabinetPlan(PB.govInfo().members);
    if (plan.length === g.cabinet.length && plan.every((id, i) => g.cabinet[i].partyId === id)) return;
    g.cabinet = plan.map((partyId, i) => {
      const old = g.cabinet[i];
      if (old && old.partyId === partyId) return old;
      const p = PB.state.parties.find((x) => x.id === partyId);
      const leader = i === 0 && p.info.leaders.find((l) => l.name);
      return { post: POSTS[i], partyId, name: leader ? leader.name : randomName() };
    });
  }

  // --- Events ---------------------------------------------------------------------------
  // approval: [min, max] change. sack: the minister is replaced. growth, jobs
  // and budget work like a bill's economic effects. vacancy: a member leaves,
  // and ownGoal is an extra approval hit if they sat with the government.
  // Text can use {pm}, {minister}, {post}, {replacement}, {member}, {party} and {chamber}.
  PB.EVENTS = [
    { id: 'jobs', title: 'Strong jobs report', text: 'Hiring is way up and unemployment is falling fast.', approval: [1, 3], jobs: -0.4 },
    { id: 'recession', title: 'Recession fears', text: 'Two weak quarters in a row and the markets are jittery.', approval: [-3, -1], growth: -1.5 },
    { id: 'trade', title: 'Trade deal signed', text: 'A long-stalled trade agreement finally gets over the line.', approval: [1, 3], growth: 0.4 },
    { id: 'gaffe', title: 'Hot mic', text: '{pm} is caught calling a voter "a bit of a nightmare".', approval: [-3, -1] },
    { id: 'fuel', title: 'Fuel prices spike', text: 'Prices at the pump hit a record high.', approval: [-3, -1], growth: -0.5 },
    { id: 'leak', title: 'Leaked memo', text: 'An internal memo doubting the budget numbers ends up on every front page.', approval: [-4, -1] },
    { id: 'oppscandal', title: 'Opposition in trouble', text: 'The opposition leader gets caught up in a lobbying scandal.', approval: [1, 3] },
    { id: 'boom', title: 'Tech boom', text: 'A wave of new factories and startups lifts the mood.', approval: [0, 2], growth: 0.8 },
    { id: 'quiet', title: 'Quiet quarter', text: 'Nothing much happens. Bliss.', approval: [0, 0], weight: 3 },
    { id: 'resign', minister: true, title: 'Resignation', text: '{minister} ({post}) resigns to spend more time with family. {replacement} steps in.', approval: [-2, 0], sack: true },
    { id: 'mpquits', vacancy: true, title: 'Seat up for grabs', text: '{member} ({party}) quits the {chamber} to host a podcast. A by-election is on the way.' },
    { id: 'mpexpelled', vacancy: true, title: 'Member expelled', text: '{member} ({party}) is expelled from the {chamber} over a bribery scandal. A by-election is on the way.', ownGoal: [-3, -1] },
    {
      id: 'storm', title: 'Hurricane', text: 'A major hurricane makes landfall, flooding thousands of homes.',
      choices: [
        { label: 'Emergency aid package', approval: [1, 4], budget: -0.1, result: 'Aid arrives quickly and the government gets the credit.' },
        { label: 'Leave it to the states', approval: [-6, -1], result: 'Pictures of stranded families lead the news for weeks.' },
      ],
    },
    {
      id: 'strike', title: 'Rail strike', text: 'Rail workers walk out over pay and freight grinds to a halt.',
      choices: [
        { label: 'Negotiate', approval: [-1, 2], growth: -0.2, result: 'A deal is struck after a tense weekend of talks.' },
        { label: 'Order them back to work', approval: [-5, 2], growth: 0.2, result: 'The trains run again, but the unions are furious.' },
      ],
    },
    {
      id: 'summit', title: 'World summit', text: 'Leaders are meeting abroad to talk climate and trade.',
      choices: [
        { label: 'Attend', approval: [0, 3], result: '{pm} comes home with some photo ops and a joint statement.' },
        { label: 'Stay home and govern', approval: [-2, 1], result: 'Critics call it a snub. Most voters don\'t notice.' },
      ],
    },
    {
      id: 'cyber', title: 'Cyberattack', text: 'Hackers knock out the power grid across three states for a day.', growth: -0.3,
      choices: [
        { label: 'Blame a foreign power', approval: [-2, 4], result: 'The country rallies, at least until the evidence is questioned.' },
        { label: 'Announce an inquiry', approval: [0, 1], result: 'Sensible, if not exciting.' },
      ],
    },
    {
      id: 'outbreak', title: 'Outbreak', text: 'A nasty new flu strain is spreading fast.',
      choices: [
        { label: 'Close schools for a month', approval: [-4, 2], growth: -0.6, result: 'Parents grumble, but hospitals cope.' },
        { label: 'Keep everything open', approval: [-6, 3], growth: -0.2, result: 'A gamble. The next few weeks will tell.' },
      ],
    },
    {
      id: 'expenses', minister: true, title: 'Expenses scandal', text: '{minister} ({post}) billed taxpayers for a $40,000 home cinema.',
      choices: [
        { label: 'Sack them', approval: [-2, 0], sack: true, result: '{minister} is out and {replacement} takes over.' },
        { label: 'Stand by them', approval: [-7, 2], result: '{pm} backs {minister}. The story runs and runs.' },
      ],
    },
    {
      id: 'leaks', minister: true, title: 'Cabinet leaks', text: 'A tabloid claims {minister} ({post}) has been leaking cabinet secrets to a reporter.',
      choices: [
        { label: 'Sack them', approval: [-1, 1], sack: true, result: '{minister} denies everything on the way out. {replacement} gets the job.' },
        { label: 'Laugh it off', approval: [-4, 2], result: '{pm} calls it "total nonsense". Not everyone is convinced.' },
      ],
    },
  ];

  PB.eventById = (id) => PB.EVENTS.find((e) => e.id === id);

  function fill(text, ev) {
    const g = gov();
    const m = g.cabinet[ev.post];
    const p = PB.state.parties.find((x) => x.id === ev.party);
    const words = {
      pm: g.cabinet[0] ? g.cabinet[0].name : 'The Prime Minister',
      minister: m ? m.name : 'The minister',
      post: m ? m.post : 'cabinet',
      replacement: ev.replacement,
      member: ev.replacement,
      party: p ? p.short || p.name : 'independent',
      chamber: PB.chamberName(ev.chamber || 0),
    };
    return text.replace(/\{(\w+)\}/g, (all, k) => words[k] ?? all);
  }

  function applyEffect(effect, ev) {
    const [lo, hi] = effect.approval || [0, 0];
    let delta = randInt(lo, hi);
    const m = gov().cabinet[ev.post];
    if (effect.sack && m) m.name = ev.replacement;
    if (effect.vacancy) {
      if (effect.ownGoal && govIds().has(ev.party)) delta += randInt(...effect.ownGoal);
      makeVacancy(ev);
    }
    applyEconomy(effect);
    nudge(delta);
    return delta;
  }

  // A member leaves mid-term: their seat sits empty until a by-election.
  function makeVacancy(ev) {
    const g = gov();
    const p = PB.state.parties.find((x) => x.id === ev.party);
    if (!p || !p.seats[ev.chamber]) return;
    let vacant = PB.state.parties.find(PB.isVacant);
    if (!vacant) {
      vacant = PB.newParty({ name: 'Vacant', color: '#e0e0e0', seats: [0, 0], bench: 'crossbench' });
      PB.state.parties.push(vacant);
    }
    p.seats[ev.chamber]--;
    vacant.seats[ev.chamber]++;
    g.byElections.push({ chamber: ev.chamber, due: g.turn + randInt(1, 2), from: p.id });
  }

  // Pick a seat to empty: bigger chambers and bigger parties are likelier.
  function pickSeat() {
    const chambers = PB.chambersInUse().filter((c) => PB.totalSeats(c) > 0);
    let roll = random() * sum(chambers, (c) => PB.totalSeats(c));
    const chamber = chambers.find((c) => (roll -= PB.totalSeats(c)) < 0) ?? chambers[0];
    const held = PB.state.parties.filter((p) => !PB.isVacant(p) && p.seats[chamber] > 0);
    roll = random() * sum(held, (p) => p.seats[chamber]);
    const party = held.find((p) => (roll -= p.seats[chamber]) < 0) || held[0];
    return party ? { chamber, party: party.id } : null;
  }

  const moodOf = (delta) => (delta > 0 ? 'good' : delta < 0 ? 'bad' : '');

  function rollEvent() {
    const g = gov();
    const pool = PB.EVENTS.filter((e) => (!e.minister || g.cabinet.length > 1) && (!e.vacancy || PB.state.parties.some((p) => !PB.isVacant(p) && p.seats[0] > 0)));
    let roll = random() * sum(pool, (e) => e.weight || 1);
    const def = pool.find((e) => (roll -= e.weight || 1) < 0) || pool[0];
    const ev = { id: def.id, post: def.minister ? randInt(1, g.cabinet.length - 1) : -1, replacement: randomName(), ...(def.vacancy ? pickSeat() : {}) };
    const text = fill(def.text, ev);
    if (def.choices) {
      g.event = { ...ev, title: def.title, text };
      return { pending: true, title: def.title, text };
    }
    const delta = applyEffect(def, ev);
    log(`${def.title}: ${text}`, moodOf(delta));
    return { title: def.title, text, delta };
  }

  PB.resolveEvent = (i) => {
    const g = gov();
    const ev = g.event;
    const def = ev && PB.eventById(ev.id);
    g.event = null;
    const choice = def && def.choices && def.choices[i];
    if (!choice) return null;
    const text = fill(choice.result || '', ev);
    const delta = applyEffect(choice, ev);
    log(`${def.title}: ${choice.label.toLowerCase()}. ${text}`, moodOf(delta));
    return { title: def.title, text, delta };
  };

  // --- Economy ----------------------------------------------------------------------------
  // Growth is trend plus the business cycle plus the fading kick from recent
  // policy. The budget balance is what the laws set, moved by the cycle.
  function settle() {
    const e = gov().econ;
    e.unemployment = clamp(e.unemployment, 1.5, 25);
    e.growth = TREND + e.cycle + e.boost;
    e.balance = e.structural + 0.3 * (e.growth - TREND) - 0.2 * (e.unemployment - NATURAL);
    e.history[e.history.length - 1] = [e.growth, e.unemployment, e.balance].map((n) => Math.round(n * 10) / 10);
    if (e.growth >= 4) earn('boom');
    if (e.unemployment <= 3.5) earn('jobs');
    if (e.balance > 0) earn('surplus');
  }

  function applyEconomy(fx = {}) {
    const e = gov().econ;
    e.boost += fx.growth || 0;
    e.structural += fx.budget || 0;
    e.unemployment += fx.jobs || 0;
    settle();
  }

  // One quarter of economy. Returns how much it moves approval: voters feel
  // growth and jobs, and get twitchy once the deficit passes 5% of GDP.
  function stepEconomy() {
    const e = gov().econ;
    e.history.push(e.history[e.history.length - 1]);
    if (e.history.length > 80) e.history.shift();
    e.boost *= 0.7;
    e.cycle = e.cycle * 0.75 + rand(-0.8, 0.8);
    // Budgets get patched up (or blown out) over time, back towards a 3% deficit.
    e.structural += (-3 - e.structural) * 0.03;
    e.unemployment += 0.15 * (TREND - (TREND + e.cycle + e.boost)) + (NATURAL - e.unemployment) * 0.12;
    settle();
    return clamp(0.2 * (e.growth - TREND) - 0.3 * (e.unemployment - NATURAL) + Math.min(0, e.balance + 5) * 0.15, -1, 1);
  }

  // Labels for a bill's economic effects, for the bill cards.
  PB.billEconomy = (bill) => {
    const fx = bill.econ || {};
    const num = (n) => `${n > 0 ? '+' : '−'}${Math.abs(n)}`;
    const out = [];
    if (fx.growth) out.push({ text: `growth ${num(fx.growth)}`, good: fx.growth > 0, tip: 'A boost to growth that fades over a few quarters' });
    if (fx.jobs) out.push({ text: `unemployment ${num(fx.jobs)}`, good: fx.jobs < 0, tip: 'Change in the unemployment rate' });
    if (fx.budget) out.push({ text: `budget ${num(fx.budget)}%`, good: fx.budget > 0, tip: 'A lasting change to the budget balance, as a share of GDP' });
    return out;
  };

  // --- By-elections -----------------------------------------------------------------------
  // Keep one by-election queued for every vacant seat in the chambers in use.
  function syncByElections() {
    const g = gov();
    const inUse = PB.chambersInUse();
    [0, 1].forEach((c) => {
      const vacant = inUse.includes(c) ? sum(PB.state.parties.filter(PB.isVacant), (p) => p.seats[c]) : 0;
      const queued = g.byElections.filter((b) => b.chamber === c).sort((a, b) => b.due - a.due);
      queued.slice(0, Math.max(0, queued.length - vacant)).forEach((b) => g.byElections.splice(g.byElections.indexOf(b), 1));
      for (let i = queued.length; i < vacant; i++) g.byElections.push({ chamber: c, due: g.turn + randInt(1, 3), from: null });
    });
  }

  PB.byElectionsAhead = () => [...gov().byElections].sort((a, b) => a.due - b.due || a.chamber - b.chamber);

  // By-elections are a free hit at the government, and the old member's party
  // starts with a local head start.
  function byElection(be) {
    const c = be.chamber;
    const seat = PB.state.parties.find((p) => PB.isVacant(p) && p.seats[c] > 0);
    if (!seat || !PB.chambersInUse().includes(c)) return null;
    const ids = govIds();
    const from = PB.state.parties.find((p) => p.id === be.from && !PB.isVacant(p));
    const local = PB.polls().map((v) => ({
      party: v.party,
      share: v.share - (ids.has(v.party.id) ? 0.03 : 0) + (v.party === from ? 0.04 : 0) + rand(-0.08, 0.08),
    }));
    const winner = local.reduce((a, b) => (b.share > a.share ? b : a)).party;
    seat.seats[c]--;
    winner.seats[c]++;

    const name = winner.short || winner.name;
    const where = `the ${PB.chamberName(c)} by-election`;
    let text = `${name} wins ${where}.`;
    if (from === winner) text = `${name} holds the seat in ${where}.`;
    else if (from) text = `${name} takes a seat from ${from.short || from.name} in ${where}.`;
    let mood = '';
    if (from && from !== winner && ids.has(from.id)) {
      nudge(-1.5);
      mood = 'bad';
    } else if (ids.has(winner.id) && from !== winner) {
      nudge(1);
      mood = 'good';
      if (from) earn('upset');
    }
    log(text, mood);
    return { text, mood };
  }

  function runByElections() {
    const g = gov();
    const due = g.byElections.filter((b) => b.due <= g.turn);
    g.byElections = g.byElections.filter((b) => b.due > g.turn);
    return due.map(byElection).filter(Boolean);
  }

  // --- Achievements -----------------------------------------------------------------------
  PB.ACHIEVEMENTS = [
    ['first-law', '📜', 'First law', 'Pass a bill.'],
    ['both-houses', '🏛️', 'Through both houses', 'Get a bill through both chambers of a bicameral legislature.'],
    ['blocked', '🚧', 'The other place', 'Have a bill blocked by the upper house.'],
    ['pay-rise', '💸', 'Brass neck', 'Vote yourselves a pay rise, and win.'],
    ['survivor', '🛡️', 'Survivor', 'Survive a motion of no confidence.'],
    ['term', '🗓️', 'Full term', 'Govern all the way to a scheduled election.'],
    ['minority', '🧗', 'Against the odds', 'Reach a scheduled election as a minority government.'],
    ['reelected', '🔁', 'Four more years', 'Win re-election.'],
    ['change', '🔄', 'Time for a change', 'See the government change hands at an election.'],
    ['landslide', '🌊', 'Landslide', 'Come out of an election with two-thirds of the lower house.'],
    ['decade', '🎂', 'A decade in power', 'Keep the same party in charge for 10 years.'],
    ['upset', '📮', 'By-election upset', 'Take a seat off the opposition in a by-election.'],
    ['beloved', '⭐', 'Beloved', 'Reach 65% approval.'],
    ['tomatoes', '🍅', 'Rotten tomatoes', 'Sink to 30% approval.'],
    ['boom', '📈', 'Boom times', 'Hit 4% growth.'],
    ['jobs', '👷', 'Full employment', 'Get unemployment down to 3.5%.'],
    ['surplus', '⚖️', 'In the black', 'Run a budget surplus.'],
  ].map(([id, icon, name, desc]) => ({ id, icon, name, desc }));

  // Kept under their own key so they outlast resets, loads and new runs.
  const ACH_KEY = 'parliament-builder:achievements';
  let earned = {};
  try {
    const saved = JSON.parse(localStorage.getItem(ACH_KEY));
    if (saved && typeof saved === 'object') earned = saved;
  } catch (e) {
    /* storage blocked or corrupt: start with none */
  }
  let fresh = [];

  function earn(id) {
    if (earned[id]) return;
    earned[id] = PB.govDate(gov().turn);
    fresh.push(id);
    try {
      localStorage.setItem(ACH_KEY, JSON.stringify(earned));
    } catch (e) {
      /* ignore */
    }
  }

  PB.earnedAchievements = () => earned;
  // Achievements unlocked since the last call, for toasts.
  PB.takeNewAchievements = () => fresh.splice(0).map((id) => PB.ACHIEVEMENTS.find((a) => a.id === id));

  // How long the same party has led the government, for the decade achievement.
  function trackLeader() {
    const g = gov();
    const leader = PB.govInfo().leader;
    const id = leader ? leader.id : null;
    if (id !== g.govLeader) {
      g.govLeader = id;
      g.govSince = g.turn;
    } else if (id && g.turn - g.govSince >= 40) {
      earn('decade');
    }
  }

  // --- Turns --------------------------------------------------------------------------------
  // Fill in anything the sim needs from the parliament. Safe to call on every render.
  PB.syncGov = () => {
    const g = gov();
    if (!g.start) {
      const parties = PB.state.parties;
      g.start = { seats: Object.fromEntries(parties.map((p) => [p.id, [...p.seats]])), coalition: parties.filter((p) => p.coalition).map((p) => p.id) };
    }
    ensureBase();
    syncCabinet();
    syncByElections();
    trackLeader();
    if (g.event && !(PB.eventById(g.event.id) || {}).choices) g.event = null;
    g.offer = g.offer.filter((id) => PB.billById(id));
    if (!g.offer.length) g.offer = newOffer();
  };

  // A fresh run. With `rewind`, the parliament goes back to how it was when
  // the current run started, so replaying a seed retells the same story.
  PB.restartGov = (seed, rewind) => {
    const start = gov().start;
    if (rewind && start) {
      PB.state.parties.forEach((p) => {
        p.seats = start.seats[p.id] ? [...start.seats[p.id]] : [0, 0];
        p.coalition = start.coalition.includes(p.id);
      });
    }
    PB.state.gov = PB.newGov(String(seed || '').trim().toUpperCase() || undefined);
  };

  PB.govEndTurn = () => {
    const g = gov();
    if (g.event) return null;
    const out = {};
    g.turn++;
    g.history.push(Math.round(g.approval));
    if (g.history.length > 80) g.history.shift();
    // Approval drifts back towards neutral with a little wobble, and follows the economy.
    nudge((NEUTRAL - g.approval) * 0.1 + rand(-1.5, 1.5) + stepEconomy());
    for (const id in g.base) g.noise[id] = (g.noise[id] || 0) * 0.6 + rand(-1, 1);

    const info = PB.govInfo();
    const risk = !info.members.length ? 0 : info.isMajority ? (g.approval < 25 ? 0.15 : 0) : g.approval < 42 ? 0.2 : 0;
    if (g.turn >= g.electionDue) {
      if (info.members.length) earn('term');
      if (info.members.length && !info.isMajority) earn('minority');
      out.election = holdElection(false);
    } else if (random() < risk) {
      out.confidence = confidenceVote();
      if (out.confidence.passed) out.election = holdElection(true);
    }
    if (!out.election) {
      out.byElections = runByElections();
      out.event = rollEvent();
    }
    trackLeader();
    g.voted = false;
    g.offer = newOffer();
    return out;
  };

  // --- Rendering ------------------------------------------------------------------------------
  // Division chart for one chamber: the usual parliament drawing with seats
  // split into ayes, noes and not voting, titled with the chamber's verdict.
  // Westminster puts the ayes and noes on opposite benches.
  PB.renderDivisionSVG = (d, kind, state) => {
    const c = d.chamber;
    const verdict = kind === 'confidence' ? (d.passed ? 'carried' : 'defeated') : d.passed ? 'passed' : 'defeated';
    const seats = (n) => (c ? [0, n] : [n, 0]);
    const parties = [
      { name: 'Ayes', color: '#2e9e4f', seats: seats(d.ayes), bench: 'government' },
      { name: 'Not voting', color: '#c4c4c4', seats: seats(d.absent), bench: 'crossbench' },
      { name: 'Noes', color: '#c62828', seats: seats(d.noes), bench: 'opposition' },
    ];
    const chambers = state.chambers.map((ch, i) =>
      i === c ? { ...ch, name: `${ch.name || (c ? 'Upper house' : 'Lower house')}: ${verdict}`, title: true, legend: true, majority: false } : ch
    );
    return PB.renderParliamentSVG({ chambers, parties }, c);
  };

  PB.renderTallyHTML = (d) => `
    <table class="tally">
      <thead><tr><th>Party</th><th>Aye</th><th>No</th><th title="Not voting">Away</th></tr></thead>
      <tbody>${d.rows
        .map((r) => `<tr><td title="${esc(r.name)}"><span class="swatch" style="background:${esc(r.color)}"></span>${esc(r.name)}</td><td>${r.ayes}</td><td>${r.noes}</td><td>${r.absent}</td></tr>`)
        .join('')}</tbody>
    </table>`;

  PB.renderPollsHTML = () => {
    const polls = PB.polls().sort((a, b) => b.share - a.share);
    if (!polls.length) return '<p class="muted small">No parties to poll.</p>';
    const seats = PB.projection(polls);
    const two = seats.length > 1;
    const cls = two ? 'poll-row two' : 'poll-row';
    const heads = two
      ? `<span title="${esc(PB.chamberName(0))}">Lower</span><span title="${esc(PB.chamberName(1))}">Upper</span>`
      : '<span>Seats</span>';
    const top = polls[0].share;
    return `
      <div class="${cls} poll-headings muted"><span>Party</span><span></span><span>Vote</span>${heads}</div>
      ${polls
        .map(
          ({ party: p, share }) => `
      <div class="${cls}">
        <span class="poll-name" title="${esc(p.name)}"><span class="swatch" style="background:${esc(p.color)}"></span>${esc(p.name)}</span>
        <span class="poll-bar"><span style="width:${((share / top) * 100).toFixed(1)}%;background:${esc(p.color)}"></span></span>
        <b>${(share * 100).toFixed(1)}%</b>
        ${seats.map((m) => `<span>${m.get(p) ?? 0}</span>`).join('')}
      </div>`
        )
        .join('')}`;
  };

  // Sparkline of the last 40 values, with a dashed line at `mid`. The scale
  // always covers mid ± span so small wobbles don't look dramatic.
  function spark(values, mid, span, label, cls = 'trend') {
    const pts = values.slice(-40);
    const W = 300;
    const H = 64;
    const lo = Math.min(mid - span, ...pts) - span / 2;
    const hi = Math.max(mid + span, ...pts) + span / 2;
    const x = (i) => (pts.length > 1 ? (i / (pts.length - 1)) * W : W / 2);
    const y = (v) => (H - 4 - ((v - lo) / (hi - lo)) * (H - 8)).toFixed(1);
    const line = pts.length > 1 ? pts.map((v, i) => `${x(i).toFixed(1)},${y(v)}`).join(' ') : `0,${y(pts[0])} ${W},${y(pts[0])}`;
    return `<svg class="${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)} over the last ${pts.length} quarters">
      <line class="trend-mid" x1="0" x2="${W}" y1="${y(mid)}" y2="${y(mid)}"/>
      <polyline class="trend-line" points="${line}"/>
    </svg>`;
  }

  PB.renderTrendSVG = (history) => spark(history, 50, 10, 'Approval');

  PB.renderEconomyHTML = () => {
    const e = gov().econ;
    const col = (i) => e.history.map((h) => h[i]);
    const pct = (n) => `${n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}%`;
    const stat = (label, value, cls, i, mid, span, note = '') => `
      <div class="econ-stat">
        <span>${label}</span>
        <div><b class="${cls}">${value}</b>${note}</div>
        ${spark(col(i), mid, span, label, 'trend small')}
      </div>`;
    return `
      ${stat('Growth', pct(e.growth), e.growth >= TREND + 0.5 ? 'good' : e.growth < 0 ? 'bad' : '', 0, TREND, 1.5)}
      ${stat('Unemployment', pct(e.unemployment), e.unemployment <= NATURAL - 0.5 ? 'good' : e.unemployment >= 6 ? 'bad' : '', 1, NATURAL, 1.5)}
      ${stat(e.balance < 0 ? 'Deficit' : 'Surplus', pct(Math.abs(e.balance)), e.balance >= 0 ? 'good' : e.balance < -5 ? 'bad' : '', 2, 0, 3, '<small class="muted">of GDP</small>')}`;
  };

  PB.renderAchievementsHTML = () =>
    PB.ACHIEVEMENTS.map((a) => {
      const when = earned[a.id];
      return `
      <div class="ach${when ? ' got' : ''}">
        <span class="ach-icon" aria-hidden="true">${when ? a.icon : '🔒'}</span>
        <div><b>${esc(a.name)}</b><small>${esc(a.desc)}${when ? ` Unlocked ${esc(when)}.` : ''}</small></div>
      </div>`;
    }).join('');
})(window.PB);
