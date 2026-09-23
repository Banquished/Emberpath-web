# Emberpath color tokens

Onyx surfaces, warm Ember actions, restrained supporting colors. Dark-only MVP palette.

## Files

- `emberpath.tokens.css`: framework-independent, namespaced custom properties on `:root`.
- `emberpath.tokens.json`: matching machine-readable tokens. Colors use DTCG-style `$type: "color"` and sRGB `$value` objects with normalized components; aliases use `{group.name}`. No vendor-specific import format is implied.
- `emberpath.tailwind.css`: Tailwind v4 utility mapping. Imports the token CSS, not Tailwind itself.

The layers are primitive → semantic → component. Prefer `--ep-semantic-*` in app code; override component aliases for a specific component. Keep CSS and JSON synchronized when changing the palette.

## React + Tailwind v4

Copy this folder to `src/app/ui/tokens/`. Import these in the app's global CSS before other rules (adjust the relative path):

```css
@import "tailwindcss";
@import "./tokens/emberpath.tailwind.css";

@layer base {
  body {
    background: var(--ep-semantic-background);
    color: var(--ep-semantic-text-primary);
  }
}
```

Import the global CSS once from the React entry point. The bridge extends Tailwind's default theme; it does not remove default utilities or choose a font.

Example primary action:

```tsx
<button
  type="submit"
  disabled={isSaving}
  className="min-h-11 rounded-xl bg-primary px-4 font-semibold text-primary-foreground
    enabled:hover:bg-primary-hover enabled:active:bg-primary-active
    focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring
    disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-foreground"
>
  Save weight
</button>
```

Use `bg-surface` for cards, `border-border-subtle` for decorative separators, and `border-border-control` for input boundaries. Tokens define values only; apply borders, focus outlines and disabled attributes in components. An orange control needs an offset focus outline so the ring remains separate from its fill.

Without Tailwind, import only `emberpath.tokens.css` and use the CSS variables directly.

## Weight charts and states

- `chart-observation`: individual weigh-ins; render points.
- `chart-trend`: the trend line, orange whether weight rises or falls.
- `chart-average`: rolling average, using the existing Sky supporting color (#8DBDF7). Its cool tone complements warm Ember measurements on Onyx surfaces; use a dashed line and a labeled legend. This is a data-series role, independent of status colors.
- `chart-target`: an optional dashed, directly labeled target line.
- `chart-grid` is decorative; `chart-label` is readable text.
- Do not treat weight loss as success or gain as error.
- Success confirms an operation, such as saving. Error indicates invalid input or a failed action. Add text or an icon alongside status color.
- Use text labels, line styles and accessible data summaries as well as color.

Canvas libraries may need resolved colors instead of CSS `var()` strings:

```ts
const trendColor = getComputedStyle(document.documentElement)
  .getPropertyValue("--ep-semantic-chart-trend")
  .trim();
```

## Contrast checks

Calculated using WCAG sRGB relative luminance. On background / surface / raised surfaces:

| Pair | Minimum contrast |
| --- | ---: |
| Primary text | 13.98:1 |
| Secondary text | 6.39:1 |
| Orange primary accent | 6.50:1 |
| Rolling average (Sky) | 7.81:1 |
| Error text | 6.99:1 |
| Control border | 3.44:1 |

Primary-button dark text: **7.86:1** default, **9.37:1** hover, **6.52:1** active. White text on the primary orange is intentionally not used. Decorative borders are intentionally lower contrast and must not identify controls on their own. These checks cover the stated color pairs, not complete application accessibility.

Tailwind mapping follows the [official v4 theme-variable documentation](https://tailwindcss.com/docs/theme#referencing-other-variables).

