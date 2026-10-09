<div align="center">
  <img src="./src/assets/icon.png" width="112" height="112" alt="BiliMusic Logo" />
  <h1>BiliMusic</h1>
  <p>
    <strong>Turn Bilibili into a polished, animated, Apple Music inspired desktop music library.</strong>
  </p>
  <p>
    <a href="./README.md">中文</a>
    ·
    <a href="#-getting-started">Getting Started</a>
    ·
    <a href="#-harmonyos-pc">HarmonyOS PC</a>
    ·
    <a href="https://github.com/Withnoidea/BiliMusic">GitHub</a>
  </p>
  <p>
    <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=111" />
    <img alt="Electron" src="https://img.shields.io/badge/Electron-36-47848F?style=for-the-badge&logo=electron&logoColor=fff" />
    <img alt="Vite" src="https://img.shields.io/badge/Vite-6-646CFF?style=for-the-badge&logo=vite&logoColor=fff" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=fff" />
    <img alt="HarmonyOS" src="https://img.shields.io/badge/HarmonyOS-PC-D81E06?style=for-the-badge" />
  </p>
</div>

<br />

<div align="center">
  <table>
    <tr>
      <td align="center" width="25%">
        <h3>Apple Music Style</h3>
        <p>Glass panels, immersive background, spring motion, soft glows.</p>
      </td>
      <td align="center" width="25%">
        <h3>Bilibili Source</h3>
        <p>Search, recommendations, rankings, creators, music-like tracks.</p>
      </td>
      <td align="center" width="25%">
        <h3>Desktop Player</h3>
        <p>Tray, queue, playlists, lyrics, persisted playback state.</p>
      </td>
      <td align="center" width="25%">
        <h3>HarmonyOS PC</h3>
        <p>Dedicated Electron adaptation for HarmonyOS desktop behavior.</p>
      </td>
    </tr>
  </table>
</div>

<br />

<div align="center">
  <pre>
┌──────────────────────────────────────────────────────────────┐
│                        BiliMusic                             │
│  Discover · Search · Queue · Lyrics · Playlists · HarmonyOS   │
└──────────────────────────────────────────────────────────────┘
  </pre>
</div>

## Table of Contents

- [Vision](#-vision)
- [Experience Highlights](#-experience-highlights)
- [Feature Map](#-feature-map)
- [Interface Design](#-interface-design)
- [Architecture](#-architecture)
- [Getting Started](#-getting-started)
- [Desktop Packaging](#-desktop-packaging)
- [HarmonyOS PC](#-harmonyos-pc)
- [Project Structure](#-project-structure)
- [Persistence](#-persistence)
- [Development Notes](#-development-notes)
- [Roadmap](#-roadmap)
- [Disclaimer](#-disclaimer)

## Vision

BiliMusic is not just a simple video player wrapped in a desktop shell. Its goal is more specific: take the huge, loose, title-noisy, music-rich universe of Bilibili and shape it into something that feels like a real desktop music app.

Video titles are cleaned before lyric search. Search results become music-like track lists. Creator pages can be browsed like artist pages. Queues, favorites, recent tracks, and playlists gradually become a local library. The interface leans toward Apple Music: calm, translucent, animated, and refined, while still staying efficient as a desktop tool.

The project is also a cross-platform experiment. Besides regular Electron desktop packaging, it includes a HarmonyOS PC Electron project under `platform/HarmonyOS` with dedicated adaptations for tray behavior, native title buttons, frameless windows, fullscreen player interactions, and resource packaging.

## Experience Highlights

### 1. Feels Like a Music App

- Discover, recommendations, search, playlists, and settings share one visual language.
- Page transitions, card hover states, player expansion, and lyric movement are animated.
- The bottom player stays compact, while the expanded player becomes immersive.
- Covers, background glow, rotating discs, and animated lyrics work together as one listening scene.

### 2. Turns Bilibili Videos Into Music

- Search Bilibili videos.
- Search users and browse creator spaces.
- Browse discovery, recommendations, and music rankings.
- Convert video results into a unified track model that works with queue, playlists, favorites, and history.

### 3. Built for Long-Term Listening

- Recently played tracks are recorded automatically.
- Favorite tracks have their own library page.
- Custom playlists are persisted locally.
- Playlists can be imported and exported as JSON.
- Playback queue and state are restored after restart.

### 4. Deep Desktop Integration

- Electron main process proxies Bilibili and lyric API requests.
- Closing the main window minimizes to tray.
- Tray state follows current playback.
- Packaging is configured for Windows, macOS, and Linux.
- HarmonyOS PC resources can be synced and prepared for HAP builds.

## Feature Map

### Search

The search page is designed as a music discovery surface, not just an input box:

- Video search and user search.
- Apple Music style result rows.
- User results can open creator-space browsing.
- Dedicated empty, loading, and error states.
- Each track supports play, play next, add to queue, and add to playlist.

### Recommendations and Discovery

- Recommendation page uses Bilibili music-related content.
- Discover page aggregates ranking-like content.
- Hero sections use cover art as the visual anchor.
- Track lists stay dense, readable, and quick to scan.

### Player

The bottom player includes:

- Play / pause.
- Previous / next.
- Shuffle.
- Repeat modes.
- Seekable progress.
- Volume and mute.
- Queue drawer.
- Add current track to playlist.
- Expand into the immersive player.

The immersive player includes:

- Large cover art and dynamic background.
- Rotating disc decoration.
- Lyric panel with manual lyric matching.
- Fullscreen toggle.
- Close to tray.
- Collapse back to the main interface.

### Lyrics

Bilibili titles often contain noisy words such as official MV, full version, cover, live, high quality, and more. BiliMusic processes titles before lyric search:

- Removes common video-title noise.
- Extracts quoted and bracketed candidate titles.
- Removes upload descriptions, collections, rankings, and livestream hints.
- Builds multiple search candidates.
- Scores lyric candidates by title similarity, artist, album, and duration.
- Caches both successful and failed matches.
- Supports manual lyric search and version selection.

### Playlists

- Create playlists from the sidebar.
- Configure playlist name and description.
- Playlists appear under the playlist area and in the playlist overview page.
- Tracks from any page can be added through a reusable modal.
- Playlist detail pages support play all, delete playlist, remove one track, and batch remove.
- Batch selection is only shown in edit mode to keep the default interface clean.

### Queue

- View the current queue.
- Current track has a live equalizer indicator.
- Add queued tracks to playlists.
- Remove one track from the queue.
- Enter selection mode for batch removal.

### Settings

The settings page follows a macOS / Apple Music preference style:

- Light / dark / system theme.
- Expanded / collapsed / automatic sidebar.
- Playback quality.
- Auto play.
- Lyric display.
- Download directory.
- Download quality.
- Playlist import and export.
- Account status and QR login entry.

## Interface Design

BiliMusic aims to be expressive without becoming noisy.

| Design Element | Usage                                                   |
| -------------- | ------------------------------------------------------- |
| Glassmorphism  | Sidebar, player, dialogs, and panels                    |
| Dynamic Covers | Hero sections, player background, playlist covers       |
| Spring Motion  | Player expansion, lyric scrolling, button feedback      |
| Icon Buttons   | Lucide icons keep controls compact and recognizable     |
| Light and Dark | Complete support for both themes                        |
| Dense Lists    | Track lists are optimized for scanning and repeated use |

## Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                         React UI                              │
│ Pages · Components · Contexts · Hooks · Services              │
└──────────────────────────────┬───────────────────────────────┘
                               │ window.electronAPI
┌──────────────────────────────▼───────────────────────────────┐
│                    Electron Preload Bridge                    │
│ Bili API · Lyrics API · Window Control · Tray Control         │
└──────────────────────────────┬───────────────────────────────┘
                               │ IPC
┌──────────────────────────────▼───────────────────────────────┐
│                    Electron Main Process                      │
│ Protocol · BrowserWindow · Tray · API Proxy · Persistence     │
└──────────────────────────────┬───────────────────────────────┘
                               │
        ┌──────────────────────┴──────────────────────┐
        │                                             │
┌───────▼────────┐                          ┌─────────▼─────────┐
│ Desktop Builds │                          │ HarmonyOS PC HAP   │
│ Win/macOS/Linux│                          │ platform/HarmonyOS │
└────────────────┘                          └───────────────────┘
```

### Frontend Layer

- `pages/` contains route-level pages.
- `components/` contains player, lyrics, queue, layout, and shared UI.
- `contexts/` manages playback, auth, now-playing, and add-to-playlist state.
- `services/` encapsulates Bilibili data, lyric matching, and local library storage.
- `hooks/` provides settings, theme, and lyric state logic.

### Electron Layer

- The main process registers Bilibili API, lyric API, and window-control IPC handlers.
- A custom `app://` protocol is used in production to avoid ESM/CORS issues under `file://`.
- Tray and main-window lifecycle are managed in the main process.
- `preload.cjs` exposes a limited bridge to the renderer.

### HarmonyOS PC Layer

- `scripts/prepare-harmony.mjs` syncs build outputs into the HarmonyOS project.
- `scripts/build-harmony.mjs` tries to run Hvigor to build a HAP.
- `platform/HarmonyOS/web_engine` contains HarmonyOS Electron adaptation code.
- HarmonyOS-specific behavior is guarded by `process.platform === "openharmony"`.

## Getting Started

### Requirements

- Node.js 20 or newer.
- npm.
- A matching OS environment for desktop packaging.
- DevEco Studio and the HarmonyOS Electron environment for HarmonyOS PC builds.

### Install

```bash
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Start Electron

```bash
npm run electron:start
```

## Desktop Packaging

```bash
npm run electron:build
```

Artifacts are written to:

```text
release/
```

Configured targets:

- Windows: NSIS installer.
- macOS: DMG and ZIP.
- Linux: AppImage and DEB.

## HarmonyOS PC

The HarmonyOS PC Electron project is located at:

```text
platform/HarmonyOS
```

### Prepare Resources

```bash
npm run harmony:prepare
```

This command:

1. Runs `npm run build`.
2. Clears the previous HarmonyOS app resource directory.
3. Copies `dist/`.
4. Copies `dist-electron/`.
5. Writes a minimal runtime `package.json`.

Target directory:

```text
platform/HarmonyOS/web_engine/src/main/resources/resfile/resources/app
```

### Build HAP

```bash
npm run harmony:build
```

If `hvigor` or `hvigorw` is unavailable in your shell, open:

```text
platform/HarmonyOS
```

in DevEco Studio and run:

```text
Build -> Build Hap(s)/APP(s) -> Build Hap(s)
```

### HarmonyOS-Specific Behavior

| Scenario            | Handling                                                                               |
| ------------------- | -------------------------------------------------------------------------------------- |
| Platform check      | `process.platform === "openharmony"`                                                   |
| Tray icon           | Uses `electron/tray.png`                                                               |
| Tray context window | Disabled on HarmonyOS to avoid black floating popups                                   |
| Main window         | Frameless, with HarmonyOS native title buttons enabled by the adapter                  |
| Player view         | Hides native HarmonyOS title buttons and restores them afterward                       |
| Fullscreen          | Keeps player state and system fullscreen state in sync                                 |
| Resources           | AppScope and electron-module icons, splash icons, tray icons, and names are customized |

## Scripts

| Command                   | Description                              |
| ------------------------- | ---------------------------------------- |
| `npm run dev`             | Start Vite dev server                    |
| `npm run build`           | Build frontend and Electron main process |
| `npm run preview`         | Preview frontend build                   |
| `npm run electron:start`  | Build and start Electron                 |
| `npm run electron:build`  | Package desktop installers               |
| `npm run harmony:prepare` | Build and sync HarmonyOS resources       |
| `npm run harmony:build`   | Sync resources and try building HAP      |

## Project Structure

```text
BiliMusic
├─ electron/
│  ├─ main.ts                Electron main process
│  ├─ preload.cjs            Renderer bridge
│  ├─ biliApi.ts             Bilibili API proxy
│  ├─ lyricsApi.ts           Lyrics API proxy
│  ├─ icon.png               Desktop app icon
│  └─ tray.png               HarmonyOS tray icon
├─ src/
│  ├─ assets/                Frontend assets
│  ├─ components/            Player, queue, lyrics, layout, shared UI
│  ├─ contexts/              Playback, auth, now-playing, playlist modal state
│  ├─ hooks/                 Theme, settings, lyrics hooks
│  ├─ pages/                 Discover, search, recommendations, playlists, downloads, settings
│  ├─ services/              Bilibili data, lyric matching, local storage
│  ├─ styles/                Global styles and Apple Music design system
│  └─ types/                 Electron bridge and domain types
├─ scripts/
│  ├─ prepare-harmony.mjs    Sync HarmonyOS app resources
│  └─ build-harmony.mjs      Try Hvigor HAP build
├─ platform/HarmonyOS/       HarmonyOS PC Electron project
├─ dist/                     Frontend build output
├─ dist-electron/            Electron build output
└─ release/                  Desktop package output
```

## Persistence

BiliMusic stores:

- Current track.
- Playback queue.
- Playback progress.
- Volume, mute, shuffle, repeat.
- Recently played tracks.
- Favorites.
- Custom playlists.
- Lyric cache and manually selected matches.
- Theme and settings.
- Basic logged-in user display information.

Storage locations:

- `localStorage`: frontend state, library data, playlists, lyric cache.
- Electron `userData`: desktop data such as downloads.

## Development Notes

### Title Cleaning and Lyric Matching

Lyric matching lives in `src/services/lyrics.ts`. It performs:

- Unicode normalization.
- Common video-noise removal.
- Quoted-title extraction.
- Upload-description, collection, ranking, and livestream hint removal.
- Multiple keyword generation.
- Candidate scoring by similarity, artist, album, and duration.

### Playback State

Playback state lives in `src/contexts/PlayerContext.tsx`:

- Queue.
- Current track.
- Playing state.
- Volume.
- Progress.
- Shuffle and repeat.
- Auto play.
- Tray state sync.

### Playlists

Playlist behavior is split across services and UI:

- `src/services/playlists.ts` persists playlist data.
- `Sidebar` creates playlists.
- `AddToPlaylistContext` provides the reusable add modal.
- `Playlists` handles overview, detail, and batch editing.

### Window Strategy

Window behavior lives mainly in `electron/main.ts`:

- Regular platforms use custom window buttons.
- HarmonyOS PC uses native title buttons.
- Closing the window hides it to tray.
- Production loads the renderer from `app://local/index.html`.
- The immersive player requests native title buttons to be hidden.

## Roadmap

- [ ] More complete local download management.
- [ ] Configurable lyric sources and fallback.
- [ ] More accurate Bilibili audio-quality selection.
- [ ] Editable playlist covers.
- [ ] Listening statistics.
- [ ] Mini player.
- [ ] Further HarmonyOS PC behavior refinement.
- [ ] More complete automated tests.

## Contributing

Issues, suggestions, and pull requests are welcome. This project is strongly experience-driven, so UI quality, motion, cross-platform behavior, lyric matching, and stability all matter.

Before submitting changes, at least run:

```bash
npm run build
```

If you changed HarmonyOS resources or adapters:

```bash
npm run harmony:prepare
```

Then rebuild and verify in DevEco Studio.

## Disclaimer

BiliMusic is intended for learning, research, and personal use. It is not affiliated with, endorsed by, or commercially connected to Bilibili, Apple Music, Apple Inc., or any related service provider. The project does not bundle audio, video, or lyric resources.

Please respect platform terms, copyright rules, and local laws. Do not use this project for copyright infringement, platform abuse, or bypassing service restrictions.

## Author

Designed and built by MikannQAQ.


## Fork repository and updates

This fork is maintained at [Withnoidea/BiliMusic](https://github.com/Withnoidea/BiliMusic).
Use its [Releases](https://github.com/Withnoidea/BiliMusic/releases) and
[Issues](https://github.com/Withnoidea/BiliMusic/issues), not upstream releases.
Original project credit: [HanversionOvO/BiliMusic](https://github.com/HanversionOvO/BiliMusic).

The app checks only this fork. A fork with no public stable Release shows an explicit
“no release available” message, not “up to date”. Without `ota.json`, the app checks
the fork's latest GitHub Release and offers its release page for manual download.
See [release instructions](docs/RELEASING.md) for installer, updater and OTA assets.
The app ID and existing playlist/login storage remain unchanged. Old upstream OTA
bundles are isolated and cannot replace the bundled fork interface.
