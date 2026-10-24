# Local fonts and CJK coverage

The serif and sans families remain Noto Serif SC 2.003 and Noto Sans SC 2.004. The original `noto-serif-sc.woff` and `noto-sans-sc.woff` contain only 1,018 Unicode characters each and are retained as unused historical assets. They must not be reintroduced as the active family: ordinary newly fetched news characters such as 夜、闻、美、股、跌、怒、火 are absent and cause per-character system-font fallback.

The active `assets/fonts.css` uses self-hosted, Unicode-routed WOFF2 shards. Common-character shards are the unmodified Google Fonts web assets; supplemental shards fill the remaining upstream characters, using the matching full variable fonts in `google/fonts`. Supplementation preserves font revision, units per em, vertical metrics and weight range. It does not introduce a second font design or scale individual characters.

`cjk-manifest.json` records each asset's SHA-256, byte length, Unicode routing, source and actual glyph coverage. The complete union covers 30,928 characters for Noto Serif SC and 30,890 for Noto Sans SC. Serif covers all 20,992 basic Han characters; Sans covers 20,976. Both cover all 6,763 GB2312 Han characters and all Chinese text in the current page and news snapshot. Unsupported characters elsewhere in Unicode still use normal platform fallback.

338 shards total 24,207,100 bytes. Browsers fetch only shards whose Unicode ranges are used by rendered text, not the whole collection at startup. There is no runtime request to Google Fonts. Existing Inter numerical typography remains unchanged. The separate manifest and this explanation are not needed for rendering and are not requested by the page.

Full font sources were verified against Git blob identities:

- Noto Serif SC variable TTF: `eab063faf229160a52d3760f5555150e4eb9e5bf` (25,125,512 bytes).
- Noto Sans SC variable TTF: `fb0637bafbcd804fe32152370a1225990745b4bc` (17,772,300 bytes).

Sources: [Noto Serif SC](https://github.com/google/fonts/tree/main/ofl/notoserifsc), [Noto Sans SC](https://github.com/google/fonts/tree/main/ofl/notosanssc). SIL Open Font License 1.1 copies are included in `noto-serif-sc-OFL.txt` and `noto-sans-sc-OFL.txt`. The supplemental shards were made with FontTools 4.67.0 and Brotli; only requested missing Unicode characters and their required layout glyphs were retained.

`node scripts/verify-fonts.mjs` checks asset hashes, local Unicode routing, broad Han coverage, the GB2312 Han repertoire, and current page/news text. It runs as part of `verify-source.mjs` so incomplete font bundles or a reintroduced tiny subset cannot silently pass release checks.
