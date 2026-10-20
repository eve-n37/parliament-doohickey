// Shared state, storage and small helpers.
window.PB = window.PB || {};

(function (PB) {
  const STORAGE_KEY = 'parliament-builder:v1';

  PB.uid = () => Math.random().toString(36).slice(2, 10);

  PB.esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  PB.blankInfo = () => ({
    logo: '',
    nativeName: '',
    abbreviation: '',
    leaders: [{ title: 'Leader', name: '' }],
    founder: '',
    founded: '',
    dissolved: '',
    splitFrom: '',
    headquarters: '',
    newspaper: '',
    youthWing: '',
    membership: '',
    ideology: '',
    position: '',
    national: '',
    international: '',
    coloursName: '',
    slogan: '',
    anthem: '',
    website: '',
    showLegislatureSeats: true,
    extraSeats: [], // { title, seats, total }
    custom: [], // { label, value }
  });

  // Seats are stored per chamber: [lower (or only) chamber, upper chamber].
  // A plain number (older saves) means seats in the first chamber.
  const seatCount = (n) => Math.max(0, Math.floor(Number(n) || 0));
  PB.seatPair = (s) => (Array.isArray(s) ? [seatCount(s[0]), seatCount(s[1])] : [seatCount(s), 0]);

  PB.newParty = (overrides = {}) => {
    const p = {
      id: PB.uid(),
      name: 'New Party',
      short: '',
      color: '#9aa0a6',
      seats: [10, 0],
      coalition: false,
      bench: 'auto',
      ...overrides,
      info: { ...PB.blankInfo(), ...(overrides.info || {}) },
    };
    p.seats = PB.seatPair(p.seats);
    return p;
  };

  PB.newChamber = (overrides = {}) => ({
    name: 'New Chamber',
    layout: 'hemicycle',
    shape: 'circle',
    size: 85,
    legend: true,
    majority: true,
    title: true,
    ...overrides,
  });

  PB.sampleState = () => {
    // Seats are [House, Senate]. The Senate independent caucuses with the
    // Federalists, so it gets its own entry (and coalition tick) like on Wikipedia.
    const parties = [
      ['Democratic-Republican Party', 'DR', '#6a5acd', [134, 12], false],
      ['Independent', 'IND', '#9e9e9e', [5, 0], false],
      ['Vacant', '', '#e0e0e0', [3, 0], false],
      ['Independent (caucuses with the Federalists)', 'IND', '#cfc493', [0, 1], true],
      ['Federalist Party', 'FED', '#f2dc6d', [293, 53], true],
    ].map(([name, short, color, seats, coalition]) => PB.newParty({ name, short, color, seats, coalition }));

    // Keep vacant seats off both sides in the Westminster layout.
    parties[2].bench = 'crossbench';
    // Positions give the government sim something to whip on.
    parties[0].info.position = 'Centre-left';
    parties[4].info.position = 'Centre-right';

    return {
      system: 'bicameral',
      activeChamber: 0,
      chambers: [PB.newChamber({ name: 'NAU House of Representatives' }), PB.newChamber({ name: 'NAU Senate' })],
      parties,
      ibPartyId: parties[4].id,
      gov: PB.newGov(),
    };
  };

  // Government sim state. Turns are quarters; vote shares (base) and the
  // cabinet are filled in from the parliament when the sim first renders.
  PB.newGov = () => ({
    turn: 0,
    startYear: 2029,
    termTurns: 16,
    electionDue: 16,
    system: 'fptp',
    approval: 50,
    history: [50],
    base: {},
    noise: {},
    cabinet: [],
    offer: [],
    voted: false,
    enacted: [],
    record: { passed: 0, failed: 0 },
    event: null,
    lastVote: null,
    log: [],
  });

  PB.normalizeGov = (data) => {
    const base = PB.newGov();
    const g = { ...base, ...(data && typeof data === 'object' ? data : {}) };
    ['turn', 'startYear', 'termTurns', 'electionDue', 'approval'].forEach((k) => {
      g[k] = Number(g[k]);
      if (!Number.isFinite(g[k])) g[k] = base[k];
    });
    ['history', 'cabinet', 'offer', 'enacted', 'log'].forEach((k) => {
      if (!Array.isArray(g[k])) g[k] = [];
    });
    ['base', 'noise', 'record'].forEach((k) => {
      if (!g[k] || typeof g[k] !== 'object' || Array.isArray(g[k])) g[k] = base[k];
    });
    if (g.system !== 'pr') g.system = 'fptp';
    if (!g.history.length) g.history = [Math.round(g.approval)];
    g.cabinet = g.cabinet.filter((m) => m && typeof m.name === 'string');
    if (!g.event || typeof g.event.id !== 'string') g.event = null;
    if (!g.lastVote || !Array.isArray(g.lastVote.divisions)) g.lastVote = null;
    g.voted = !!g.voted;
    return g;
  };

  PB.state = null;

  PB.load = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        PB.state = PB.normalize(JSON.parse(raw));
        return;
      }
    } catch (e) {
      /* storage unavailable or corrupt: fall back to the sample */
    }
    PB.state = PB.sampleState();
  };

  let saveTimer = null;
  PB.save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(PB.state));
      } catch (e) {
        console.warn('Could not save to localStorage (big logos can hit the size limit).', e);
      }
    }, 250);
  };

  // Fill in missing fields so older/hand-edited JSON files still load.
  // Saves from before bicameral support have a single `legislature` object.
  PB.normalize = (data) => {
    const base = PB.sampleState();
    const chambers = Array.isArray(data.chambers) ? data.chambers : data.legislature ? [data.legislature] : [];
    const st = {
      system: data.system === 'bicameral' ? 'bicameral' : 'unicameral',
      activeChamber: data.activeChamber === 1 ? 1 : 0,
      chambers: [0, 1].map((c) => PB.newChamber({ ...base.chambers[c], ...(chambers[c] || {}) })),
      parties: Array.isArray(data.parties) ? data.parties.map((p) => PB.newParty({ ...p, id: p.id || PB.uid() })) : base.parties,
      ibPartyId: data.ibPartyId,
      gov: PB.normalizeGov(data.gov),
    };
    st.parties.forEach((p) => {
      if (!Array.isArray(p.info.leaders)) p.info.leaders = [];
      if (!Array.isArray(p.info.extraSeats)) p.info.extraSeats = [];
      if (!Array.isArray(p.info.custom)) p.info.custom = [];
    });
    return st;
  };

  // Chamber helpers. `c` is a chamber index; it defaults to the one being edited.
  PB.chambersInUse = (state = PB.state) => (state.system === 'bicameral' ? [0, 1] : [0]);
  PB.activeChamber = (state = PB.state) => (state.system === 'bicameral' ? state.activeChamber : 0);
  PB.chamber = (c = PB.activeChamber()) => PB.state.chambers[c];

  PB.totalSeats = (c = PB.activeChamber(), state = PB.state) => state.parties.reduce((a, p) => a + p.seats[c], 0);
  PB.majority = (total = PB.totalSeats()) => Math.floor(total / 2) + 1;
  PB.coalitionSeats = (c = PB.activeChamber()) => PB.state.parties.filter((p) => p.coalition).reduce((a, p) => a + p.seats[c], 0);

  PB.benchOf = (p) => (p.bench && p.bench !== 'auto' ? p.bench : p.coalition ? 'government' : 'opposition');

  PB.download = (filename, blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  PB.slug = (s) => String(s || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export';

  // Readable text colour on top of a background colour.
  PB.textOn = (hex) => {
    const [r, g, b] = PB.hexToRgb(hex);
    return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#202122' : '#ffffff';
  };

  PB.hexToRgb = (hex) => {
    let h = String(hex || '#888').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  // Mix a colour with white; amount 0..1 is how much of the colour to keep.
  PB.tint = (hex, amount) => {
    const [r, g, b] = PB.hexToRgb(hex);
    const m = (c) => Math.round(255 - (255 - c) * amount).toString(16).padStart(2, '0');
    return `#${m(r)}${m(g)}${m(b)}`;
  };

  // --- Random fictional parliament ------------------------------------
  const PREFIX = ['People\'s', 'Green', 'Liberal', 'Progressive', 'National', 'Pirate', 'Workers\'', 'Christian Democratic', 'Free', 'Agrarian', 'Social', 'Conservative', 'Radical', 'United', 'Democratic', 'Regionalist', 'Federal', 'Animal Welfare', 'Republican', 'Civic'];
  const SUFFIX = ['Party', 'Union', 'Alliance', 'Front', 'Movement', 'League', 'Coalition', 'Congress', 'Forum', 'Bloc'];
  const COLORS = ['#e4003b', '#0087dc', '#2e9e4f', '#f2b51d', '#6d2e8b', '#ff7f00', '#00a3a3', '#8b5a2b', '#d81b60', '#1a237e', '#7cb342', '#333333', '#ab47bc', '#00bcd4', '#c62828', '#5d4037'];

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // totals = [lower seats, upper seats]. The upper chamber gets a shuffled-up
  // version of the same weights so the two houses look related but not identical.
  PB.randomParties = (totals) => {
    const n = 3 + Math.floor(Math.random() * 6);
    const usedNames = new Set();
    const colors = [...COLORS].sort(() => Math.random() - 0.5);
    // Squared random weights give a believable mix of big and small parties.
    const weights = Array.from({ length: n }, () => Math.random() ** 2 + 0.03);
    const split = (ws, total) => {
      const sum = ws.reduce((a, b) => a + b, 0);
      const out = ws.map((w) => Math.floor((w / sum) * total));
      out[0] += total - out.reduce((a, b) => a + b, 0);
      return out;
    };
    const lower = split(weights, totals[0]);
    const upper = split(weights.map((w) => w * (0.5 + Math.random())), totals[1]);

    return lower.map((s, i) => {
      let name;
      do name = `${pick(PREFIX)} ${pick(SUFFIX)}`;
      while (usedNames.has(name));
      usedNames.add(name);
      const short = name.split(/\s+/).map((w) => w[0]).join('').toUpperCase();
      return PB.newParty({ name, short, color: colors[i % colors.length], seats: [s, upper[i]] });
    });
  };
})(window.PB);
