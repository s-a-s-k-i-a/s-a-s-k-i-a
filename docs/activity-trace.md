# Activity Trace data contract

The profile card makes one otherwise invisible fact legible: most of the work behind this account happens in private repositories. It does not expose those repositories.

## What is published

- public commit count;
- private-inclusive total commit count and the difference between both;
- aggregate pull-request and issue counts;
- the [GitHub Readme Stats](https://github.com/anuraghazra/github-readme-stats) rank and percentile heuristic.

The rank is **not an official GitHub score or platform ranking**. It is labelled as a GitHub Readme Stats heuristic in the card itself.

## Sources and privacy boundary

The public count comes from GitHub's public commit search. The private-inclusive totals come from Saskia's existing, self-hosted GitHub Readme Stats deployment, whose token can see the repositories that belong in the aggregate.

The refresh script extracts only numeric totals, rank and percentile. It never stores the source SVG, repository names, customer names, commit messages, code, email addresses or other private metadata. The public `data.json` schema is allowlisted and covered by a privacy regression test. If either source is unavailable or incomplete, the workflow fails and leaves the last verified card in place.

## Brand asset

The True North mark is the canonical transparent Isla Studio PNG, copied byte-for-byte into this repository. It is embedded as raster data inside the generated SVG container and is never redrawn as vector paths.

- file: `assets/profile/activity-trace/true-north-icon.png`
- SHA-256: `cd4b188bca3bd43dd8e70ceb6811e286f9a9d14253b02dfcfa33fcd62e2589bc`

## Refresh and verification

```bash
npm ci
npm run activity:refresh
npm test
```

The scheduled workflow runs twice daily and commits only when the verified aggregate assets change. Desktop and mobile are separate compositions, not a single scaled layout.
