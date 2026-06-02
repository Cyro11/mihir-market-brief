# The Opening Ledger

Daily visual finance newsletter for a banking-style market brief.

## Direction

The product standard is paid-quality editorial judgment using free-access sources:

- high-impact headlines filtered for banking and investing relevance
- a recurring deal watch with valuation, rationale, risk, and update tracking
- macro interpretation with first-order and second-order effects
- visual market snapshot with rates, credit, sectors, and company read-throughs
- source discipline that validates importance against WSJ / FT / NYT themes when accessible

## Run Locally

```bash
npm install
npm run daily
npm run dev
```

## Open Latest Issue Without Downloading

From any computer or phone, use the free GitHub Pages URL:

- `https://cyro11.github.io/mihir-market-brief/`
- `https://cyro11.github.io/mihir-market-brief/issues/latest.html`

Use the desktop launcher:

- `C:\Users\norse\Desktop\Open Mihir Market Brief.cmd`

It starts the local Vite server if needed and opens the stable latest-newsletter URL:

- `http://127.0.0.1:5173/`

The live newsletter is generated from structured public data:

- `index.html` - live entry point
- `moves.html`, `deep-dive.html`, `themes.html`, `sources.html` - dedicated research pages
- `issues/latest.html` - copy of the latest issue
- `data/sources/latest.json` - fetched source items
- `data/candidates/YYYY-MM-DD.json` - scored editorial candidate pool
- `data/analysis/YYYY-MM-DD.json` - selected banker analysis
- `data/editions/YYYY-MM-DD.json` - approved edition content
- `data/reviews/YYYY-MM-DD.json` - blocking review results

## Daily Pipeline

```bash
npm run fetch    # official/free source collection
npm run analyze  # triage, select, and generate banker analysis
npm run review   # block stale, unsupported, or generic output
npm run render   # generate index.html and issue archives
npm run build    # copy the static site to dist/
```

The system is intentionally selective. A quiet day with fewer or zero main items is valid when fresh source-backed items do not clear the evidence bar.

## Automation

GitHub Actions runs the brief without Codex being open. The scheduled workflow targets 9:35 AM America/New_York on market weekdays, five minutes after the regular U.S. equity open. Because GitHub schedules use UTC, the workflow has both daylight-saving and standard-time cron entries plus a guard script that skips the off-season duplicate and NYSE full holidays.

Manual runs are still available from the GitHub Actions tab through `workflow_dispatch`.

## Daily Update Goal

Each daily issue should keep the visual newsletter format, but the source of truth is now structured data. The rendered issue should update:

1. selected market-moving items
2. banker analysis and valuation / financing implications
3. theme pulse
4. one deep dive when there is enough evidence
5. watch-next items
6. source and review footer

Do not stuff the template. Publish only what earns its seat.
