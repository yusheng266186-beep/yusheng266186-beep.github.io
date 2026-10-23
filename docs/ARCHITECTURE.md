# AURUM architecture

The site remains buildless HTML, CSS and classic JavaScript so both GitHub Pages and direct-file use are supported. Existing v3 portfolio and v5 configuration keys are retained.

`data/embedded-data.js` supplies the offline seed. `core.js` exposes pure, independently tested domain operations through a browser global and CommonJS export. `scene.js` owns hash navigation and motion, and emits `aurum:chapter` after revealing a section. `app.js` adapts public providers, loads static files, renders the views and redraws visible canvases. No animation writes financial state.

## Invariants

1. `asOf` is a provider's observation time. `fetchedAt` is a request time. Missing observation times remain missing. Snapshot provenance cannot become live merely by loading it.
2. Historical series are validated, sorted and deduplicated. Technical indicators use the recorded daily series. The chart may overlay one explicitly identified live point without duplicating a day.
3. Scenario cards and charts use `scenarioAt`. They are parameterized extrapolations with no calibrated probabilities. Missing history produces an empty state.
4. Order previews and execution use the same `core.order`. A transaction validates size, cost, provenance, cash and single-order limits before updating holdings. Writes must succeed before a transaction is confirmed.
5. Persisted account content is compared before a write, and storage events load other tabs' updates. An invalid saved account is not overwritten by a fallback trade. Explicit reset and validated restore are the recovery paths.
6. Official feed results replace only healthy sources' items. Failed sources retain their dated records. A total outage fails instead of writing an empty success snapshot.
7. Original fonts ship with licenses. The gold specimen is an SVG illustration and is labeled separately from market charts.

## Deployment

`checks.yml` validates static DOM references, JavaScript syntax, JSON files and domain regressions. `pages.yml` deploys main and also responds to successful trusted main-branch refresh workflows. Data-refresh jobs share a concurrency group and have bounded timeouts. Refresh failures retain prior data and expose a failed workflow status.

## Verification boundary

Automated tests cover domain behavior and partial-source outages. Desktop and phone UI flows are checked in an actual browser. Third-party endpoints may independently fail or restrict browser access; the UI always carries provenance, timestamps and observable fallbacks. No browser test submits a real financial order.
