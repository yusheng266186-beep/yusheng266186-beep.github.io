# AURUM · Gold Market Archive

[中文说明与版本记录](README.md) · [Live workspace](https://yusheng266186-beep.github.io/) · [Architecture](docs/ARCHITECTURE.md)

A browser workspace for observing domestic gold prices, reviewing evidence and historical releases, and exploring scenarios and a virtual account. The main quoted instrument is Shanghai Gold Exchange AU9999 in yuan per gram.

## Read the data

1. Use the quote and the source status together. Quote observation time, news publication time, news collection time, and research update time describe different events.
2. In Research, follow an item back to the original source, then review the date and conditions under which it was observed.
3. In Scenarios, change explicit inputs such as a reference gold price, exchange rate, or spread. Use the resulting conditional calculation as a sensitivity exercise. Keep historical replay, frozen published forecasts, and experiments separate when comparing results.
4. Use the simulated account to explore a sequence of choices and record observations. Trades and notes in that workspace are saved in the browser and have no connection to a broker.

Collection and publication are scheduled jobs. Delayed or degraded sources are shown in the application. Backtests and forecast ledgers describe specific samples and cutoff dates. The Chinese release notes link to protocols and validation records for individual experiments.

## Run or maintain the site

The public app is a static Pages build. Scripts and GitHub Actions produce the public market, news, research, and validation artifacts in <code>data/</code>. Local account and scenario notes are separate from these artifacts.

~~~bash
python3 -m http.server 8080
node scripts/verify-source.mjs
node --test
~~~

Open <http://localhost:8080/>. For maintainers, [automatic updates](docs/automatic-updates.md) explains collection windows, publication, and recovery. [Research desk](docs/research-desk.md) explains evidence, assumptions, and review. Use the project's configured deployment credentials for services and keep them in the execution environment.
