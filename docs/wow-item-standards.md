# WoW Item UI Standard

Use this standard for **every** page that renders World of Warcraft items.

## Shared tooltip module (required)

- Include **`/wow-item-tooltip.js`** on the page **before** any script that binds item tooltips.
- Use **`window.WowItemTooltip`** only — do not copy tooltip DOM/CSS logic into page scripts.
- After item metadata is loaded into your `Map` (or lookup), bind once per render surface:

```html
<script src="/wow-item-tooltip.js?v=20260502a"></script>
<script src="/your-page.js?v=…"></script>
```

```javascript
window.WowItemTooltip.bindLootTooltipHandlers(
  document.getElementById("yourItemHost"), // or document for full page
  (id) => itemMetaById.get(Number(id))
);
```

### API (`window.WowItemTooltip`)

| Export | Purpose |
|--------|---------|
| `escapeHtml(value)` | Escape text for HTML templates |
| `tooltipText(meta)` | Plain-text lines for native `title` fallback |
| `bindLootTooltipHandlers(root, getItemMeta)` | Attach hover handlers under `root`; `getItemMeta(id)` returns metadata row or null |
| `hideLootTooltip()` | Hide panel (optional; used internally on mouseleave) |

## Markup (required)

- Trigger: **`data-loot-item-id="<numeric itemId>"`** on the hover target (same as Loot History).
- Row pattern (icons optional but recommended when `meta.icon` exists):

```html
<div class="loot-item-name" data-loot-item-id="28485" title="…">
  <img class="loot-item-icon" src="…" alt="" />
  Bulwark of the Ancient Kings
</div>
```

- Panel/classes (defined in `public/styles.css`): `loot-tooltip-panel`, `loot-tooltip-wowhead`, `loot-tooltip-line`.

## Tooltip content priority (required)

Same as Loot History / `wow-item-tooltip.js`:

1. `tooltipHtml` from `/api/wow-classic/items` when present (Wowhead HTML)
2. Else array `tooltip` lines
3. Else: `No item tooltip available.`

## Metadata (required)

- Load item rows from **`GET /api/wow-classic/items`** only.
- Store in a **`Map`** keyed by numeric **`itemId`**.
- Batch requests in chunks of **80** ids per call.

## Binding scope

- Prefer binding **inside the smallest container** that was re-rendered (e.g. a list `div`), so you do not stack duplicate listeners on unrelated sections — see Nether Vortex guild table vs selected-items list.
