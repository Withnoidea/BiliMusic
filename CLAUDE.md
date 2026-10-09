# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

BiliMusic is an Electron desktop music player that turns Bilibili video content into a listenable music library. It searches/plays Bilibili videos as tracks and lets users import external playlists (NetEase Cloud / QQ Music) that get auto-matched to Bilibili equivalents. The UI follows an Apple Music–style glassmorphism design. This is a shell/wrapper over Bilibili UGC for personal listening — there is no bundled audio content.

Stack: React 19 + Vite 6 + TypeScript on the renderer, Electron 36 main process. Also ships a HarmonyOS PC port (see below).

## Commands

```bash
npm install            # install dependencies
npm run dev            # start Vite dev server (does NOT launch Electron)
npm run build          # build frontend (dist/) + electron main (dist-electron/)
npm run electron:start # build then launch Electron desktop app
npm run electron:build # package installers (release/) via electron-builder
npm run preview        # preview the built frontend
npx tsc --noEmit       # type-check (no separate lint configured)
```

There is no test suite. No lint script is configured.

**Important:** `vite.config.ts` uses the `vite-plugin-electron` plugin, which builds the Electron main process and **auto-launches the Electron window when `npm run dev` runs**. So `npm run dev` opens the desktop app directly, not just a browser page.

## Architecture

Three layers communicate over IPC:

```
React UI (src/)                     React pages/contexts/hooks
   │  window.electronAPI            (exposed by preload bridge)
Preload (electron/preload.cjs)      narrow, hand-written bridge
   │  ipcRenderer.invoke / send
Main (electron/main.ts + modules)   API proxies, window, tray, persistence
```

### Electron main process (`electron/`)

- **`main.ts`** — entry point. Creates BrowserWindow, tray, registers `app://` protocol, sets up Bilibili CORS/Referer header rewriting via `webRequest`, wires all handler modules.
- **`preload.cjs`** — CommonJS bridge exposing `window.electronAPI` (window controls, tray, updater, WebDAV, `biliApi`, `lyricsApi`, `playlistApi`, `persistentStorage`). Uses `contextBridge`. When adding a new IPC channel, update this file AND `src/types/electron.d.ts` (the renderer-side TS types).
- **`biliApi.ts`** — Bilibili REST API proxies: search, video detail, play URL (audio streams), favorites, ranking, QR login, audio download. Uses Electron `net.fetch`.
- **`lyricsApi.ts`** — lyric search/get proxies (QQ music API as lyric source).
- **`playlistImportApi.ts`** — NetEase/QQ playlist import proxies (added by the import feature). NetEase detail endpoint returns only ~10 tracks when unauthenticated; the handler fetches all `trackIds` then batch-fills via `/api/v3/song/detail` in chunks of 200.
- **`webdav.ts`** — WebDAV sync for cross-device library backup.
- **`updater.ts` / `otaUpdater.ts` / `updaterBus.ts`** — full-app auto-update (electron-updater) plus a renderer-only OTA hot-patch mechanism.

**Request header handling is a footgun:** Electron allows only ONE `onBeforeSendHeaders` listener per session; `main.ts` merges all Bilibili request header rewriting (Referer/Origin) into a single listener. If you add another webRequest listener for these domains, it will silently override the existing one and break audio CDN access (403).

**Persistence quirk (`src/utils/persistentStorage.ts`):** Storage writes go to `localStorage` normally, but on HarmonyOS (`platform === 'openharmony'`) it mirrors to a persistent IPC store. `readStoredItem`/`writeStoredItem` are the abstraction — always use them for settings that must survive on HarmonyOS.

### Renderer (`src/`)

- **State is context-based, not a store library.** `PlayerContext` is the single source of truth for playback (queue, current track, volume, shuffle/repeat). Components consume it via `usePlayer()`. Player state is persisted (current track, queue, progress) and restored on relaunch.
- **`services/api.ts`** is the renderer's facade over Bilibili; it wraps `window.electronAPI.biliApi` and re-exports normalized types. `services/bilibiliApi.ts` contains the lower-level API client including the **WBI signing** logic (search/user-video endpoints require a `w_rid` MD5 signature computed from a mixin key fetched from the `nav` endpoint).
- **Playback flow:** UI plays a `Track` → `PlayerContext.play()` calls `extractAudio()` → resolves a play URL (audio stream) via `bili:playUrl` → the HTML `<audio>` element streams it. Audio URLs require a Bilibili `Referer` header, which the main-process header rewriting handles.
- **Playlist import feature** (added by Claude): `pages/Import.tsx` → paste NetEase/QQ link → `services/playlistImport.ts` (parse URL, map track fields) → `services/playlistMatch.ts` (search Bilibili per track, score title/artist/duration similarity) → create a local playlist via `utils/storage.ts`.
- **`utils/storage.ts`** is the localStorage-backed library: recent, favorites, playlists, settings. Uses window events (`PLAYLISTS_CHANGED_EVENT` etc.) to notify components of cross-tab updates. Also has a tombstone mechanism for WebDAV sync so deletions don't resurrect.
- **Theme:** CSS variables in `src/styles/index.css` define light/dark via `[data-theme]`. Use the existing variable names (`--color-primary`, `--color-foreground`, `--color-muted`, `--glass-*`) — they're the project's vocabulary. Avoid inventing new ones (a past bug was caused by using a nonexistent `--color-text`).

### Routing

`src/App.tsx` uses `react-router-dom` with routes wrapped in providers (Auth → Player → NowPlaying → AddToPlaylist) and a `MainLayout` shell. Pages: Discover, Search, Recommend, Recent, Favorites, Playlists (+detail), Downloads, Settings, Import.

## HarmonyOS PC port

`platform/HarmonyOS/` holds a HarmonyOS Electron project. Platform differences are gated on `process.platform === 'openharmony'` (e.g., native window buttons, no tray right-click menu, `app://` loading). Build scripts: `npm run harmony:prepare` (sync dist into the HarmonyOS resfile) and `npm run harmony:build` (attempt Hvigor build). Don't break the `openharmony` platform checks when touching window/tray/persistence code.

## Development notes

- Design tokens and the Apple Music–style component primitives live in `src/components/AppleMusicPage.tsx` (`MusicPageShell`, `MusicHero`, `MusicSection`, `TrackList`, `TrackListRow`, `EmptyLibrary`). New pages should reuse these.
- Bilibili search requires WBI signing and can hit `-352` risk-control; the renderer (full Chromium fingerprint + cookies) is the intended caller.
- When changing the Electron main process, restart `npm run dev` — Vite HMR does not reload main-process code.
- The project's data model is `Track`/`Playlist` in `src/types/index.ts`. Bilibili video → `Track` mapping includes a fallback to music-center `aid`+`cid` when the `bvid` archive is deleted (-404).
