import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  ASSET_DIR,
  DATA_PATH,
  FONT_BOLD_PATH,
  FONT_BOLD_SHA256,
  FONT_REGULAR_PATH,
  FONT_REGULAR_SHA256,
  LOGO_SHA256,
  TOP_LEVEL_KEYS,
  VARIANTS,
  buildActivityData,
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

test("parses only aggregate values from the two sources", () => {
  const statsSvg = `
    <svg>
      <title>Saskia Teichmann's GitHub Stats, Rank: A-</title>
      <desc>Total Stars Earned: 27, Total Commits  : 3864, Total PRs: 980, Total Issues: 1875</desc>
      <text data-testid="percentile-rank-value">35.3%</text>
    </svg>`;
  const privateInclusive = parsePrivateInclusiveStats(statsSvg);
  const publicCommits = parsePublicCommits({
    total_count: 195,
    incomplete_results: false,
  });
  assert.deepEqual(buildActivityData(privateInclusive, publicCommits), {
    schemaVersion: 1,
    username: "s-a-s-k-i-a",
    publicCommits: 195,
    totalCommits: 3864,
    outsidePublicCommits: 3669,
    outsidePublicPercent: 95,
    pullRequests: 980,
    issues: 1875,
    rank: "A-",
    percentile: 35.3,
    sources: {
      public: "GitHub public commit search",
      privateInclusive: "GitHub Readme Stats heuristic",
    },
  });
});

test("rejects incomplete or impossible aggregates", () => {
  assert.throws(
    () => parsePublicCommits({ total_count: 10, incomplete_results: true }),
    /incomplete/,
  );
  assert.throws(
    () =>
      buildActivityData(
        {
          totalCommits: 10,
          pullRequests: 1,
          issues: 1,
          rank: "B",
          percentile: 50,
        },
        11,
      ),
    /cannot exceed/,
  );
});

test("committed public data is allowlisted and privacy-safe", async () => {
  const data = validateActivityData(
    JSON.parse(await readFile(DATA_PATH, "utf8")),
  );
  assert.deepEqual(Object.keys(data), TOP_LEVEL_KEYS);
  const serialized = JSON.stringify(data);
  assert.doesNotMatch(
    serialized,
    /repo(?:sitory)?[_ -]?name|customer|client|commit[_ -]?message|email/i,
  );
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
  test(`${name} output contains current aggregates and the canonical raster logo`, async () => {
    const data = JSON.parse(await readFile(DATA_PATH, "utf8"));
    const svg = await readFile(resolve(ASSET_DIR, `${name}.svg`), "utf8");
    assert.doesNotMatch(svg, /\{\{|logo-true-north-sticker/);
    assert.doesNotMatch(svg, /stroke-width="(?:30|34|513|596)"/);
    assert.match(svg, new RegExp(`id="rank"[^>]*>${data.rank}<`));
    assert.match(
      svg,
      new RegExp(
        `id="outside-public-commits"[^>]*>${data.outsidePublicCommits.toLocaleString("en-US")}<`,
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
