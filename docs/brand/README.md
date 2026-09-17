# Emberpath identity

The approved visual direction is Onyx with warm ember orange. The original first logo concept is preserved in `reference/emberpath-approved-concept.png`.

## Source locations

| Item | Location |
| --- | --- |
| CSS and JSON palette | `src/app/ui/tokens/` |
| Tailwind v4 theme mapping | `src/app/ui/tokens/emberpath.tailwind.css` |
| SVG logos and symbols | `public/brand/logos/` |
| Application icons | `public/brand/icons/` |
| Web app manifest | `public/manifest.webmanifest` |

Use `/brand/logos/emberpath-logo.svg` for dark app surfaces. It contains outlined paths and requires no font file. The glow variant is for larger brand surfaces; the flat version is used in the app header. Keep aspect ratios intact.

The original [brand-kit README](reference/brand-kit-readme.md) is retained as a historical reference. Its copy instructions describe the original package layout; use the source locations above in this application.

`preview.html` remains a standalone brand reference, separate from the app. Its relative asset paths have been updated and it can be opened directly in a browser. `preview.png` is the original static preview.

## Application direction

- **Palette:** background `#111113`, surface `#1B1B1F`, raised surface `#25252A`, primary `#FF8A3D`, primary text `#F5F5F4`, secondary text `#A8A8A3`. Components reference semantic tokens.
- **Typography:** locally bundled Manrope for the interface, with the approved outlined wordmark kept intact.
- **Layout:** a compact header and route navigation, followed by a left-aligned page heading and one spacious weight-history panel. The header remains usable on a small phone.
- **Empty state:** no invented measurements or chart. Availability of the logging action is stated plainly.
- **Interaction:** visible keyboard focus, a skip link and touch targets of at least 44 px. Motion is limited to short color transitions and respects reduced-motion preferences.

Use the stronger control border for input boundaries. Decorative separators use the subtle border. Primary orange buttons use dark text. Success colors describe successful actions, not whether a person's weight increased or decreased.
