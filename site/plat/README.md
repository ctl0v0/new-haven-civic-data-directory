# Plat report components

Load `plat-tokens.css`, `plat-fonts.css` and `plat.css` in that order. Wrap the report in a `.plat` element. The styles follow the system color scheme. Set `data-theme` to `light` or `dark` on the document element to choose a screen theme.

The directory and parcel explorer load `plat-base.css` for the same typography, palette and focus styles. Their own stylesheets define page layouts using the shared tokens.

Use `components.js` for section and panel layouts, fact tiles, source links, status stamps, coverage, and published-field disclosures. `graphics.js` renders the plat drawing and charts from verified geometry and returned records. The property report template supplies the data and maps the source rows into components. Keep new report-specific selectors in `parcel-report.css`.

Edit `tokens.json` to change the palette or shared design values. Regenerate the stylesheet and validate its contrast from the repository root.

```sh
python3 -I scripts/generate-plat-tokens.py site/plat/tokens.json site/plat/plat-tokens.css
```

Archivo, Public Sans and IBM Plex Mono are self-hosted Latin WOFF2 assets from the Fontsource 5.3.0 packages. Their licenses are in `fonts/`.
