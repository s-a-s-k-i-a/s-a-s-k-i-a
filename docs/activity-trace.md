# Activity Trace data contract

The card makes sustained work visible without exposing the private repositories behind it. Its primary number now uses GitHub's own **contribution** unit; commit-search and rank heuristics remain visibly separate.

## Three different measurements

### 1. GitHub contributions — primary

The headline numbers come from GitHub's GraphQL `contributionsCollection`:

- **all time:** the exact `contributionCalendar.totalContributions` values summed across every contribution year returned for this account;
- **last 12 months:** the exact contribution-calendar total from the same calendar date one year ago through the current UTC date.

GitHub contributions are broader than commits. Depending on GitHub's eligibility rules, the calendar can include commits, issues, pull requests, reviews and other recognized activity. When private-contribution sharing is enabled, the public profile exposes anonymized counts without repository or organization details. See GitHub's [profile contributions reference](https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference) and [`ContributionsCollection`](https://docs.github.com/en/graphql/reference/objects#contributionscollection).

### 2. Private-inclusive search aggregates — secondary

The compact trace and bottom strip come from two search-oriented sources:

- public commits from GitHub's public commit search;
- private-inclusive commits, pull requests and issues from Saskia's existing self-hosted [GitHub Readme Stats](https://github.com/anuraghazra/github-readme-stats) deployment.

These are lifetime search aggregates, not contribution-calendar events. They must not be added to, subtracted from or presented as a decomposition of the contribution headline.

### 3. Rank — separate heuristic

The A–style rank and percentile are calculated by GitHub Readme Stats from its own weighted model. The seal is labelled **README-STATS RANK** because this is **not an official GitHub score or platform ranking**.

## Published schema and privacy boundary

The public `data.json` contains only:

- all-time and rolling-year contribution totals plus the rolling date window;
- public and private-inclusive commit-search totals;
- private-inclusive pull-request and issue search totals;
- rank and percentile;
- fixed source labels.

The script never stores GraphQL source responses, source SVGs, repository names, customer names, organization names, commit messages, code, email addresses or other private metadata. Nested allowlists and privacy regression tests reject unapproved fields. If a source is unavailable, incomplete or semantically impossible, the workflow fails and leaves the last verified card in place.

## Brand asset and deterministic rendering

The True North mark is the canonical transparent Isla Studio PNG, copied byte-for-byte into this repository and embedded as raster data inside the generated SVG container.

- file: `assets/profile/activity-trace/true-north-icon.png`
- SHA-256: `cd4b188bca3bd43dd8e70ceb6811e286f9a9d14253b02dfcfa33fcd62e2589bc`

The rasterizer loads pinned regular and bold instances of the Google Sans 18pt font used by the current Isla design system and disables system-font fallback. Bundled fonts remain under the SIL Open Font License in `assets/profile/activity-trace/fonts/`.

- regular SHA-256: `ca12ffcf9fb834eb6f97ca7a53d014c3792b7c93ac940c35529af9ac2c0a7e4d`
- bold SHA-256: `620fdb4bb3a7306d8042100311bd84f0ecab3d09253572220a8cbcc3bb3fc893`

## Refresh and verification

```bash
GITHUB_TOKEN="<token with public GraphQL access>" npm run activity:refresh
npm test
```

The scheduled workflow uses its short-lived repository token, runs twice daily and commits only when verified aggregate data or generated assets change. Desktop and mobile remain separate compositions rather than one scaled layout.
