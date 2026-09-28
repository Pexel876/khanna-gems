# Khanna Gems — scroll story

An interactive, scroll-driven landing page for Khanna Gems:

1. A pen sketch of the boutique draws itself on a white page.
2. It washes into a photograph of the storefront at dusk; the doors open and the camera moves through them.
3. Inside the 3D showroom, the associate greets the visitor with a namaste.
4. A leather case opens, a gemstone rises, turns in the light, and its characteristics appear (emerald, blue sapphire, ruby, yellow sapphire, diamond).

Built with [three.js](https://threejs.org) (loaded from a CDN). No build step.

## Run locally

```bash
python -m http.server 5178
```

Then open http://localhost:5178. It must be served over HTTP (opening `index.html` directly from disk will not load the modules).

## Files

- `index.html`, `style.css`, `main.js` — the page, theme and 3D scene
- `assets/front/` — storefront sketch and photographs (doors closed / open)
- `assets/interior/backwall.jpg` — walnut gem-cabinet wall behind the counter
- `assets/associate/` — namaste clip split into frames (scrubbed by scroll)
- `assets/studio.hdr` — studio lighting environment (Poly Haven, CC0)

When you change `main.js` or `style.css`, bump the `?v=` number on their links in `index.html` so browsers pick up the new version.
