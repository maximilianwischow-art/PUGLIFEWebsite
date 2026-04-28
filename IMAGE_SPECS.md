# Website Image Spec Sheet

This file defines the recommended image sizes and aspect ratios used by the website UI.

## Core Slots

- `Hero banner` (`public/plb-hero-banner.png`)
  - Used in the top hero on all pages.
  - Target ratio: `~2.5:1`
  - Recommended size: `2000x800` (or `1024x409` minimum baseline)
  - Fit mode: contained in hero area, no aggressive crop.

- `Site background` (`public/site-bg-tbc.png`)
  - Used as full-page background art.
  - Target ratio: `~3:2` to `16:10` (wide landscape).
  - Recommended size: `2560x1440` or larger.
  - Fit mode: `cover` with gradient overlays.

- `Logo / favicon source` (`public/pug-life-balance-logo.png`)
  - Square source for icon usage.
  - Target ratio: `1:1`
  - Recommended size: `1024x1024`.

## Home/Dashboard Raid Art

- `PB/MVP header images` (`public/raid-images/pb-header-*.png`)
  - Used by personal-best tiles and MVP Last Raid strip.
  - Target ratio: `~2.3:1` to `3:1`
  - Recommended size: `1800x700` to `2400x800`.
  - Current mapped files:
    - `pb-header-kara.png`
    - `pb-header-gruul.png`
    - `pb-header-magtheridon.png`

- `Raid calendar icons` (currently `svg` and fallback square art in `public/raid-images`)
  - Target ratio: `1:1`
  - Recommended size: `256x256` or vector `svg`.

## Events Page Raid Headers

- `Event raid headers` (`public/raid-images/event-header-*.png`)
  - Used in Future Events cards.
  - Single-raid events show one full-width strip.
  - Two-raid events show 50/50 split (one image per half).
  - Target ratio: `~7.5:1` (very wide strip)
  - Recommended size: `2000x265` to `2400x320`.
  - Current mapped files:
    - `event-header-kara.png`
    - `event-header-gruul.png`
    - `event-header-magtheridon.png`
    - `event-header-ssc.png`
    - `event-header-tk.png`

## Icons

- `Class icons` (`public/class-icons/*.jpg`): `1:1`, current style `36x36`.
- `Boss icons` (`public/boss-icons/*.jpg`): `1:1`, ideally at least `200x200`.

## Naming Rules

- Keep raid headers in `public/raid-images/`.
- Use stable filenames so code mappings do not break:
  - `event-header-<raid>.png`
  - `pb-header-<raid>.png`
- Prefer lowercase names with dashes.

## Missing/Optional Assets

- Optional: add a dedicated `event-header-za.png` for Zul'Aman events.
  - Current behavior falls back to Kara-style event header if ZA is detected.
