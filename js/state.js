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

  PB.newParty = (overrides = {}) => ({
    id: PB.uid(),
    name: 'New Party',
    short: '',
    color: '#9aa0a6',
    seats: 10,
    coalition: false,
    bench: 'auto',
    ...overrides,
    info: { ...PB.blankInfo(), ...(overrides.info || {}) },
  });

  PB.sampleState = () => {
    const parties = [
      ['Democratic-Republican Party', 'DR', '#6a5acd', 134, false],
      ['Independent', 'IND', '#9e9e9e', 5, false],
      ['Vacant', '', '#e0e0e0', 3, false],
      ['Federalist Party', 'FED', '#f2dc6d', 293, true],
    ].map(([name, short, color, seats, coalition]) => PB.newParty({ name, short, color, seats, coalition }));

    // Keep vacant seats off both sides in the Westminster layout.
    parties[2].bench = 'crossbench';

    return {
      legislature: {
        name: 'NAU House of Representatives',
        layout: 'hemicycle',
        shape: 'circle',
        size: 85,
        legend: true,
        majority: true,
        title: true,
      },
      parties,
      ibPartyId: parties[3].id,
    };
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
  PB.normalize = (data) => {
    const base = PB.sampleState();
    const st = {
      legislature: { ...base.legislature, ...(data.legislature || {}) },
      parties: Array.isArray(data.parties) ? data.parties.map((p) => PB.newParty({ ...p, id: p.id || PB.uid() })) : base.parties,
      ibPartyId: data.ibPartyId,
    };
    st.parties.forEach((p) => {
      p.seats = Math.max(0, Math.floor(Number(p.seats) || 0));
      if (!Array.isArray(p.info.leaders)) p.info.leaders = [];
      if (!Array.isArray(p.info.extraSeats)) p.info.extraSeats = [];
      if (!Array.isArray(p.info.custom)) p.info.custom = [];
    });
    return st;
  };

  PB.totalSeats = () => PB.state.parties.reduce((a, p) => a + (p.seats || 0), 0);
  PB.majority = (total = PB.totalSeats()) => Math.floor(total / 2) + 1;
  PB.coalitionSeats = () => PB.state.parties.filter((p) => p.coalition).reduce((a, p) => a + (p.seats || 0), 0);

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

  PB.randomParties = (total) => {
    const n = 3 + Math.floor(Math.random() * 6);
    const usedNames = new Set();
    const colors = [...COLORS].sort(() => Math.random() - 0.5);
    // Squared random weights give a believable mix of big and small parties.
    const weights = Array.from({ length: n }, () => Math.random() ** 2 + 0.03);
    const sum = weights.reduce((a, b) => a + b, 0);
    const seats = weights.map((w) => Math.floor((w / sum) * total));
    seats[0] += total - seats.reduce((a, b) => a + b, 0);

    return seats.map((s, i) => {
      let name;
      do name = `${pick(PREFIX)} ${pick(SUFFIX)}`;
      while (usedNames.has(name));
      usedNames.add(name);
      const short = name.split(/\s+/).map((w) => w[0]).join('').toUpperCase();
      return PB.newParty({ name, short, color: colors[i % colors.length], seats: s });
    });
  };
})(window.PB);
