// Wikipedia-style party infobox: HTML preview and {{Infobox political party}} wikitext.
(function (PB) {
  const esc = PB.esc;

  const lines = (s) => String(s || '').split('\n').map((l) => l.trim()).filter(Boolean);

  const safeUrl = (u) => (/^(https?:|data:image\/)/i.test(String(u || '').trim()) ? String(u).trim() : '');

  // Simple key/value rows, in the order Wikipedia shows them.
  const ROWS = [
    ['abbreviation', 'Abbreviation'],
    ['founder', 'Founder'],
    ['founded', 'Founded'],
    ['dissolved', 'Dissolved'],
    ['splitFrom', 'Split from'],
    ['headquarters', 'Headquarters'],
    ['newspaper', 'Newspaper'],
    ['youthWing', 'Youth wing'],
    ['membership', 'Membership'],
    ['ideology', 'Ideology', 'list'],
    ['position', 'Political position'],
    ['national', 'National affiliation'],
    ['international', 'International affiliation'],
    ['colours', 'Colours', 'colours'],
    ['slogan', 'Slogan'],
    ['anthem', 'Anthem'],
  ];
  PB.INFOBOX_ROWS = ROWS;

  const compositionBar = (seats, total, color) => {
    const pct = total > 0 ? Math.min(100, (seats / total) * 100) : 0;
    return `<div class="wb-cbar" role="img" aria-label="${seats} of ${total} seats"><div class="wb-cbar-fill" style="width:${pct.toFixed(2)}%;background:${esc(color)}"></div><span>${seats} / ${total}</span></div>`;
  };

  PB.renderInfobox = (party, state) => {
    if (!party) return '<p class="muted">No party selected.</p>';
    const info = party.info;
    const color = party.color || '#9aa0a6';
    const header = (text) => `<tr><th colspan="2" class="wb-header" style="background:${PB.tint(color, 0.35)}">${esc(text)}</th></tr>`;
    const row = (label, html) => `<tr><th scope="row">${esc(label)}</th><td>${html}</td></tr>`;
    const out = [];

    out.push(`<div class="wb-title">${esc(party.name)}</div>`);
    if (info.nativeName) out.push(`<div class="wb-native">${esc(info.nativeName)}</div>`);
    out.push(`<div class="wb-stripe" style="background:${esc(color)}"></div>`);
    out.push('<table class="wb-table"><tbody>');

    const logo = safeUrl(info.logo);
    if (logo) out.push(`<tr><td colspan="2" class="wb-logo"><img src="${esc(logo)}" alt="" crossorigin="anonymous"></td></tr>`);

    info.leaders.filter((l) => l.name).forEach((l) => out.push(row(l.title || 'Leader', esc(l.name))));

    ROWS.forEach(([key, label, kind]) => {
      if (kind === 'colours') {
        const name = info.coloursName;
        if (name) out.push(row(label, `<span class="wb-swatch" style="background:${esc(color)}"></span>${esc(name)}`));
        return;
      }
      const v = info[key];
      if (!v) return;
      if (kind === 'list') {
        const items = lines(v);
        out.push(row(label, items.length > 1 ? `<ul class="wb-plainlist">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : esc(items[0])));
      } else {
        out.push(row(label, esc(v).replace(/\n/g, '<br>')));
      }
    });

    info.custom.filter((c) => c.label || c.value).forEach((c) => out.push(row(c.label, esc(c.value).replace(/\n/g, '<br>'))));

    const seatRows = [];
    if (info.showLegislatureSeats && state.legislature.name) {
      seatRows.push({ title: `Seats in the ${state.legislature.name}`, seats: party.seats, total: PB.totalSeats() });
    }
    info.extraSeats.filter((s) => s.title).forEach((s) => seatRows.push({ title: s.title, seats: +s.seats || 0, total: +s.total || 0 }));
    seatRows.forEach((s) => {
      out.push(header(s.title));
      out.push(`<tr><td colspan="2" class="wb-center">${compositionBar(s.seats, s.total, color)}</td></tr>`);
    });

    if (info.website) {
      const href = safeUrl(info.website.includes('://') ? info.website : `https://${info.website}`);
      const text = info.website.replace(/^https?:\/\//, '').replace(/\/$/, '');
      out.push(header('Website'));
      out.push(`<tr><td colspan="2" class="wb-center">${href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text)}</td></tr>`);
    }

    out.push('</tbody></table>');
    return `<div class="wikibox">${out.join('')}</div>`;
  };

  PB.infoboxWikitext = (party, state) => {
    if (!party) return '';
    const info = party.info;
    const clean = (s) => String(s || '').replace(/\|/g, '{{!}}').trim();
    const out = ['{{Infobox political party'];
    const add = (k, v) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') out.push(`| ${k} = ${v}`);
    };

    add('name', clean(party.name));
    add('native_name', clean(info.nativeName));
    if (info.logo) add('logo', `${party.short || PB.slug(party.name)}-logo.png`);
    add('abbreviation', clean(info.abbreviation));
    info.leaders.filter((l) => l.name).forEach((l, i) => {
      add(`leader${i + 1}_title`, clean(l.title || 'Leader'));
      add(`leader${i + 1}_name`, clean(l.name));
    });
    add('founder', clean(info.founder));
    add('foundation', clean(info.founded));
    add('dissolved', clean(info.dissolved));
    add('split', clean(info.splitFrom));
    add('headquarters', clean(info.headquarters));
    add('newspaper', clean(info.newspaper));
    add('youth_wing', clean(info.youthWing));
    add('membership', clean(info.membership));
    const ideology = lines(info.ideology).map(clean);
    if (ideology.length > 1) add('ideology', `{{plainlist|\n${ideology.map((i) => `* ${i}`).join('\n')}\n}}`);
    else add('ideology', ideology[0]);
    add('position', clean(info.position));
    add('national', clean(info.national));
    add('international', clean(info.international));
    if (info.coloursName) add('colours', `{{Color box|${party.color}|border=darkgray}} ${clean(info.coloursName)}`);
    add('slogan', clean(info.slogan));
    add('anthem', clean(info.anthem));

    let n = 1;
    if (info.showLegislatureSeats && state.legislature.name) {
      add(`seats${n}_title`, `Seats in the ${clean(state.legislature.name)}`);
      add(`seats${n}`, `{{Composition bar|${party.seats}|${PB.totalSeats()}|hex=${party.color}}}`);
      n++;
    }
    info.extraSeats.filter((s) => s.title).forEach((s) => {
      add(`seats${n}_title`, clean(s.title));
      add(`seats${n}`, `{{Composition bar|${+s.seats || 0}|${+s.total || 0}|hex=${party.color}}}`);
      n++;
    });
    // The template has no free-form rows, so custom rows go into footnotes.
    const custom = info.custom.filter((c) => c.label && c.value).map((c) => `${clean(c.label)}: ${clean(c.value)}`);
    if (custom.length) add('footnotes', custom.join('<br>'));
    if (info.website) add('website', `{{URL|${clean(info.website)}}}`);
    out.push('}}');
    return out.join('\n');
  };
})(window.PB);
