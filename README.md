# Emberpath brand kit

Onyx and warm ember orange. Prepared for the React + TypeScript weight-logging MVP.

## Included

| File | Use |
| --- | --- |
| `tokens/emberpath.tokens.css` | Framework-independent primitive, semantic and component color tokens. |
| `tokens/emberpath.tokens.json` | Matching machine-readable color tokens with aliases. |
| `tokens/emberpath.tailwind.css` | Tailwind CSS v4 theme mapping; imports the base token file. |
| `tokens/README.md` | Token usage, contrast checks, states and chart guidance. |
| `logos/emberpath-logo.svg` | Main horizontal logo on a transparent background; use on dark surfaces. |
| `logos/emberpath-logo-glow.svg` | Presentation logo with SVG glow filters and an opaque Onyx background. |
| `logos/emberpath-logo-on-light.svg` | Dark wordmark and deeper orange for light surfaces. |
| `logos/emberpath-wordmark.svg` | Standalone outlined wordmark, for dark surfaces. |
| `logos/emberpath-mark.svg` | Orange symbol with a transparent background. |
| `logos/emberpath-mark-mono.svg` | Single-color symbol; defaults to off-white and uses `currentColor`. |
| `logos/emberpath-app-icon.svg` | Rounded-square app icon. |
| `logos/emberpath-app-icon-maskable.svg` | Full-bleed icon, with the symbol within the central maskable safe zone. |
| `logos/favicon.svg` | Small browser icon. |
| `icons/` | PNG application icons, Apple touch icon and ICO favicon. |
| `manifest.example.webmanifest` | Starting point for a web app manifest. |
| `preview.html` | Local visual overview; open in a browser. |
| `preview.png` | Static preview of the identity and palette. |
| `reference/emberpath-approved-concept.png` | The original first concept selected in the conversation. |

## Add to the frontend

1. Copy `tokens/` to `src/app/ui/tokens/`.
2. Copy `logos/` and `icons/` to `public/brand/`, keeping both folders.
3. Import the Tailwind mapping from the app's main stylesheet, after Tailwind itself:

```css
@import "tailwindcss";
@import "./app/ui/tokens/emberpath.tailwind.css";
```

The relative import assumes the main stylesheet is directly under `src/`. Adjust it to the actual location. Tailwind core is imported once by the application, not by the token file.

Use the logo in React:

```tsx
<img
  src="/brand/logos/emberpath-logo.svg"
  alt="Emberpath"
  width={220}
  height={61}
/>
```

Use an empty `alt` when the same brand name already appears immediately beside the image. All SVGs include accessible titles and descriptions, but an external `<img>` still needs its own `alt` text.

For the optional manifest, copy `manifest.example.webmanifest` to `public/brand/manifest.webmanifest`. The icon paths are relative to that manifest. Add to the application's HTML head:

```html
<meta name="theme-color" content="#111113" />
<link rel="icon" type="image/svg+xml" href="/brand/logos/favicon.svg" />
<link rel="icon" href="/brand/icons/favicon.ico" sizes="16x16 32x32 48x48" />
<link rel="apple-touch-icon" href="/brand/icons/apple-touch-icon.png" />
<link rel="manifest" href="/brand/manifest.webmanifest" />
```

The manifest is an integration example; this asset package does not implement offline support, authentication or a running application. Adapt its start URL and scope if the app is hosted below a URL subpath.

## Identity rules

- Use the flat logo in the app header and the glow version on larger introductory or brand surfaces.
- Preserve aspect ratio and the negative-space path through the flame. Use the mark alone when the wordmark would be smaller than roughly 150 px wide.
- Keep at least one quarter of the symbol's width clear around the logo.
- Use dark text on orange action buttons. White text on the primary orange does not provide sufficient contrast for ordinary small text.
- Use green for successful actions, such as a saved entry. A rising or falling weight trend is not automatically good or bad; use the neutral orange trend token in either direction.
- The subtle border token is decorative. Use the stronger control-border token when a field depends on its outline to be recognizable.

## Source and format

The SVG artwork is a cleaned vector reconstruction of the approved generated concept. The flame uses cubic curves; the wordmark uses outlined paths derived from the unlit refinement of the same concept. It is not a pixel-identical conversion of the first glowing raster image. That original is preserved in `reference/`.

SVG files contain native paths, shapes and, for the glow version, SVG filters. They contain no embedded bitmap, font, script or external dependency. The wordmark therefore requires no font installation. The mono mark can inherit a CSS `color` when inlined; CSS on an outer `<img>` cannot recolor an external SVG.

The palette is intentionally dark-only. The on-light logo is an asset variant, not a complete light application theme. Typography, spacing and layout tokens are left for the first application implementation.

Domain ownership and name availability have not been verified as part of this asset preparation.

## Validation

- All nine SVG files parse and render, with no embedded raster images, scripts, external resources or live text.
- The preview was checked in a browser at widths of 320, 375 and 1100 px: all images load, there is no horizontal overflow and there are no script errors.
- CSS/JSON values and Tailwind mapping references resolve consistently. Contrast checks for the intended text and control pairs are listed in `tokens/README.md`.
- The maskable icon's colored symbol fits inside its required central safe zone, and all manifest icon paths exist.
- Tailwind v4 mapping syntax has been checked against the official documentation. Compilation in the actual React app remains part of repository integration.
