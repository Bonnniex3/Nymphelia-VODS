# Nymphelia-VODS

A fan-made VOD archive for the VTuber [Nymphelia](https://www.twitch.tv/nymphelia). Videos are stored on the [Internet Archive](https://archive.org/) and streamed through a custom Video.js player so the watching experience stays under our control.

**Archive site:** <https://vods.nymphelia.co>
**Watch live:** <https://www.twitch.tv/nymphelia>

---

## What it does

- Indexes every VOD across Nymphelia's Internet Archive collections.
- Auto-generates titles, dates, and thumbnails by parsing filenames at build time.
- Serves each VOD through a custom Video.js player with hotkeys, resume-where-you-left-off, shareable timestamps and clips, and direct deep-linkable URLs (`/vod/:slug`).
- Search, sort, year and type filters on the archive (all reflected in the URL, so filtered views are shareable).

## Design: "NYMPHELIA.EXE"

Y2K cyber-kawaii, dark mode: the site is styled as Nymphelia's own little operating system. Panels are OS windows (`profile.id`, `nymphelia.exe`, `archive.dir`, `now_playing.vod`), the nav is a taskbar with a live clock, and dot matrices run through every layer:

| Effect | Where | File |
| --- | --- | --- |
| WebGL2 halftone field that flows, follows the cursor, ripples on click and parallaxes on scroll | page background | `src/fx/HalftoneField.jsx` |
| LED dot-matrix displays with a hand-built 5×7 font | ticker, `on_air.led`, footer sign, 404 | `src/fx/DotMatrix.jsx`, `src/fx/dotFont.js` |
| Kawaii katakana "digital rain" | hero, 404 | `src/fx/KanaRain.jsx` |
| The pfp re-drawn as an interactive halftone portrait | hero | `src/fx/PfpMatrix.jsx` |
| Sparkle cursor trail | everywhere (fine pointers only) | `src/fx/CursorSparkles.jsx` |

Every effect pauses off-screen, in a hidden tab and during fullscreen video, and falls back to a static frame under `prefers-reduced-motion`.

**Palette** — her colours on a near-black plum base. Tokens live in the `@theme` block of `src/styles/index.css` (Tailwind 4, so `bg-panel`, `text-petal`, … are generated from them):

| Token | Hex | Used for |
| --- | --- | --- |
| `void` / `ink` / `panel` / `panel-2` / `panel-3` | `#0a0408` `#12070e` `#1a0c15` `#23111d` `#311829` | page, insets, windows, raised surfaces |
| `petal` | `#F78FC4` | primary accent, LEDs, buttons |
| `neon` | `#FF6FB5` | hover/glow variant of petal |
| `blush` / `cream` | `#FBCFE8` / `#FFF7FA` | secondary / primary text |
| `rose` | `#C25588` | deep pink |
| `sky` | `#C3A6FF` | secondary accent (her eyes) |
| `lilac` | `#8F7AE6` | holographic gradient |

**Type** (self-hosted via Fontsource): **Unbounded** for display, **DotGothic16** for dot-matrix labels, timecodes and Japanese accents, **M PLUS Rounded 1c** for body text (handles Japanese VOD titles).

The only character art on the site is her pfp (`src/assets/pfp.png`). `public/meta_image.png` and `src/assets/default_thumbnail.png` are rendered from the HTML templates in `scripts/brand/` (`node scripts/brand/render.cjs` with Playwright available).

## Tech stack

- **React 19** + **Vite 8** (Rolldown)
- **Tailwind CSS 4** (CSS-first config, container queries)
- **React Router 7** data router, with the **View Transitions API** morphing a VOD card into the player
- **Motion** for entrance animations
- **Video.js 8** with `videojs-hotkeys` for playback
- Raw **WebGL2 / Canvas 2D** for the dot-matrix effects (no graphics library)
- **lucide-react** icons, **simple-icons** brand marks
- **Vitest** + **ESLint 9 flat config**
- **Vercel Analytics**, hosted on **Vercel**

## How it works

Videos are hosted on the Internet Archive at `archive.org/download/{collectionId}/{vodId}.mp4`. The build script (`scripts/fetch-vods.js`) hits the IA metadata API for each configured collection, parses date/title out of the filename, downloads thumbnails into `public/thumbnails/`, and writes a single `src/vods/data/vods.json` manifest the frontend reads.

The player page (`/vod/:slug`) embeds the IA MP4 directly into a Video.js instance — no IA iframe — so styling, hotkeys, and UX are fully ours.

## Project layout

```
index.html           Vite entry
public/              static assets + thumbnails (generated)
scripts/
  fetch-vods.js      pulls IA metadata + thumbnails, writes vods.json
  brand/             templates for the OG image + default thumbnail
src/
  App.jsx            data router + global layout (backdrop, taskbar, cursor)
  routes.js          lazy route chunks (the player is preloaded on card hover)
  styles/            design tokens + utilities (index.css), Video.js skin (player.css)
  lib/               channel config, VOD queries/stats, hooks, helpers
  ui/                primitives: Window, Button/IconButton, Tag/Led, Thumb, Sparkle, BrandIcon
  fx/                canvas/WebGL dot-matrix effects
  shell/             TopBar, Footer, Backdrop, Loading, NotFound, ErrorBoundary
  home/              bento: ProfileCard, HeroWindow, signal tiles, ContinueWatching
  archive/           Archive section, VodCard, Filters, Pagination, EmptyArchive
  watch/             player page
  vods/data/         vods.json (generated) + placeholder sample archive
```

## Running locally

```bash
npm install
npm run fetch-vods   # populate src/vods/data/vods.json + public/thumbnails
npm run dev          # dev server on http://localhost:3000
```

**Placeholder archive:** while `src/vods/data/vods.json` is empty, every build (dev, preview and production) uses a sample archive instead (`src/vods/data/vods.sample.js`: 36 placeholder VODs from `vods.mock.json`, all playing the bundled 30-second `sample.mp4`), so the site is fully browsable. Once `npm run fetch-vods` writes real VODs, builds use them and the samples and clip drop out automatically. `npm run dev:mock` forces the samples regardless.

### Available scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run dev:mock` | Dev server with the sample archive |
| `npm run fetch-vods` | Re-fetches IA metadata and thumbnails |
| `npm run build` | Runs `fetch-vods`, then builds to `prod/` |
| `npm run preview` | Serves the production build |
| `npm test` | Vitest suite |
| `npm run lint` | ESLint |

## Deployment

The site deploys to **Vercel**. Vite builds straight into `prod/`, so Vercel must be configured with **Output Directory: `prod`** (also set in `vercel.json`). Redeploys are triggered via a Vercel Deploy Hook whenever the VOD index needs refreshing.

## Adding a new IA collection

Edit the `ITEM_IDS` array at the top of [scripts/fetch-vods.js](scripts/fetch-vods.js), then re-run `npm run fetch-vods`.

## Keeping in sync with Meoyumi

This site runs the same frontend as [MeoyumiVODS](https://github.com/Bonnniex3/MeoyumiVODS), re-branded. To pull in her latest changes, check out MeoyumiVODS next to this repo and run:

```bash
node scripts/meoyumi-sync/sync.mjs ../MeoyumiVODS
```

It copies Meoyumi's `src/`, configs and brand templates, swaps in the colours, name and socials from [scripts/meoyumi-sync/brand.json](scripts/meoyumi-sync/brand.json), re-applies this fork's own additions (`scripts/meoyumi-sync/overlay/`) and runs `npm install`. This repo's VOD data, `scripts/fetch-vods.js`, `.env` and pfp are left alone.

## Credits

- VODs and likeness: **Nymphelia**
- Site built and maintained by **[Bonnniex3](https://github.com/Bonnniex3)**
- Inspired by [xqc.wtf](https://xqc.wtf) and other streamer VOD archive projects

This is an unofficial fan project and is not affiliated with Nymphelia.
