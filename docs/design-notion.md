# My Secretary — Notion style adaptation

Design target: the user-selected [Notion reference on Refero](https://styles.refero.design/style/2bf4c61f-de10-4614-ba1b-20c0453bd2a9). Product pattern reference: [Notion board views](https://www.notion.com/help/boards). Accessibility and responsive details follow the Refero skill's bundled craft guidance.

## Reference lock

Preserve the warm `#f6f5f4` canvas, white content surfaces, tight sans headings, hairline borders, 12px cards, 8px buttons, and restrained `#0075de` actions. Use the board reference only for grouped status labels, counts, and property hierarchy. Keep My Secretary's existing board, calendar, note, and dialog workflows. Use platform sans fonts for Latin text and the bundled Vazirmatn font for Persian. No new media is needed for this desktop productivity interface.

## Decision ledger

| Decision | Source and role | Adaptation |
| --- | --- | --- |
| Warm canvas and white cards | Refero Notion palette, page versus content roles | Board, calendar, notes, and dialogs share the same surfaces. |
| Blue actions | Refero Notion primary action and active-state color | Primary buttons, links, keyboard focus, and today's calendar outline. |
| Thin borders and rounded corners | Refero Notion shape and elevation rules | Content cards have no shadows; dialogs use elevation to separate them from the canvas. |
| Compact colored status labels | Notion board grouping pattern and existing task states | Neutral pending, amber work in progress, green done, and red canceled; readable darker text on light tints. |
| Title and navigation hierarchy | Refero typography plus existing app views | 32px workspace title, 13px controls, separate navigation row. |
| Code token colors | Existing syntax roles, adapted for light surfaces | Darker syntax colors also travel with HTML and Teams exports. |
| Flexible view height | Existing 900×600 minimum desktop window | Views fill the remaining window below navigation and the optional update banner. |
| Persian and Shamsi support | Existing app constraints | Retain font coverage, direction controls, date conversion, and both date labels. |

## Validation

`tests/appearance.cjs` uses the real renderer and preload with isolated sample IPC responses and a temporary user-data directory. It checks populated and empty boards, calendar, notes, task editor and activity, templates, settings, categories, archive, event details, update banners, and keyboard focus. It captures the main views at 1400×900 and 900×600 for visual inspection. Animations are disabled for repeatable captures.

Run: `node_modules/.bin/electron tests/appearance.cjs /tmp/secretary-notion-qa`

Existing note/template/export/persistence and timeline/backup tests also pass. Screenshots in `docs/screenshots` use sample data. macOS rendering was checked; Windows/Linux rendering and installer builds were not checked.

## Light/Dark preference

Settings → Appearance switches between the original light palette and a neutral charcoal dark palette. The choice is saved locally and applied before the stylesheet loads. Dark surfaces retain the existing shape, layout, and status roles; brighter code and link colors are display-only, so exported notes retain colors suitable for light documents. The appearance test covers switching in both directions, native color scheme, code display versus export colors, and reload persistence.
