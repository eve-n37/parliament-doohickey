# 🏛️ Parliament Builder

Build fictional parliaments and make Wikipedia-style infoboxes for their parties. Runs entirely in the browser with no build step and no backend.

![Parliament tab](docs/screenshot-parliament.png)

## Features

**Parliament**
- Unicameral or bicameral: each chamber has its own name, layout and seat counts, while parties are shared between them
- Hemicycle, horseshoe, circle and Westminster layouts
- Each party gets a clean wedge of seats, and you can reorder parties left to right
- Coalition tracker: tick parties to see whether they reach a majority
- Optional majority line, title and legend; circle or square seats; adjustable seat size
- Westminster benches: government, opposition, crossbench and speaker (or "auto", based on coalition)
- 🎲 Random parliament generator for when you need inspiration
- Export as **SVG** or **PNG**

**Party infobox**
- Styled after Wikipedia's `{{Infobox political party}}`
- Logo upload, multiple leaders, ideology list, colours swatch, custom rows
- Seat bars pull straight from the parliament (one per chamber), and you can add extra rows (regional councils and so on)
- Export as **PNG**, or copy the **wikitext** to paste into a wiki

**Data**
- Autosaves in your browser (localStorage)
- **Save** and **Load** a `.json` file to back up or share a whole universe

## Running it

Open `index.html` in a browser. That's it.

To host it on GitHub Pages, go to **Settings → Pages**, choose **Deploy from a branch**, then pick `main` and `/ (root)`.

## Project layout

```
index.html          page shell
css/style.css       app UI (light + dark)
css/wikibox.css     the Wikipedia-style infobox
js/state.js         state, storage, helpers, random generator
js/parliament.js    seat layout algorithms + SVG rendering
js/infobox.js       infobox HTML + wikitext export
js/app.js           UI wiring
```

The only external dependency is [html-to-image](https://github.com/bubkoo/html-to-image), loaded from a CDN for the infobox PNG export. Everything else works offline.

## License

MIT
