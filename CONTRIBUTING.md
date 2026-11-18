# Contributing

Bug reports, fixes, translations, and documentation improvements are welcome.
You can describe issues and pull requests in English or Persian.

The upstream project is
[husein14azimi/playlist-downloader-for-aparat](https://github.com/husein14azimi/playlist-downloader-for-aparat).
Open issues and pull requests there so the original project receives your contribution.

## Set up a development copy

Fork the upstream repository, clone your fork, and add the original repository
as the `upstream` remote. Replace `<your-username>` with your GitHub username:

```sh
git clone https://github.com/<your-username>/playlist-downloader-for-aparat.git
cd playlist-downloader-for-aparat
git remote add upstream https://github.com/husein14azimi/playlist-downloader-for-aparat.git
git switch main
git pull --ff-only upstream main
git switch -c fix/short-description
```

Use a short descriptive branch name, such as `fix/download-progress` or
`feature/quality-selection`.

Node.js 20 or newer is required for tests and packaging. The project has no npm
dependencies; no dependency installation is needed.

## Test and build

```sh
npm test
npm run build
```

To build all targets and open the local build viewer:

```sh
npm run build:open
```

The generated `dist/` folder contains unpacked Firefox, Chrome, and Edge
extensions, versioned ZIP files, and `index.html` with installation instructions.
Individual targets can be built with `npm run build:firefox`,
`npm run build:chrome`, or `npm run build:edge`.

For browser checks:

- Firefox 140+: open `about:debugging#/runtime/this-firefox`, choose
  **Load Temporary Add-on**, and select the Firefox build's `manifest.json`.
- Chrome 123+: open `chrome://extensions`, enable **Developer mode**, choose
  **Load unpacked**, and select `dist/chrome`.
- Edge 123+: open `edge://extensions`, enable **Developer mode**, choose
  **Load unpacked**, and select `dist/edge`.

Reload the extension after changing source or rebuilding. Keep the downloader
tab open during downloads. Automated tests simulate extension APIs, so check
affected behavior in a real browser where possible. State which browsers you
tested and any limitations in your pull request.

## Keep changes focused

- Follow the existing JavaScript module structure and coding style.
- For a bug fix, describe a reproducible failure and add a regression test when
  behavior warrants one. Avoid unrelated refactoring or formatting changes.
- Keep browser-specific manifest settings in the build configuration. Preserve
  Firefox compatibility when changing Chromium support, and vice versa.
- Explain changes to permissions, network access, download concurrency, or retry
  behavior. Keep cancellation and pause/resume behavior covered by tests.
- Use `textContent` for remote titles and messages rather than inserting API
  content as HTML. Keep executable extension code bundled locally.
- Do not commit generated `dist/` output, local browser profiles, credentials,
  or personal downloads.

## Translations and interface changes

Update both `locales/en.json` and `locales/fa.json` for new interface strings.
Preserve placeholder names such as `{error}`, and check Persian right-to-left
layout, localized digits, and language switching.

Extension listing strings live in `_locales/<language>/messages.json`.
To add another language, update the runtime language list in `i18n.js` and the
early language/direction setup in `boot.js`, and provide the corresponding
translation files. Check missing-key fallback and plural forms.

For visual changes, include screenshots of the relevant light/dark themes and
screen sizes when useful.

## Report a bug

Search existing issues first. Include:

- Browser name and version, operating system, and extension version.
- Exact steps to reproduce the problem.
- Expected behavior and what actually happened.
- A public playlist URL if it is needed to reproduce the issue.
- Relevant error messages or screenshots, with credentials and signed URL tokens
  removed.

Use a small playlist for reproduction when possible. Do not repeatedly request
large playlists or raise concurrency just to test a report.

## Submit a pull request

Run the relevant tests, build affected browser targets, and check whitespace:

```sh
npm test
npm run build
git diff --check
```

Commit and push the focused changes to your fork. Open a pull request targeting
the original repository's `main` branch. Its description should explain the
problem or feature, resulting behavior, test results, and relevant limitations.
Link any related issue and describe reproduction steps for bug fixes.

Address review feedback with focused follow-up commits. Keep discussion
respectful and give reviewers enough context to assess the change.

## Licensing

By submitting a contribution, you agree to make your contribution available
under this project's [MIT License](LICENSE). Submit only material that you have
the right to contribute. Preserve existing copyright notices and include the
appropriate licenses for any new third-party material.

The bundled font and icons retain their own licenses; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [fonts/OFL.txt](fonts/OFL.txt).
