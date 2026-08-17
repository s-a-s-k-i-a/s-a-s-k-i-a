import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  ASSET_DIR,
  CONTRIBUTION_KEYS,
  DATA_PATH,
  FONT_BOLD_PATH,
  FONT_BOLD_SHA256,
  FONT_REGULAR_PATH,
  FONT_REGULAR_SHA256,
  LOGO_SHA256,
  RANK_KEYS,
  SEARCH_AGGREGATE_KEYS,
  SOURCE_KEYS,
  TOP_LEVEL_KEYS,
  VARIANTS,
  buildActivityData,
  buildContributionTotalsQuery,
  contributionWindow,
  parseContributionTotals,
  parseContributionYears,
  parsePrivateInclusiveStats,
  parsePublicCommits,
  validateActivityData,
} from "./activity-trace.mjs";

const ROOT = resolve(ASSET_DIR, "../../..");

function readPngDimensions(bytes) {
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR");
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes.readUInt8(25),
  };
}

test("parses aggregate search values without treating them as contributions", () => {
  const statsSvg = `
    <svg>
      <title>Saskia Teichmann's GitHub Stats, Rank: A-</title>
      <desc>Total Stars Earned: 27, Total Commits  : 3885, Total PRs: 991, Total Issues: 1876</desc>
      <text data-testid="percentile-rank-value">35.3%</text>
    </svg>`;
  const privateInclusive = parsePrivateInclusiveStats(statsSvg);
  const publicCommits = parsePublicCommits({
    total_count: 196,
    incomplete_results: false,
  });
  const data = buildActivityData(
    {
      allTime: 6908,
      rollingYear: 6494,
      from: "2025-08-17",
      to: "2026-08-17",
    },
    privateInclusive,
    publicCommits,
  );

  assert.deepEqual(data, {
    schemaVersion: 2,
    username: "s-a-s-k-i-a",
    contributions: {
      allTime: 6908,
      rollingYear: 6494,
      from: "2025-08-17",
      to: "2026-08-17",
    },
    searchAggregates: {
      publicCommits: 196,
      privateInclusiveCommits: 3885,
      privateInclusivePullRequests: 991,
      privateInclusiveIssues: 1876,
    },
    rankHeuristic: {
      rank: "A-",
      percentile: 35.3,
    },
    sources: {
      contributions: "GitHub contribution calendars",
      publicCommitSearch: "GitHub public commit search",
      privateInclusiveSearch: "GitHub Readme Stats heuristic",
    },
  });
});

test("builds a bounded rolling window and all-history contribution query", () => {
  const window = contributionWindow("2026-08-17");
  assert.deepEqual(window, {
    from: "2025-08-17",
    to: "2026-08-17",
    fromDateTime: "2025-08-17T00:00:00Z",
    toDateTime: "2026-08-17T23:59:59Z",
  });

  const query = buildContributionTotalsQuery([2026, 2025, 2013], window);
  assert.match(query, /y2026: contributionsCollection/);
  assert.match(query, /y2013: contributionsCollection/);
  assert.match(query, /rolling: contributionsCollection/);
  assert.match(query, /2025-08-17T00:00:00Z/);
  assert.match(query, /2026-08-17T23:59:59Z/);
});

test("parses contribution years and sums exact contribution-calendar totals", () => {
  const years = parseContributionYears({
    user: {
      contributionsCollection: { contributionYears: [2026, 2025, 2024] },
    },
  });
  assert.deepEqual(years, [2026, 2025, 2024]);

  const totals = parseContributionTotals(
    {
      user: {
        y2026: { contributionCalendar: { totalContributions: 6489 } },
        y2025: { contributionCalendar: { totalContributions: 24 } },
        y2024: { contributionCalendar: { totalContributions: 145 } },
        rolling: { contributionCalendar: { totalContributions: 6494 } },
      },
    },
    years,
    contributionWindow("2026-08-17"),
  );
  assert.deepEqual(totals, {
    allTime: 6658,
    rollingYear: 6494,
    from: "2025-08-17",
    to: "2026-08-17",
  });
});

test("rejects incomplete or semantically impossible aggregates", () => {
  assert.throws(
    () => parsePublicCommits({ total_count: 10, incomplete_results: true }),
    /incomplete/,
  );
  assert.throws(
    () =>
      buildActivityData(
        {
          allTime: 20,
          rollingYear: 21,
          from: "2025-08-17",
          to: "2026-08-17",
        },
        {
          commits: 10,
          pullRequests: 1,
          issues: 1,
          rank: "B",
          percentile: 50,
        },
        5,
      ),
    /cannot exceed/,
  );
  assert.throws(
    () =>
      buildActivityData(
        {
          allTime: 20,
          rollingYear: 10,
          from: "2025-08-17",
          to: "2026-08-17",
        },
        {
          commits: 10,
          pullRequests: 1,
          issues: 1,
          rank: "B",
          percentile: 50,
        },
        11,
      ),
    /Public commits cannot exceed/,
  );
});

test("committed public data uses only the nested allowlist", async () => {
  const data = validateActivityData(
    JSON.parse(await readFile(DATA_PATH, "utf8")),
  );
  assert.deepEqual(Object.keys(data), TOP_LEVEL_KEYS);
  assert.deepEqual(Object.keys(data.contributions), CONTRIBUTION_KEYS);
  assert.deepEqual(Object.keys(data.searchAggregates), SEARCH_AGGREGATE_KEYS);
  assert.deepEqual(Object.keys(data.rankHeuristic), RANK_KEYS);
  assert.deepEqual(Object.keys(data.sources), SOURCE_KEYS);
  assert.ok(data.contributions.allTime >= data.contributions.rollingYear);
  assert.ok(
    data.searchAggregates.privateInclusiveCommits >=
      data.searchAggregates.publicCommits,
  );
  const serialized = JSON.stringify(data);
  assert.doesNotMatch(
    serialized,
    /repo(?:sitory)?[_ -]?name|customer|client|commit[_ -]?message|email/i,
  );
});

test("README explains that contributions, commit search and rank are separate", async () => {
  const readme = await readFile(resolve(ROOT, "README.md"), "utf8");
  assert.match(readme, /Contributions and commit-search totals are different units/i);
  assert.match(readme, /not an official GitHub score/i);
});

test("hero keeps the approved animation and a real static fallback", async () => {
  const readme = await readFile(resolve(ROOT, "README.md"), "utf8");
  assert.match(
    readme,
    /<source media="\(prefers-reduced-motion: no-preference\)"[^>]+guided-commit-tunnel\.gif\?v=2/,
  );
  assert.match(
    readme,
    /<img src="\.\/assets\/profile\/guided-commit-tunnel-static\.png\?v=2"/,
  );

  const assets = [
    [
      "guided-commit-tunnel.gif",
      "bed5b74d4768552c71821e04860fd784931984c94b2aab383a4f18e635dfb04f",
    ],
    [
      "guided-commit-tunnel-static.png",
      "232a29eec74dc7a876066c6d7717f8005993cb7e6e13236f1873c0dd5310468d",
    ],
  ];
  for (const [file, expectedHash] of assets) {
    const bytes = await readFile(resolve(ROOT, "assets/profile", file));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedHash);
  }
});

test("renderer uses the pinned regular and bold Isla font instances", async () => {
  const fonts = [
    [FONT_REGULAR_PATH, FONT_REGULAR_SHA256],
    [FONT_BOLD_PATH, FONT_BOLD_SHA256],
  ];
  for (const [path, expectedHash] of fonts) {
    const font = await readFile(path);
    assert.equal(createHash("sha256").update(font).digest("hex"), expectedHash);
  }
});

for (const [name, variant] of Object.entries(VARIANTS)) {
  test(`${name} output contains both metric systems and the canonical raster logo`, async () => {
    const data = JSON.parse(await readFile(DATA_PATH, "utf8"));
    const svg = await readFile(resolve(ASSET_DIR, `${name}.svg`), "utf8");
    assert.doesNotMatch(svg, /\{\{|logo-true-north-sticker/);
    assert.match(
      svg,
      new RegExp(`id="rank"[^>]*>${data.rankHeuristic.rank}<`),
    );
    assert.match(
      svg,
      new RegExp(
        `id="all-time-contributions"[^>]*>${data.contributions.allTime.toLocaleString("en-US")}<`,
      ),
    );
    assert.match(
      svg,
      new RegExp(
        `id="rolling-contributions"[^>]*>${data.contributions.rollingYear.toLocaleString("en-US")}<`,
      ),
    );
    assert.match(
      svg,
      new RegExp(
        `id="private-inclusive-commits"[^>]*>${data.searchAggregates.privateInclusiveCommits.toLocaleString("en-US")}<`,
      ),
    );

    const logoMatch = svg.match(/href="data:image\/png;base64,([^"]+)"/);
    assert.ok(logoMatch, "canonical logo is embedded in the SVG container");
    const logoHash = createHash("sha256")
      .update(Buffer.from(logoMatch[1], "base64"))
      .digest("hex");
    assert.equal(logoHash, LOGO_SHA256);

    const png = await readFile(resolve(ASSET_DIR, `${name}.png`));
    const metadata = readPngDimensions(png);
    assert.equal(metadata.width, variant.outputWidth);
    assert.equal(
      metadata.height,
      Math.round(
        variant.outputWidth *
          (name === "desktop"
            ? 420 / variant.logicalWidth
            : 680 / variant.logicalWidth),
      ),
    );
    assert.ok([4, 6].includes(metadata.colorType), "PNG keeps an alpha channel");
  });
}
