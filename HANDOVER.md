# Technical handover — Automated AE Archive v1.00

## Purpose

This repository is the permanent external archive service for Julia Jones's Authors Electric posts. It is independent of the Golden Duck `/authors-electric` page after the first successful migration.

## Source hierarchy

1. Existing `public/data/archive-latest.json` — last-known-good baseline.
2. Full paginated Blogger label feed for `Julia Jones`.
3. Recent unfiltered Blogger feed filtered by author name.
4. Old Golden Duck `/authors-electric` page — migration and cross-check source only.
5. Known historical tombstone for the deleted November 2012 post `Sparkles`.

## Safety rules

- Merge is append-preserving; source failures never delete known posts.
- Output is not promoted if the first run contains fewer than the configured minimum expected posts.
- All Authors Electric links are canonicalised to `https://authorselectric.blogspot.com/...`.
- Archive metadata and JavaScript payloads are written only after validation.
- Failed runs leave the previous GitHub Pages deployment in place.
- A heartbeat commit is produced at least every 30 days to prevent the public scheduled workflow becoming dormant after 60 days of repository inactivity.

## Published outputs

- `public/data/archive-latest.json` — primary machine-readable archive.
- `public/data/archive-latest.js` — cross-origin script payload for Squarespace without relying on CORS.
- `public/posts/.../index.html` — preserved article copies.
- `public/media/...` — mirrored post images.
- `snapshots/archive-*.json` — immutable metadata snapshots.
- `public/data/status.json` — latest automation status.

## Configuration

Edit `config/archive.config.json` only when URLs or thresholds change.

## Authors Electric v1.18 dependency

Do not produce AE v1.18 until the first workflow run is green and the public archive has been spot-checked. AE v1.18 must consume `archive-latest.js` or `archive-latest.json` as its permanent fallback and must no longer depend on the old Golden Duck archive page.
