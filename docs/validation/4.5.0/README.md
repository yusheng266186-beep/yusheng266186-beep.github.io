# Fixed multi-origin experiment · 2026-10-24

This experiment evaluated the unchanged 4.4.1 forecast kernel and three predeclared alternatives. **No alternative qualified for adoption.** Forecast parameters remain unchanged. The webpage release is 4.5.0; this is not a claim of a new, more accurate price model.

The frozen dataset contains 1,799 confirmed AU9999 closes from 2019-05-27 to 2026-10-23. Its normalized SHA-256 is recorded in `plan.json`. The original kernel and its dependency hashes are archived in `kernel/` and `kernel-manifest.json`. No current or future news is inserted into past predictions.

## Protocol locked before scores

- Use every 21st recorded trading session, starting at record index 252; never hand-select good or bad forecast dates.
- At each origin, train, normalize features, shrink forecasts and calibrate intervals using only the price prefix available at that origin. Future prices are read solely as outcomes.
- Development: origin and target both within 2020-06-08–2023-11-02. Validation: both within 2023-11-03–2025-04-28. Reserved tail: both within 2025-04-29–2026-10-23. Purge labels crossing phase boundaries.
- Compare the unchanged model with exactly three alternatives: slope ridge 20→80 only; ridge/trend weight 70/30→35/65 only; direct fitting target cap 63→252 sessions only. Do not tune any other coefficient.
- First select using development and validation only. Each must have at least 12 non-overlapping target blocks and at least 1% relative MAPE improvement. Percentage RMSE must not deteriorate more than 2%, direction hit rate not more than 3 percentage points, and any past-60-day regime with at least eight independent observations must not deteriorate more than 10% in MAPE.
- Seal `selection.json` before revealing reserved-tail results. Do not revise thresholds or try new alternatives after seeing the tail. A qualified alternative would additionally require at least 0.5% tail MAPE improvement and the stated safeguards. None reached that step, so the tail evaluates the retained model only.
- Retain failed candidates and their reasons. Long horizons lacking independent targets cannot authorize tuning, even if overlapping diagnostics look attractive.

The historical series had already been inspected in previous releases. The reserved tail is withheld from **this experiment's selection**, not a never-before-seen independent dataset. Current historical prices are not true revision vintages. The immutable forward ledger remains the separate source of genuinely prospective results.

Rolling forecasting origins preserve time order; random cross-validation would mix information across time. [Forecasting: Principles and Practice](https://otexts.com/fpp3/tscv.html) describes this evaluation approach.

## Results

The development/validation comparison made 776 candidate forecasts across 57 fixed cutoff dates. A subsequent retained-model diagnostic covers 74 cutoffs and 315 distinct date/horizon pairs, including cross-boundary forecasts excluded from selection. Overlapping horizons remain diagnostics; non-overlapping blocks are used for primary comparison.

| Horizon | Reserved-tail non-overlapping targets | Model MAPE | Unchanged-price baseline MAPE |
|---|---:|---:|---:|
| 1 week | 17 | 3.28% | 3.04% |
| 1 month | 16 | 6.77% | 7.03% |
| 6 months | 2 | 7.32% | 11.31% |
| 1 year | 1 | 20.11% | 23.88% |
| 3 years | 0 | unavailable | unavailable |

The weekly retained model did not beat the unchanged-price baseline on the tail. The monthly model did, with a limited sample. The long-horizon samples are inadequate for an adoption decision. Full-history three-year diagnostics have 38 overlapping origins but only two non-overlapping blocks; these must not be described as 38 independent validations. Falling-regime coverage is also limited.

Ridge 80 and trend 65 reduced weekly development MAPE but missed the predeclared validation improvement. Monthly alternatives did not improve both phases; some degraded direction or sideways-regime performance. The direct-252 long alternative improved some validation windows but failed the sample gate and was worse in parts of development. These alternatives were not adopted or retuned.

Metrics include MAPE, percentage RMSE, signed percentage bias, direction, interval coverage and 80% interval score. Raw archived interval metrics include initial volatility bands before eight calibration blocks; they are not claims of calibrated future probability. The webpage export flags whether initial calibration existed at each origin. One-year and three-year bands lack sufficient calibration in this dataset.

## Reproduction

From the repository root, with Node 22 or later:

```sh
node scripts/validate-model.mjs development docs/validation/4.5.0 --reproduce
node scripts/validate-model.mjs holdout docs/validation/4.5.0 --reproduce
node scripts/build-validation-report.mjs
node --test
```

The runner checks data/kernel hashes and compares results without rewriting sealed artifacts. `createdAt` is ignored when checking reproduction; forecasts, metrics, selection and reasons must match exactly. A separate hypothesis requires a separately declared experiment, not edits to this plan or sealed selection.

The page supports phase filtering, pagination, single-origin replay and CSV export; `data/model-validation.json` contains the derived report. Replaying against later revised historical data may differ from the frozen record; the archive preserves the original comparison data.

The forward ledger now groups by forecast-kernel hash rather than interface release. Publishing this unchanged kernel does not create a duplicate forecast for the same closed date or restart its outcome statistics. A changed kernel receives a separate identity. Existing forecasts, source hashes, creation times and resolved outcomes remain intact.
