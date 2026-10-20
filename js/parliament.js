// Seat layout algorithms and SVG rendering for the parliament chart.
(function (PB) {
  const SWEEP = { hemicycle: 180, horseshoe: 250, circle: 360 };

  // Arc layouts (hemicycle / horseshoe / circle).
  // Seats sit on concentric rows between an inner radius and 1. We pick the
  // fewest rows that fit everyone, share seats between rows by circumference,
  // then sort every seat by angle so each party gets a clean wedge.
  function arcLayout(total, sweepDeg) {
    const full = sweepDeg >= 360;
    const sweep = (sweepDeg * Math.PI) / 180;
    const inner = full ? 0.35 : 0.4;

    let rows;
    let spacing;
    for (let n = 1; ; n++) {
      spacing = (1 - inner) / n;
      rows = [];
      let cap = 0;
      for (let i = 0; i < n; i++) {
        const r = inner + spacing * (i + 0.5);
        const c = Math.floor((sweep * r) / spacing) + (full ? 0 : 1);
        rows.push({ r, cap: c, n: 0 });
        cap += c;
      }
      if (cap >= total) break;
    }

    // Largest-remainder split, proportional to row radius, capped per row.
    const sumR = rows.reduce((a, row) => a + row.r, 0);
    let assigned = 0;
    rows.forEach((row) => {
      row.exact = (total * row.r) / sumR;
      row.n = Math.min(row.cap, Math.floor(row.exact));
      assigned += row.n;
    });
    while (assigned < total) {
      let best = null;
      for (const row of rows) {
        if (row.n < row.cap && (!best || row.exact - row.n > best.exact - best.n)) best = row;
      }
      best.n++;
      assigned++;
    }

    const start = Math.PI / 2 + sweep / 2;
    const seats = [];
    rows.forEach((row) => {
      const k = row.n;
      for (let j = 0; j < k; j++) {
        const t = k === 1 ? (full ? 0 : 0.5) : full ? j / k : j / (k - 1);
        const a = start - sweep * t;
        seats.push({ a, r: row.r, x: row.r * Math.cos(a), y: -row.r * Math.sin(a) });
      }
    });
    seats.sort((p, q) => q.a - p.a || p.r - q.r);

    return { seats, spacing, inner, full };
  }

  // Westminster layout: speaker on the left, government benches on top,
  // opposition below, crossbenches at the far end. Units are seat spacings.
  function westminsterLayout(counts) {
    const aisle = 1.5;
    const side = Math.max(counts.government, counts.opposition, 1);
    const rows = Math.max(1, Math.ceil(Math.sqrt(side / 5)));

    const block = (count, dir) => {
      const out = [];
      for (let s = 0; s < count; s++) {
        const col = Math.floor(s / rows);
        const row = s % rows;
        out.push({ x: col, y: dir * (aisle / 2 + 0.5 + row) });
      }
      return out;
    };

    const government = block(counts.government, -1);
    const opposition = block(counts.opposition, 1);
    const cols = Math.max(Math.ceil(counts.government / rows), Math.ceil(counts.opposition / rows), 1);

    const speaker = [];
    for (let s = 0; s < counts.speaker; s++) {
      speaker.push({ x: -2, y: (s - (counts.speaker - 1) / 2) * 1.1 });
    }

    const crossHeight = 2 * rows + 1;
    const top = -(aisle / 2 + rows - 0.5);
    const step = crossHeight > 1 ? (2 * -top) / (crossHeight - 1) : 0;
    const crossbench = [];
    for (let s = 0; s < counts.crossbench; s++) {
      const col = Math.floor(s / crossHeight);
      const row = s % crossHeight;
      crossbench.push({ x: cols + 1.5 + col, y: top + row * step });
    }

    return { speaker, government, opposition, crossbench };
  }

  // Returns seats as [{x, y, party}] in unit coords plus the seat radius.
  // `parties` here carry a plain seat count for this chamber.
  PB.computeSeats = (leg, allParties) => {
    const parties = allParties.filter((p) => p.seats > 0);
    const sizeFactor = (leg.size || 85) / 100;

    if (leg.layout === 'westminster') {
      const groups = { speaker: [], government: [], opposition: [], crossbench: [] };
      parties.forEach((p) => groups[PB.benchOf(p)].push(p));
      const counts = {};
      for (const k in groups) counts[k] = groups[k].reduce((a, p) => a + p.seats, 0);
      const layout = westminsterLayout(counts);
      const seats = [];
      for (const k in groups) {
        let i = 0;
        groups[k].forEach((p) => {
          for (let s = 0; s < p.seats; s++) seats.push({ ...layout[k][i++], party: p });
        });
      }
      return { seats, dot: 0.45 * sizeFactor, kind: 'westminster' };
    }

    const total = parties.reduce((a, p) => a + p.seats, 0);
    if (!total) return { seats: [], dot: 0, kind: 'arc' };
    const { seats, spacing, inner, full } = arcLayout(total, SWEEP[leg.layout] || 180);
    let i = 0;
    parties.forEach((p) => {
      for (let s = 0; s < p.seats; s++) seats[i++].party = p;
    });
    return { seats, dot: spacing * 0.46 * sizeFactor, kind: 'arc', spacing, inner, full, total };
  };

  // Draws one chamber (index `c`, default: the one being edited).
  PB.renderParliamentSVG = (state, c = PB.activeChamber(state)) => {
    const leg = state.chambers[c];
    const parties = state.parties.map((p) => ({ ...p, seats: p.seats[c] }));
    const esc = PB.esc;
    const layout = PB.computeSeats(leg, parties);
    const { seats, dot } = layout;
    const W = 640;
    const pad = 20;
    const font = 'font-family="Helvetica, Arial, sans-serif"';
    const ink = '#202122';

    if (!seats.length) {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 200" width="${W}" height="200"><text x="${W / 2}" y="100" text-anchor="middle" ${font} font-size="16" fill="#72777d">Give some parties seats in this chamber to see it</text></svg>`;
    }

    // Fit the seats to the drawing width.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    seats.forEach((s) => {
      minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
      minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y);
    });
    minX -= dot; maxX += dot; minY -= dot; maxY += dot;
    if (layout.kind === 'arc' && !layout.full) maxY = Math.max(maxY, 0.08); // room for the seat count
    const scale = (W - pad * 2) / Math.max(maxX - minX, 0.001);
    const chartH = (maxY - minY) * scale;
    const titleH = leg.title && leg.name ? 40 : 0;
    const ox = pad - minX * scale;
    const oy = pad + titleH - minY * scale;
    const X = (x) => +(ox + x * scale).toFixed(2);
    const Y = (y) => +(oy + y * scale).toFixed(2);
    const r = +(dot * scale).toFixed(2);

    const parts = [];
    if (titleH) {
      parts.push(`<text x="${W / 2}" y="${pad + 18}" text-anchor="middle" ${font} font-size="20" font-weight="bold" fill="${ink}">${esc(leg.name)}</text>`);
    }

    // Seats, grouped per party so the SVG stays tidy and editable.
    const byParty = new Map();
    seats.forEach((s) => {
      if (!byParty.has(s.party)) byParty.set(s.party, []);
      byParty.get(s.party).push(s);
    });
    byParty.forEach((list, p) => {
      const shapes = list.map((s) =>
        leg.shape === 'square'
          ? `<rect x="${(X(s.x) - r).toFixed(2)}" y="${(Y(s.y) - r).toFixed(2)}" width="${(r * 2).toFixed(2)}" height="${(r * 2).toFixed(2)}" rx="${(r * 0.25).toFixed(2)}"/>`
          : `<circle cx="${X(s.x)}" cy="${Y(s.y)}" r="${r}"/>`
      );
      parts.push(`<g fill="${esc(p.color)}"><title>${esc(p.name)} (${p.seats})</title>${shapes.join('')}</g>`);
    });

    if (layout.kind === 'arc') {
      const total = layout.total;
      const cy = layout.full ? Y(0) + 12 : Y(0) - 6;
      parts.push(`<text x="${X(0)}" y="${cy}" text-anchor="middle" ${font} font-size="${layout.full ? 34 : 40}" font-weight="bold" fill="${ink}">${total}</text>`);

      // Seats are sorted by angle, so the majority line is a clean radial cut.
      const m = PB.majority(total);
      if (leg.majority && total > 1 && m < total) {
        const a = (seats[m - 1].a + seats[m].a) / 2;
        const r0 = layout.inner - layout.spacing * 0.35;
        const r1 = 1 + layout.spacing * 0.35;
        parts.push(`<line x1="${X(r0 * Math.cos(a))}" y1="${Y(-r0 * Math.sin(a))}" x2="${X(r1 * Math.cos(a))}" y2="${Y(-r1 * Math.sin(a))}" stroke="${ink}" stroke-width="1.5" stroke-dasharray="5 4" opacity="0.7"/>`);
      }
    }

    let H = titleH + chartH + pad * 2;

    if (leg.legend) {
      const items = parties.filter((p) => p.seats > 0);
      const cols = items.length > 4 ? 2 : 1;
      const colW = (W - pad * 2) / cols;
      const rowH = 24;
      const top = H - pad + 16;
      items.forEach((p, i) => {
        const cx = pad + (i % cols) * colW;
        const cy = top + Math.floor(i / cols) * rowH;
        const label = p.short ? `${p.name} (${p.short})` : p.name;
        parts.push(
          `<rect x="${cx}" y="${cy}" width="14" height="14" rx="3" fill="${esc(p.color)}"/>` +
            `<text x="${cx + 22}" y="${cy + 12}" ${font} font-size="14" fill="${ink}">${esc(label)}: <tspan font-weight="bold">${p.seats}</tspan></text>`
        );
      });
      H = top + Math.ceil(items.length / cols) * rowH + pad - 8;
    }

    H = Math.ceil(H);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${parts.join('')}</svg>`;
  };

  PB.svgToPng = (svg, scale = 2, background = '#ffffff') =>
    new Promise((resolve, reject) => {
      const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
      const w = m ? +m[1] : 640;
      const h = m ? +m[2] : 400;
      const img = new Image();
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext('2d');
        if (background) {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png');
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not render SVG'));
      };
      img.src = url;
    });
})(window.PB);
