# Share images

`og-card.html` is the source of the website's share image (Open Graph /
Twitter, 1200×630): `src/app/opengraph-image.png` (English) and
`src/app/es/opengraph-image.png` (Spanish). They are static files so the
text is set by a real browser (the `next/og` renderer spaced Geist badly).

To regenerate after changing the copy or the brand:

1. Open `og/og-card.html?lang=en` in Chrome (from disk; it loads Geist from
   `node_modules` and the mascot from `public/brand`).
2. DevTools → device toolbar → 1200 × 630, zoom 100 % → ⋮ → _Capture
   screenshot_. Save as `src/app/opengraph-image.png`.
3. Repeat with `?lang=es` → `src/app/es/opengraph-image.png`.

Keep each image under 8 MB (Open Graph) and 5 MB (Twitter); the alt texts
are the `opengraph-image.alt.txt` files next to them.
