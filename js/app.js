// UI wiring: tabs, forms, live previews, import/export.
(function (PB) {
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = PB.esc;
  const st = () => PB.state;
  const partyById = (id) => st().parties.find((p) => p.id === id);

  PB.load();

  // --- Tabs --------------------------------------------------------------
  function showTab(name) {
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on);
    });
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
    try { localStorage.setItem('parliament-builder:tab', name); } catch (e) { /* ignore */ }
  }
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

  // --- Rendering -----------------------------------------------------------
  function renderParliament() {
    $('#parliament-svg').innerHTML = PB.renderParliamentSVG(st());
  }

  function renderStats() {
    const total = PB.totalSeats();
    const maj = PB.majority(total);
    const coal = PB.coalitionSeats();
    const coalParties = st().parties.filter((p) => p.coalition && p.seats > 0);
    const pct = (n) => (total ? (n / total) * 100 : 0);

    let coalHtml;
    if (!coalParties.length) {
      coalHtml = '<p class="muted small">Tick <b>Coalition</b> on some parties to test a government.</p>';
    } else {
      const ok = coal >= maj;
      const segs = coalParties.map((p) => `<div style="width:${pct(p.seats)}%;background:${esc(p.color)}" title="${esc(p.name)}: ${p.seats}"></div>`).join('');
      coalHtml = `
        <div class="coal-bar">${segs}<span class="coal-tick" style="left:${pct(maj)}%"></span></div>
        <p class="small"><b>${coal}</b> coalition seats ·
          <span class="${ok ? 'good' : 'bad'}">${ok ? `✓ majority of ${coal - (total - coal)}` : `short by ${maj - coal}`}</span></p>`;
    }

    $('#stats').innerHTML = `
      <div class="stat"><span>Total seats</span><b>${total}</b></div>
      <div class="stat"><span>Majority</span><b>${total ? maj : '–'}</b></div>
      <div class="stat"><span>Parties</span><b>${st().parties.filter((p) => p.seats > 0).length}</b></div>
      <div class="coal">${coalHtml}</div>`;
  }

  function renderInfoboxPreview() {
    const p = partyById(st().ibPartyId);
    $('#ib-preview').innerHTML = PB.renderInfobox(p, st());
    $('#ib-wikitext').value = PB.infoboxWikitext(p, st());
  }

  function refresh() {
    renderParliament();
    renderStats();
    renderInfoboxPreview();
    PB.save();
  }

  // --- Chamber settings ------------------------------------------------------
  const chamberFields = {
    '#leg-name': ['name', 'value'],
    '#leg-layout': ['layout', 'value'],
    '#leg-shape': ['shape', 'value'],
    '#leg-size': ['size', 'valueAsNumber'],
    '#leg-legend': ['legend', 'checked'],
    '#leg-majority': ['majority', 'checked'],
    '#leg-title': ['title', 'checked'],
  };

  function fillChamber() {
    const leg = st().legislature;
    for (const sel in chamberFields) {
      const [key, prop] = chamberFields[sel];
      $(sel)[prop] = leg[key];
    }
    syncLayoutClasses();
  }

  function syncLayoutClasses() {
    const wm = st().legislature.layout === 'westminster';
    document.body.classList.toggle('is-westminster', wm);
  }

  for (const sel in chamberFields) {
    const [key, prop] = chamberFields[sel];
    $(sel).addEventListener('input', (e) => {
      st().legislature[key] = e.target[prop];
      syncLayoutClasses();
      refresh();
    });
  }

  // --- Party list ------------------------------------------------------------
  const BENCHES = [
    ['auto', 'Bench: auto'],
    ['government', 'Government'],
    ['opposition', 'Opposition'],
    ['crossbench', 'Crossbench'],
    ['speaker', 'Speaker'],
  ];

  function renderPartyList() {
    const parties = st().parties;
    $('#party-list').innerHTML = parties.length
      ? parties
          .map(
            (p, i) => `
      <div class="party" data-id="${p.id}">
        <div class="party-main">
          <input type="color" data-f="color" value="${esc(p.color)}" aria-label="Party colour">
          <input type="text" data-f="name" value="${esc(p.name)}" placeholder="Party name" aria-label="Party name">
          <input type="number" data-f="seats" value="${p.seats}" min="0" step="1" aria-label="Seats">
        </div>
        <div class="party-sub">
          <input type="text" data-f="short" value="${esc(p.short)}" placeholder="Abbr." aria-label="Abbreviation" class="abbr">
          <label class="check"><input type="checkbox" data-f="coalition" ${p.coalition ? 'checked' : ''}> Coalition</label>
          <select data-f="bench" class="wm-only" aria-label="Westminster bench">
            ${BENCHES.map(([v, l]) => `<option value="${v}" ${p.bench === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          <span class="party-btns">
            <button type="button" class="icon" data-act="up" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="icon" data-act="down" title="Move down" ${i === parties.length - 1 ? 'disabled' : ''}>↓</button>
            <button type="button" class="icon" data-act="infobox" title="Edit infobox">ⓘ</button>
            <button type="button" class="icon danger" data-act="del" title="Delete party">✕</button>
          </span>
        </div>
      </div>`
          )
          .join('')
      : '<p class="muted small">No parties yet. Add one!</p>';
  }

  $('#party-list').addEventListener('input', (e) => {
    const el = e.target;
    const card = el.closest('.party');
    if (!card || !el.dataset.f) return;
    const p = partyById(card.dataset.id);
    const f = el.dataset.f;
    if (f === 'seats') p.seats = Math.max(0, Math.floor(el.valueAsNumber || 0));
    else if (f === 'coalition') p.coalition = el.checked;
    else p[f] = el.value;
    if (f === 'name' || f === 'color') renderIbSelect();
    refresh();
  });

  $('#party-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('.party').dataset.id;
    const list = st().parties;
    const i = list.findIndex((p) => p.id === id);
    const act = btn.dataset.act;
    if (act === 'up' && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
    if (act === 'down' && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
    if (act === 'del') {
      if (!confirm(`Delete "${list[i].name}"? Its infobox goes with it.`)) return;
      list.splice(i, 1);
    }
    if (act === 'infobox') {
      st().ibPartyId = id;
      renderIbSelect();
      renderIbForm();
      showTab('infobox');
    }
    renderPartyList();
    renderIbSelect();
    refresh();
  });

  $('#btn-add-party').addEventListener('click', () => {
    const used = new Set(st().parties.map((p) => p.color));
    const palette = ['#e4003b', '#0087dc', '#2e9e4f', '#f2b51d', '#6d2e8b', '#ff7f00', '#00a3a3', '#8b5a2b', '#d81b60', '#1a237e'];
    const color = palette.find((c) => !used.has(c)) || '#9aa0a6';
    st().parties.push(PB.newParty({ name: `Party ${st().parties.length + 1}`, color }));
    renderPartyList();
    renderIbSelect();
    refresh();
    const last = $('#party-list .party:last-child input[data-f="name"]');
    if (last) { last.focus(); last.select(); }
  });

  $('#btn-random').addEventListener('click', () => {
    if (st().parties.length && !confirm('Replace your parties with a random parliament? (Save a .json first if you want to keep them.)')) return;
    const total = [101, 150, 200, 299, 350, 450, 600, 650][Math.floor(Math.random() * 8)];
    st().parties = PB.randomParties(total);
    st().ibPartyId = st().parties[0].id;
    renderAll();
  });

  $('#sort-select').addEventListener('change', (e) => {
    const list = st().parties;
    if (e.target.value === 'seats') list.sort((a, b) => b.seats - a.seats);
    if (e.target.value === 'coalition') list.sort((a, b) => b.coalition - a.coalition);
    if (e.target.value === 'reverse') list.reverse();
    e.target.value = '';
    renderPartyList();
    refresh();
  });

  // --- Infobox editor ----------------------------------------------------------
  function renderIbSelect() {
    const sel = $('#ib-party');
    const parties = st().parties;
    if (!partyById(st().ibPartyId)) st().ibPartyId = parties[0] ? parties[0].id : null;
    sel.innerHTML = parties.map((p) => `<option value="${p.id}" ${p.id === st().ibPartyId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    sel.disabled = !parties.length;
  }

  $('#ib-party').addEventListener('change', (e) => {
    st().ibPartyId = e.target.value;
    renderIbForm();
    refresh();
  });

  const text = (k, label, ph = '') =>
    `<label>${label}<input type="text" data-k="${k}" placeholder="${esc(ph)}"></label>`;

  function renderIbForm() {
    const p = partyById(st().ibPartyId);
    const form = $('#ib-form');
    if (!p) {
      form.innerHTML = '<p class="muted small">Add a party on the Parliament tab first.</p>';
      return;
    }
    const info = p.info;
    const listRows = (list, key, fields) =>
      info[list]
        .map(
          (item, i) => `
        <div class="list-row" data-list="${list}" data-i="${i}">
          ${fields.map(([f, ph, type]) => `<input type="${type || 'text'}" data-lf="${f}" value="${esc(item[f])}" placeholder="${ph}" ${type === 'number' ? 'min="0"' : ''}>`).join('')}
          <button type="button" class="icon danger" data-remove="${list}" data-i="${i}" title="Remove">✕</button>
        </div>`
        )
        .join('');

    const logoIsData = info.logo.startsWith('data:');

    form.innerHTML = `
      <fieldset>
        <legend>Basics</legend>
        <div class="row2">
          <label>Party name<input type="text" data-pf="name"></label>
          <label>Colour<input type="color" data-pf="color"></label>
        </div>
        ${text('nativeName', 'Native name', 'optional, shown under the title')}
        ${text('abbreviation', 'Abbreviation')}
        <div class="field">Logo
          <div class="logo-row">
            <input type="text" data-k="logo" placeholder="Image URL…" ${logoIsData ? 'disabled value="(uploaded image)"' : ''}>
            <label class="btn small">Upload<input type="file" id="ib-logo-file" accept="image/*" hidden></label>
            ${info.logo ? '<button type="button" class="small" id="ib-logo-clear">Remove</button>' : ''}
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Leadership</legend>
        ${listRows('leaders', 'leaders', [['title', 'Title (e.g. Leader)'], ['name', 'Name']])}
        <button type="button" class="small" data-add="leaders">+ Add leader</button>
        ${text('founder', 'Founder')}
      </fieldset>

      <fieldset>
        <legend>History & organisation</legend>
        <div class="row2">${text('founded', 'Founded', '1 May 1990')}${text('dissolved', 'Dissolved')}</div>
        ${text('splitFrom', 'Split from')}
        ${text('headquarters', 'Headquarters')}
        <div class="row2">${text('newspaper', 'Newspaper')}${text('youthWing', 'Youth wing')}</div>
        ${text('membership', 'Membership', '50,000 (2026)')}
      </fieldset>

      <fieldset>
        <legend>Politics</legend>
        <label>Ideology <span class="muted">(one per line)</span><textarea data-k="ideology" rows="3"></textarea></label>
        ${text('position', 'Political position', 'Centre-left')}
        ${text('national', 'National affiliation')}
        ${text('international', 'International affiliation')}
        ${text('coloursName', 'Colours (name)', 'e.g. Red, Teal')}
        <div class="row2">${text('slogan', 'Slogan')}${text('anthem', 'Anthem')}</div>
      </fieldset>

      <fieldset>
        <legend>Seats</legend>
        <label class="check"><input type="checkbox" data-k="showLegislatureSeats"> Show seats in the parliament (${p.seats} / ${PB.totalSeats()})</label>
        ${listRows('extraSeats', 'extraSeats', [['title', 'e.g. Regional councillors'], ['seats', 'Seats', 'number'], ['total', 'Total', 'number']])}
        <button type="button" class="small" data-add="extraSeats">+ Add seat row</button>
      </fieldset>

      <fieldset>
        <legend>Extra</legend>
        ${listRows('custom', 'custom', [['label', 'Label'], ['value', 'Value']])}
        <button type="button" class="small" data-add="custom">+ Add custom row</button>
        ${text('website', 'Website', 'party.example')}
      </fieldset>`;

    // Fill values via properties so we never fight with HTML escaping.
    form.querySelectorAll('[data-pf]').forEach((el) => (el.value = p[el.dataset.pf]));
    form.querySelectorAll('[data-k]').forEach((el) => {
      const k = el.dataset.k;
      if (k === 'logo' && logoIsData) return;
      if (el.type === 'checkbox') el.checked = !!info[k];
      else el.value = info[k] ?? '';
    });
  }

  $('#ib-form').addEventListener('input', (e) => {
    const el = e.target;
    const p = partyById(st().ibPartyId);
    if (!p) return;
    if (el.dataset.pf) {
      p[el.dataset.pf] = el.value;
      renderPartyList();
      renderIbSelect();
    } else if (el.dataset.k) {
      p.info[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value;
    } else if (el.dataset.lf) {
      const row = el.closest('.list-row');
      const item = p.info[row.dataset.list][+row.dataset.i];
      item[el.dataset.lf] = el.type === 'number' ? Math.max(0, el.valueAsNumber || 0) : el.value;
    } else {
      return;
    }
    refresh();
  });

  $('#ib-form').addEventListener('click', (e) => {
    const p = partyById(st().ibPartyId);
    if (!p) return;
    const add = e.target.closest('[data-add]');
    const remove = e.target.closest('[data-remove]');
    if (add) {
      const blanks = { leaders: { title: '', name: '' }, extraSeats: { title: '', seats: 0, total: 100 }, custom: { label: '', value: '' } };
      p.info[add.dataset.add].push({ ...blanks[add.dataset.add] });
    } else if (remove) {
      p.info[remove.dataset.remove].splice(+remove.dataset.i, 1);
    } else if (e.target.id === 'ib-logo-clear') {
      p.info.logo = '';
    } else {
      return;
    }
    renderIbForm();
    refresh();
  });

  $('#ib-form').addEventListener('change', async (e) => {
    if (e.target.id !== 'ib-logo-file' || !e.target.files[0]) return;
    const p = partyById(st().ibPartyId);
    try {
      p.info.logo = await shrinkImage(e.target.files[0], 400);
      renderIbForm();
      refresh();
    } catch (err) {
      alert('Could not read that image.');
    }
  });

  // Keep uploaded logos small so they fit in localStorage and the JSON file.
  function shrinkImage(file, max) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const ratio = Math.min(1, max / Math.max(img.naturalWidth || max, img.naturalHeight || max));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round((img.naturalWidth || max) * ratio));
          canvas.height = Math.max(1, Math.round((img.naturalHeight || max) * ratio));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png'));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // --- Exports -------------------------------------------------------------------
  $('#dl-svg').addEventListener('click', () => {
    const svg = PB.renderParliamentSVG(st());
    PB.download(`${PB.slug(st().legislature.name)}.svg`, new Blob([svg], { type: 'image/svg+xml' }));
  });

  $('#dl-png').addEventListener('click', async () => {
    try {
      const blob = await PB.svgToPng(PB.renderParliamentSVG(st()), 2);
      PB.download(`${PB.slug(st().legislature.name)}.png`, blob);
    } catch (err) {
      alert(err.message);
    }
  });

  $('#ib-dl-png').addEventListener('click', async () => {
    const node = $('#ib-preview .wikibox');
    if (!node) return;
    if (!window.htmlToImage) {
      alert('The image export library didn\'t load (are you offline?). The wikitext export still works.');
      return;
    }
    try {
      const url = await window.htmlToImage.toPng(node, { pixelRatio: 2 });
      const blob = await (await fetch(url)).blob();
      PB.download(`${PB.slug(partyById(st().ibPartyId).name)}-infobox.png`, blob);
    } catch (err) {
      alert('PNG export failed. If your logo is a link to another site, try uploading the image instead.');
    }
  });

  $('#ib-copy').addEventListener('click', async () => {
    const ta = $('#ib-wikitext');
    try {
      await navigator.clipboard.writeText(ta.value);
    } catch (e) {
      ta.select();
      document.execCommand('copy');
    }
    const btn = $('#ib-copy');
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = 'Copy wikitext'), 1200);
  });

  // --- Save / load / reset -------------------------------------------------------------
  $('#btn-export-json').addEventListener('click', () => {
    PB.download(`${PB.slug(st().legislature.name)}.json`, new Blob([JSON.stringify(st(), null, 2)], { type: 'application/json' }));
  });

  $('#file-import').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        PB.state = PB.normalize(JSON.parse(reader.result));
        renderAll();
      } catch (err) {
        alert('That file doesn\'t look like a Parliament Builder save.');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('Reset everything back to the example parliament?')) return;
    PB.state = PB.sampleState();
    renderAll();
  });

  function renderAll() {
    fillChamber();
    renderPartyList();
    renderIbSelect();
    renderIbForm();
    refresh();
  }

  renderAll();
  try {
    const tab = localStorage.getItem('parliament-builder:tab');
    if (tab === 'infobox') showTab(tab);
  } catch (e) { /* ignore */ }
})(window.PB);
