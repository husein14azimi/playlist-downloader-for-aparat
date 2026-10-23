# Playlist Downloader for Aparat (Firefox build)

Downloads every video of an Aparat playlist, in playlist order, into
`Downloads/Aparat/<playlist title>/NN - <video title>.mp4` (NN is zero-padded: 2 digits, 3 from 100 videos, 4 from 1000).

## Screenshots

![Screenshot #1](https://raw.githubusercontent.com/husein14azimi/playlist-downloader-for-aparat/main/docs/screenshots/1.jpg)
![Screenshot #2](https://raw.githubusercontent.com/husein14azimi/playlist-downloader-for-aparat/main/docs/screenshots/2.jpg)

## Install (Firefox 140 or newer)
Quick test (removed when Firefox restarts):
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and pick `manifest.json` from the unzipped folder (or pick the zip itself).

Permanent install: regular Firefox only keeps signed add-ons. Upload this zip to https://addons.mozilla.org/developers/
as **On your own** (unlisted) to get a signed `.xpi`, then open it in Firefox (about:addons, gear icon, *Install Add-on From File*).
Firefox Developer Edition and Nightly can instead set `xpinstall.signatures.required` to `false` in `about:config`.

If the playlist will not load, open `about:addons`, select this add-on, open **Permissions**, and make sure access to `www.aparat.com` is on.

## Use
Click the toolbar icon (on an Aparat playlist page the link is filled in for you), or paste a link such as
`https://www.aparat.com/playlist/1301084/`, then **Load playlist** and **Download selected**.
Keep the tab open while it runs. Clicking **Download selected** again retries only the videos that failed.

## Languages
English and Persian (RTL). The extension starts in Persian. The globe button next to the theme button switches language, and the choice is remembered from then on.
- UI strings: `locales/en.json`, `locales/fa.json` (flat key -> text, `{placeholders}`, plurals as `key.one` / `key.other`).
- Store listing name/description/tooltip: `_locales/<code>/messages.json`.
- To add a language: add `locales/<code>.json`, `_locales/<code>/messages.json`, and one entry in `LANGS` in `i18n.js`
  (set `dir` to `rtl` or `ltr`, and `digits` to its digit characters, or `null`).
  Missing keys fall back to English. Clicking the globe cycles through the languages in `LANGS`.

## Font
`fonts/Vazirmatn-VariableFont_wght.ttf` (Vazirmatn, SIL Open Font License 1.1, see `fonts/OFL.txt`).
One variable file covers all weights. Replace it with your own copy using the same file name if you like.

## Icon
Replace the PNGs in `icons/` with your own, keeping the names: `icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png`
(Chrome does not accept SVG for extension icons). Then reload the add-on.
UI icons are from Lucide (https://lucide.dev, ISC license), inlined in `app.html`.

## What it does and doesn't do
- Permissions: `downloads`, and access to `www.aparat.com` only. Nothing is sent anywhere else.
- Skips videos whose uploader disabled downloads.
- Download links are signed and expire within hours, so each one is requested just before its download.
- Two videos download at a time. Aparat rate-limits its API, so don't raise this much.
