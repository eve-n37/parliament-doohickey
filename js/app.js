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

  // --- Theme ---------------------------------------------------------------
  // Follows the system until the user picks one; the choice is applied early in
  // index.html so the page doesn't flash.
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const currentTheme = () => document.documentElement.dataset.theme || (darkQuery.matches ? 'dark' : 'light');

  function syncThemeButton() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    const btn = $('#btn-theme');
    btn.textContent = next === 'dark' ? '🌙' : '☀️';
    btn.title = `Switch to ${next} mode`;
    btn.setAttribute('aria-label', btn.title);
  }

  $('#btn-theme').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('parliament-builder:theme', next); } catch (e) { /* ignore */ }
    syncThemeButton();
  });
  darkQuery.addEventListener('change', syncThemeButton);
  syncThemeButton();

  // --- Rendering -----------------------------------------------------------
  function renderParliament() {
    $('#parliament-svg').innerHTML = PB.renderParliamentSVG(st());
  }

  function renderStats() {
    const c = PB.activeChamber();
    const total = PB.totalSeats();
    const maj = PB.majority(total);
    const coal = PB.coalitionSeats();
    const coalParties = st().parties.filter((p) => p.coalition && p.seats[c] > 0);
    const pct = (n) => (total ? (n / total) * 100 : 0);

    let coalHtml;
    if (!coalParties.length) {
      coalHtml = '<p class="muted small">Tick <b>Coalition</b> on some parties to test a government.</p>';
    } else {
      const ok = coal >= maj;
      const segs = coalParties.map((p) => `<div style="width:${pct(p.seats[c])}%;background:${esc(p.color)}" title="${esc(p.name)}: ${p.seats[c]}"></div>`).join('');
      coalHtml = `
        <div class="coal-bar">${segs}<span class="coal-tick" style="left:${pct(maj)}%"></span></div>
        <p class="small"><b>${coal}</b> coalition seats ·
          <span class="${ok ? 'good' : 'bad'}">${ok ? `✓ majority of ${coal - (total - coal)}` : `short by ${maj - coal}`}</span></p>`;
    }

    $('#stats').innerHTML = `
      <div class="stat"><span>Total seats</span><b>${total}</b></div>
      <div class="stat"><span>Majority</span><b>${total ? maj : '–'}</b></div>
      <div class="stat"><span>Parties</span><b>${st().parties.filter((p) => p.seats[c] > 0).length}</b></div>
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
    renderGov();
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
    const leg = PB.chamber();
    for (const sel in chamberFields) {
      const [key, prop] = chamberFields[sel];
      $(sel)[prop] = leg[key];
    }
    syncLayoutClasses();
    syncChamberSwitch();
  }

  function syncLayoutClasses() {
    document.body.classList.toggle('is-westminster', PB.chamber().layout === 'westminster');
    document.body.classList.toggle('is-bicameral', st().system === 'bicameral');
  }

  function syncChamberSwitch() {
    document.querySelectorAll('[data-system]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.system === st().system));
    document.querySelectorAll('[data-chamber]').forEach((b) => {
      const c = +b.dataset.chamber;
      b.querySelector('span').textContent = st().chambers[c].name || (c ? 'Upper house' : 'Lower house');
      b.classList.toggle('active', c === PB.activeChamber());
      b.setAttribute('aria-selected', c === PB.activeChamber());
    });
  }

  for (const sel in chamberFields) {
    const [key, prop] = chamberFields[sel];
    $(sel).addEventListener('input', (e) => {
      PB.chamber()[key] = e.target[prop];
      syncLayoutClasses();
      if (key === 'name') syncChamberSwitch();
      refresh();
    });
  }

  // --- Unicameral / bicameral -------------------------------------------------
  // Switching to unicameral keeps the upper house's data, it's just hidden.
  document.querySelectorAll('[data-system]').forEach((b) =>
    b.addEventListener('click', () => {
      if (st().system === b.dataset.system) return;
      st().system = b.dataset.system;
      renderAll();
    })
  );

  document.querySelectorAll('[data-chamber]').forEach((b) =>
    b.addEventListener('click', () => {
      st().activeChamber = +b.dataset.chamber;
      fillChamber();
      renderPartyList();
      refresh();
    })
  );

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
          <input type="number" data-f="seats" value="${p.seats[PB.activeChamber()]}" min="0" step="1" aria-label="Seats in ${esc(PB.chamber().name)}">
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
    if (f === 'seats') p.seats[PB.activeChamber()] = Math.max(0, Math.floor(el.valueAsNumber || 0));
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
      const [removed] = list.splice(i, 1);
      offerUndo(removed, i, st().ibPartyId === id);
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

  // Put a deleted party back where it was. Skipped if the party list has since
  // been swapped out (random, reset or load), so it can't leak into a new setup.
  let undoToasts = [];

  function offerUndo(party, index, wasInfoboxParty) {
    const list = st().parties;
    const dismiss = PB.notify(`Deleted "${party.name}".`, 'info', 7000, {
      label: 'Undo',
      onClick: () => {
        if (st().parties !== list || list.some((p) => p.id === party.id)) return;
        list.splice(Math.min(index, list.length), 0, party);
        if (wasInfoboxParty) st().ibPartyId = party.id;
        renderPartyList();
        renderIbSelect();
        renderIbForm();
        refresh();
      },
    });
    undoToasts.push(dismiss);
  }

  $('#btn-add-party').addEventListener('click', () => {
    const used = new Set(st().parties.map((p) => p.color));
    const palette = ['#e4003b', '#0087dc', '#2e9e4f', '#f2b51d', '#6d2e8b', '#ff7f00', '#00a3a3', '#8b5a2b', '#d81b60', '#1a237e'];
    const color = palette.find((c) => !used.has(c)) || '#9aa0a6';
    const seats = [0, 0];
    seats[PB.activeChamber()] = 10;
    st().parties.push(PB.newParty({ name: `Party ${st().parties.length + 1}`, color, seats }));
    renderPartyList();
    renderIbSelect();
    refresh();
    const last = $('#party-list .party:last-child input[data-f="name"]');
    if (last) { last.focus(); last.select(); }
  });

  $('#btn-random').addEventListener('click', () => {
    replaceWithUndo('Rolled a random parliament.', () => {
      const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
      st().parties = PB.randomParties([pick([101, 150, 200, 299, 350, 450, 600, 650]), pick([50, 60, 75, 100, 150])]);
      st().ibPartyId = st().parties[0].id;
    });
  });

  $('#sort-select').addEventListener('change', (e) => {
    const list = st().parties;
    const c = PB.activeChamber();
    if (e.target.value === 'seats') list.sort((a, b) => b.seats[c] - a.seats[c]);
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
        <label class="check"><input type="checkbox" data-k="showLegislatureSeats"> Show seats in the legislature (${PB.chambersInUse().map((c) => `${p.seats[c]} / ${PB.totalSeats(c)}`).join(', ')})</label>
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
      PB.notify('Could not read that image.', 'error');
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

  // --- Government sim -------------------------------------------------------------
  const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');

  // News from the last action replaces the one before, so quick play doesn't
  // bury the screen in toasts.
  let govToasts = [];
  function govNews(...args) {
    govToasts.push(PB.notify(...args));
  }
  function clearGovNews() {
    govToasts.forEach((dismiss) => dismiss());
    govToasts = [];
  }

  function renderGov() {
    PB.syncGov();
    const g = st().gov;
    const info = PB.govInfo();
    renderGovStats(g, info);

    const rec = g.record;
    $('#gov-summary').innerHTML = info.members.length
      ? `<p><b>${esc(PB.govLabel(info))}</b></p>
         <p class="muted small">This term: ${rec.passed || 0} bill${rec.passed === 1 ? '' : 's'} passed, ${rec.failed || 0} defeated.</p>`
      : '<p class="muted small">Nobody is governing yet.</p>';

    $('#gov-quarter').textContent = `This quarter: ${PB.govDate(g.turn)}`;
    renderGovEvent(g);
    renderGovBills(g, info);
    const end = $('#gov-end-turn');
    end.disabled = !!g.event || !info.total;
    end.title = g.event ? 'Deal with the event first' : '';

    $('#gov-cabinet').innerHTML = g.cabinet.length
      ? g.cabinet
          .map((m, i) => {
            const p = partyById(m.partyId);
            return `
      <div class="minister">
        <span class="post">${esc(m.post)}</span>
        <input type="text" data-post="${i}" value="${esc(m.name)}" aria-label="${esc(m.post)}">
        <span class="small" title="${esc(p ? p.name : '')}"><span class="swatch" style="background:${esc(p ? p.color : '#ccc')}"></span>${esc(p ? p.short || p.name : '')}</span>
      </div>`;
          })
          .join('')
      : '<p class="muted small">The cabinet is formed from the governing parties.</p>';
    $('#gov-system').value = g.system;

    const vote = g.lastVote;
    const bicameral = PB.chambersInUse().length > 1;
    $('#gov-division').innerHTML = vote
      ? `<p class="division-head"><b>${esc(vote.title)}</b> ${esc(vote.outcome)}</p>
         <div class="divisions${vote.divisions.length > 1 ? ' two' : ''}">${vote.divisions.map((d) => PB.renderDivisionSVG(d, vote.kind, st())).join('')}</div>`
      : '<p class="muted small gov-empty">No votes yet. Put a bill to the House and the division shows up here.</p>';
    $('#gov-tally').innerHTML = vote
      ? `<div class="card"><h2>How they voted <span class="muted small">(${PB.govDate(vote.turn)})</span></h2>
         ${vote.divisions.map((d) => (bicameral ? `<h3 class="tally-head">${esc(PB.chamberName(d.chamber))}</h3>` : '') + PB.renderTallyHTML(d)).join('')}</div>`
      : '';
    $('#gov-polls').innerHTML = PB.renderPollsHTML();
    $('#gov-trend').innerHTML = PB.renderTrendSVG(g.history);
    $('#gov-log').innerHTML = g.log.length
      ? g.log
          .slice(0, 15)
          .map((l) => `<li class="${esc(l.kind)}"><span class="muted">${PB.govDate(l.turn)}</span> ${esc(l.text)}</li>`)
          .join('')
      : '<li class="muted">Nothing yet. Pick a bill or end the quarter to get going.</li>';
  }

  function renderGovStats(g, info) {
    const approval = Math.round(g.approval);
    const change = approval - (g.history.length > 1 ? g.history[g.history.length - 2] : approval);
    const left = g.electionDue - g.turn;
    const bars = PB.chambersInUse()
      .map((c) => govBar(c ? PB.govInfo(c) : info, c))
      .join('');
    $('#gov-stats').innerHTML = `
      <div class="stat"><span>Date</span><b>${PB.govDate(g.turn)}</b></div>
      <div class="stat"><span>Approval</span><b class="${approval >= 50 ? 'good' : approval < 35 ? 'bad' : ''}">${approval}%</b>${change ? `<small class="${change > 0 ? 'good' : 'bad'}">${change > 0 ? '▲' : '▼'}${Math.abs(change)}</small>` : ''}</div>
      <div class="stat"><span>Next election</span><b>${PB.govDate(g.electionDue - 1)}</b><small class="muted">${left <= 1 ? 'end of this quarter' : `${left} quarters left`}</small></div>
      <div class="coal">${bars}</div>`;
  }

  // Government seats against the majority line in one chamber.
  function govBar(info, c) {
    const pct = (n) => (info.total ? (n / info.total) * 100 : 0);
    const segs = info.members.map((p) => `<div style="width:${pct(p.seats[c])}%;background:${esc(p.color)}" title="${esc(p.name)}: ${p.seats[c]}"></div>`).join('');
    const where = PB.chambersInUse().length > 1 ? ` in the ${esc(PB.chamberName(c))}` : ' government seats';
    return `
        <div class="coal-bar">${segs}<span class="coal-tick" style="left:${pct(info.majority)}%"></span></div>
        <p class="small"><b>${info.seats}</b>${where} ·
          <span class="${info.isMajority ? 'good' : 'bad'}">${info.isMajority ? `majority of ${info.seats - (info.total - info.seats)}` : `short by ${info.majority - info.seats}`}</span></p>`;
  }

  function renderGovEvent(g) {
    const def = g.event && PB.eventById(g.event.id);
    $('#gov-event').innerHTML = def
      ? `<div class="gov-event">
          <b>⚡ ${esc(g.event.title)}</b>
          <p class="small">${esc(g.event.text)}</p>
          <div class="actions">${def.choices.map((c, i) => `<button type="button" class="small" data-choice="${i}">${esc(c.label)}</button>`).join('')}</div>
        </div>`
      : '';
  }

  const VERDICTS = { safe: ['good', 'looks safe'], close: ['', 'too close to call'], fail: ['bad', 'likely to fail'] };

  function renderGovBills(g, info) {
    const box = $('#gov-bills');
    if (!info.total) {
      box.innerHTML = '<p class="muted small">Add some parties with seats on the Parliament tab first.</p>';
    } else if (!info.members.length) {
      box.innerHTML = `
        <div class="bill">
          <p class="small">Tick <b>Coalition</b> on the governing parties in the Parliament tab, or let the largest party have a go.</p>
          <button type="button" id="gov-form" class="small">Form a government</button>
        </div>`;
    } else if (g.voted && g.lastVote) {
      const v = g.lastVote;
      box.innerHTML = `
        <div class="bill">
          <p><b class="${v.passed ? 'good' : 'bad'}">${v.passed ? '✓' : '✗'}</b> ${esc(v.title)} ${esc(v.outcome)} (${v.divisions.map((d) => `${d.ayes}–${d.noes}`).join(', ')}).</p>
          <p class="muted small">One bill per quarter. End the quarter to keep going.</p>
        </div>`;
    } else {
      box.innerHTML =
        `<p class="muted small">Pick one bill to put to the House, or skip straight to the end of the quarter.${
          PB.chambersInUse().length > 1 ? ` Bills have to pass the ${esc(PB.chamberName(1))} too.` : ''
        }</p>` +
        g.offer
          .map((id) => {
            const bill = PB.billById(id);
            const f = PB.forecast(bill);
            const [cls, label] = f.swing ? ['', `depends on the ${esc(f.swing.short || f.swing.name)}`] : VERDICTS[f.verdict];
            const mood = bill.pop >= 2 ? '👍 Popular' : bill.pop <= -1 ? '👎 Unpopular' : '🤷 Mixed';
            const two = f.chambers.length > 1;
            const count = f.chambers.map((x) => `${two ? (x.chamber ? 'upper ' : 'lower ') : ''}~${x.ayes}–${x.noes}`).join(', ');
            return `
        <div class="bill">
          <div class="bill-head"><b>${esc(bill.name)}</b><span class="tag">${PB.leanLabel(bill.lean)}</span></div>
          <p class="small muted">${esc(bill.desc)}</p>
          <div class="bill-foot">
            <span class="small">${mood} · whips say ${count}, <span class="${cls}">${label}</span></span>
            <button type="button" class="small" data-bill="${bill.id}">Put to a vote</button>
          </div>
        </div>`;
          })
          .join('');
    }
  }

  $('#gov-bills').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-bill]');
    if (btn) {
      clearGovNews();
      const v = PB.voteOnBill(btn.dataset.bill);
      if (v) govNews(`${v.title} ${v.outcome} (${v.divisions.map((d) => `${d.ayes}–${d.noes}`).join(', ')}).`, v.passed ? 'info' : 'error');
      refresh();
    } else if (e.target.id === 'gov-form') {
      clearGovNews();
      const formed = PB.formGovernment();
      govNews(formed.length ? `${PB.govLabel()} formed.` : 'No party can form a government.');
      renderPartyList();
      refresh();
    }
  });

  $('#gov-event').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-choice]');
    if (!btn) return;
    clearGovNews();
    const r = PB.resolveEvent(+btn.dataset.choice);
    if (r) govNews(`${r.text} (${signed(r.delta)} approval)`, r.delta < 0 ? 'error' : 'info', 6000);
    refresh();
  });

  $('#gov-end-turn').addEventListener('click', () => {
    const snapshot = JSON.parse(JSON.stringify(PB.state));
    const res = PB.govEndTurn();
    if (!res) return;
    clearGovNews();
    if (res.confidence && !res.confidence.passed) govNews(`The government survives a no-confidence vote, ${res.confidence.ayes}–${res.confidence.noes}.`);
    if (res.event && !res.event.pending) govNews(`${res.event.title}: ${res.event.text} (${signed(res.event.delta)} approval)`, res.event.delta < 0 ? 'error' : 'info', 6000);
    if (res.election) {
      // Elections rewrite the seats, so they can be undone like a reset.
      const e = res.election;
      const top = e.results
        .map((r) => (e.results.length > 1 ? `${PB.chamberName(r.chamber)}: ` : '') + r.rows.slice(0, 3).map((x) => `${x.short || x.name} ${x.seats}`).join(', '))
        .join('; ');
      offerStateUndo(`${res.confidence ? 'The government falls! ' : ''}${e.snap ? 'Snap election' : 'Election'}: ${top}. ${e.label}.`, snapshot);
    } else {
      refresh();
    }
  });

  $('#gov-cabinet').addEventListener('input', (e) => {
    const m = st().gov.cabinet[+e.target.dataset.post];
    if (!m) return;
    m.name = e.target.value;
    PB.save();
  });

  $('#gov-system').addEventListener('change', (e) => {
    st().gov.system = e.target.value;
    refresh();
  });

  $('#gov-restart').addEventListener('click', () => {
    replaceWithUndo('Restarted the government sim.', () => (st().gov = PB.newGov()));
  });

  // --- Exports -------------------------------------------------------------------
  $('#dl-svg').addEventListener('click', () => {
    const svg = PB.renderParliamentSVG(st());
    PB.download(`${PB.slug(PB.chamber().name)}.svg`, new Blob([svg], { type: 'image/svg+xml' }));
  });

  $('#dl-png').addEventListener('click', async () => {
    try {
      const blob = await PB.svgToPng(PB.renderParliamentSVG(st()), 2);
      PB.download(`${PB.slug(PB.chamber().name)}.png`, blob);
    } catch (err) {
      PB.notify(err.message, 'error');
    }
  });

  $('#ib-dl-png').addEventListener('click', async () => {
    const node = $('#ib-preview .wikibox');
    if (!node) return;
    if (!window.htmlToImage) {
      PB.notify('The image export library didn\'t load (are you offline?). The wikitext export still works.', 'error', 6000);
      return;
    }
    try {
      const url = await window.htmlToImage.toPng(node, { pixelRatio: 2 });
      const blob = await (await fetch(url)).blob();
      PB.download(`${PB.slug(partyById(st().ibPartyId).name)}-infobox.png`, blob);
    } catch (err) {
      PB.notify('PNG export failed. If your logo is a link to another site, try uploading the image instead.', 'error', 6000);
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
    PB.download(`${PB.slug(st().chambers[0].name)}.json`, new Blob([JSON.stringify(st(), null, 2)], { type: 'application/json' }));
  });

  $('#file-import').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const loaded = PB.normalize(JSON.parse(reader.result));
        replaceWithUndo(`Loaded "${file.name}".`, () => (PB.state = loaded));
      } catch (err) {
        PB.notify('That file doesn\'t look like a Parliament Builder save.', 'error');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  $('#btn-reset').addEventListener('click', () => {
    replaceWithUndo('Reset to the example parliament.', () => (PB.state = PB.sampleState()));
  });

  // Swap in a whole new setup (random, reset, load), keeping a snapshot so it
  // can be undone. Older undo toasts are cleared since they'd no longer apply.
  function replaceWithUndo(message, apply) {
    const snapshot = JSON.parse(JSON.stringify(PB.state));
    apply();
    offerStateUndo(message, snapshot);
  }

  function offerStateUndo(message, snapshot) {
    undoToasts.forEach((dismiss) => dismiss());
    undoToasts = [];
    renderAll();
    undoToasts.push(
      PB.notify(message, 'info', 7000, {
        label: 'Undo',
        onClick: () => {
          undoToasts.forEach((dismiss) => dismiss());
          undoToasts = [];
          PB.state = snapshot;
          renderAll();
        },
      })
    );
  }

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
    if (tab === 'infobox' || tab === 'gov') showTab(tab);
  } catch (e) { /* ignore */ }
})(window.PB);
