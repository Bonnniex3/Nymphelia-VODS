# NympheliaVOD

A fan-made VOD archive for the VTuber [Nymphelia](https://nymphelia.com). Videos are stored on the [Internet Archive](https://archive.org/) and streamed through a custom Video.js player so the watching experience stays under our control.

**Live site:** <https://nymphelia.com>

---

## What it does

- Indexes every VOD across Nymphelia's Internet Archive collections (gaming, ASMR, general archive).
- Auto-generates titles, dates, and thumbnails by parsing filenames at build time.
- Serves each VOD through a custom Video.js player with hotkeys, fullscreen polish, and direct deep-linkable URLs (`/vod/:slug`).
- Provides search and category filtering on the VOD grid.

## Tech stack

- **React 19** + **Create React App** (via `react-app-rewired`)
- **MUI v7** for components and theming
- **Tailwind CSS v3** for layout utilities
- **Video.js 8** with `videojs-hotkeys` for playback
- **React Router v7** for routing
- **Framer Motion** for transitions
- **Vercel Analytics** for traffic insights
- Hosted on **Vercel**

## How it works

Videos are hosted on the Internet Archive at `archive.org/download/{collectionId}/{vodId}.mp4`. The build script (`scripts/fetch-vods.js`) hits the IA metadata API for each configured collection, parses date/title out of the filename, downloads thumbnails into `public/thumbnails/`, and writes a single `src/vods/data/vods.json` manifest the frontend reads.

The player page (`/vod/:slug`) embeds the IA MP4 directly into a Video.js instance — no IA iframe — so styling, hotkeys, and UX are fully ours.

## Project layout

```
public/              static assets + thumbnails (generated)
scripts/
  fetch-vods.js      pulls IA metadata + thumbnails, writes vods.json
src/
  App.js             routes + MUI theme + animated background
  navbar/            top nav + drawer
  vods/
    Vods.js          VOD grid (search, filters)
    CustomVod.js     player page
    VideoJS.js       Video.js wrapper
    CustomPlayer.js  player UI overlays
    data/vods.json   generated VOD index
  utils/             shared helpers + UI bits
```

## Running locally

```bash
npm install
npm run fetch-vods   # populate src/vods/data/vods.json + public/thumbnails
npm start            # dev server on http://localhost:3000
```

### Available scripts

| Script | What it does |
| --- | --- |
| `npm start` | Dev server (react-app-rewired) |
| `npm run fetch-vods` | Re-fetches IA metadata and thumbnails |
| `npm run build` | Runs `fetch-vods`, builds the app, renames `build/` → `prod/` |
| `npm test` | Runs the test suite |

## Deployment

The site deploys to **Vercel**. Because `npm run build` renames the output folder, Vercel must be configured with **Output Directory: `prod`**. Redeploys are triggered via a Vercel Deploy Hook whenever the VOD index needs refreshing.

## Adding a new IA collection

Edit the `ITEM_IDS` array at the top of [scripts/fetch-vods.js](scripts/fetch-vods.js), then re-run `npm run fetch-vods`. Filenames are expected to follow one of the patterns the parser already understands (`[M-D-YY] title.mp4`, `twitch_nymphelia_YYYY-MM-DD HH-MM-SS_title.mp4`, etc.).

## Credits

- VODs and likeness: **Nymphelia**
- Site built and maintained by **[Bonnniex3](https://github.com/Bonnniex3)**
- Inspired by other VTuber/streamer VOD archive projects
- [Twemoji](https://twemoji.twitter.com) graphics — licensed under [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0)

This is an unofficial fan project and is not affiliated with Nymphelia.
