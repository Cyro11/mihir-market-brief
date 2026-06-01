# Daily Update Workflow

Use structured data as the source of truth. `index.html` is generated output.

## Daily Process

The scheduled GitHub Actions workflow runs at 9:35 AM America/New_York on market weekdays. Codex does not need to be open.

1. Fetch a bounded official/free source set with `npm run fetch`.
2. Score candidates with `npm run analyze`.
3. Select only items with freshness, source quality, hard evidence, banking relevance, and theme relevance.
4. Run blocking review with `npm run review`.
5. Render the public issue with `npm run render`.
6. Build the static site with `npm run build`.

## Editorial Rule

The newsletter should be useful for banking judgment: valuation, financing, deal activity, sector read-throughs, and second-order effects. A section should be skipped when the evidence is weak.
