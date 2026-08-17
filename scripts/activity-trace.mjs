import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Resvg } from "@resvg/resvg-js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ASSET_DIR = resolve(ROOT, "assets/profile/activity-trace");
const TEMPLATE_DIR = resolve(ASSET_DIR, "templates");
const DATA_PATH = resolve(ASSET_DIR, "data.json");
const LOGO_PATH = resolve(ASSET_DIR, "true-north-icon.png");
const FONT_REGULAR_PATH = resolve(
  ASSET_DIR,
  "fonts/GoogleSans-Latin-Regular.ttf",
);
const FONT_BOLD_PATH = resolve(ASSET_DIR, "fonts/GoogleSans-Latin-Bold.ttf");

const USERNAME = "s-a-s-k-i-a";
const STATS_URL =
  process.env.ACTIVITY_STATS_URL ||
  `https://github-readme-stats-mu-drab-12.vercel.app/api?username=${USERNAME}&include_all_commits=true&rank_icon=percentile&hide_border=true&activity_trace=1`;
const PUBLIC_COMMITS_URL =
  process.env.ACTIVITY_PUBLIC_COMMITS_URL ||
  `https://api.github.com/search/commits?q=author%3A${USERNAME}&per_page=1`;

const LOGO_SHA256 =
  "cd4b188bca3bd43dd8e70ceb6811e286f9a9d14253b02dfcfa33fcd62e2589bc";
const FONT_REGULAR_SHA256 =
  "ca12ffcf9fb834eb6f97ca7a53d014c3792b7c93ac940c35529af9ac2c0a7e4d";
const FONT_BOLD_SHA256 =
  "620fdb4bb3a7306d8042100311bd84f0ecab3d09253572220a8cbcc3bb3fc893";

const TOP_LEVEL_KEYS = [
  "schemaVersion",
  "username",
  "publicCommits",
  "totalCommits",
  "outsidePublicCommits",
  "outsidePublicPercent",
  "pullRequests",
  "issues",
  "rank",
  "percentile",
  "sources",
];

const VARIANTS = {
  desktop: {
    logicalWidth: 1280,
    outputWidth: 2560,
    trackWidth: 628,
    minimumPublicWidth: 34,
  },
  mobile: {
    logicalWidth: 720,
    outputWidth: 1440,
    trackWidth: 540,
    minimumPublicWidth: 30,
  },
};

function requireMatch(input, pattern, label) {
  const match = input.match(pattern);
  if (!match) {
    throw new Error(`Missing ${label} in aggregate source.`);
  }
  return match[1];
}

function parseInteger(value, label) {
  const normalized = String(value).trim().replaceAll(",", "");
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

function parseDecimal(value, label) {
  const normalized = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

export function parsePrivateInclusiveStats(svg) {
  if (typeof svg !== "string" || svg.length < 100 || svg.length > 250_000) {
    throw new Error("Private-inclusive aggregate response has an unexpected size.");
  }

  return {
    totalCommits: parseInteger(
      requireMatch(svg, /Total Commits\s*:\s*([\d,]+)/i, "total commits"),
      "total commits",
    ),
    pullRequests: parseInteger(
      requireMatch(svg, /Total PRs\s*:\s*([\d,]+)/i, "pull requests"),
      "pull requests",
    ),
    issues: parseInteger(
      requireMatch(svg, /Total Issues\s*:\s*([\d,]+)/i, "issues"),
      "issues",
    ),
    rank: requireMatch(
      svg,
      /GitHub Stats, Rank:\s*(S|A\+|A-|A|B\+|B-|B|C\+|C)/i,
      "rank",
    ).toUpperCase(),
    percentile: parseDecimal(
      requireMatch(
        svg,
        /data-testid="percentile-rank-value"[^>]*>\s*([\d.]+)%/i,
        "rank percentile",
      ),
      "rank percentile",
    ),
  };
}

export function parsePublicCommits(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Public commit response is not an object.");
  }
  if (payload.incomplete_results !== false) {
    throw new Error("GitHub reported an incomplete public commit result.");
  }
  return parseInteger(payload.total_count, "public commits");
}

export function buildActivityData(privateInclusive, publicCommits) {
  const totalCommits = parseInteger(
    privateInclusive.totalCommits,
    "total commits",
  );
  const publicCount = parseInteger(publicCommits, "public commits");
  if (publicCount > totalCommits) {
    throw new Error("Public commits cannot exceed private-inclusive commits.");
  }

  const outsidePublicCommits = totalCommits - publicCount;
  const outsidePublicPercent = totalCommits
    ? Math.round((outsidePublicCommits / totalCommits) * 100)
    : 0;

  const data = {
    schemaVersion: 1,
    username: USERNAME,
    publicCommits: publicCount,
    totalCommits,
    outsidePublicCommits,
    outsidePublicPercent,
    pullRequests: parseInteger(privateInclusive.pullRequests, "pull requests"),
    issues: parseInteger(privateInclusive.issues, "issues"),
    rank: String(privateInclusive.rank),
    percentile: parseDecimal(privateInclusive.percentile, "rank percentile"),
    sources: {
      public: "GitHub public commit search",
      privateInclusive: "GitHub Readme Stats heuristic",
    },
  };

  validateActivityData(data);
  return data;
}

export function validateActivityData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Activity data must be an object.");
  }
  const keys = Object.keys(data);
  if (
    keys.length !== TOP_LEVEL_KEYS.length ||
    TOP_LEVEL_KEYS.some((key) => !keys.includes(key))
  ) {
    throw new Error("Activity data contains missing or unapproved top-level keys.");
  }
  if (data.schemaVersion !== 1 || data.username !== USERNAME) {
    throw new Error("Activity data schema or username does not match.");
  }
  for (const key of [
    "publicCommits",
    "totalCommits",
    "outsidePublicCommits",
    "outsidePublicPercent",
    "pullRequests",
    "issues",
  ]) {
    parseInteger(data[key], key);
  }
  if (data.publicCommits + data.outsidePublicCommits !== data.totalCommits) {
    throw new Error("Activity commit aggregates do not add up.");
  }
  const expectedOutsidePercent = data.totalCommits
    ? Math.round((data.outsidePublicCommits / data.totalCommits) * 100)
    : 0;
  if (data.outsidePublicPercent !== expectedOutsidePercent) {
    throw new Error("Activity commit percentage does not match the aggregates.");
  }
  if (!/^(S|A\+|A|A-|B\+|B|B-|C\+|C)$/.test(data.rank)) {
    throw new Error(`Unexpected rank: ${data.rank}`);
  }
  parseDecimal(data.percentile, "rank percentile");
  if (
    !data.sources ||
    typeof data.sources !== "object" ||
    Array.isArray(data.sources) ||
    JSON.stringify(Object.keys(data.sources).sort()) !==
    JSON.stringify(["privateInclusive", "public"])
  ) {
    throw new Error("Activity sources contain unapproved keys.");
  }
  const serialized = JSON.stringify(data);
  if (/repo(?:sitory)?[_ -]?name|customer|client|commit[_ -]?message|email/i.test(serialized)) {
    throw new Error("Activity data contains private metadata fields.");
  }
  return data;
}

async function fetchChecked(url, expectedType) {
  const response = await fetch(url, {
    headers: {
      Accept: expectedType,
      "User-Agent": `${USERNAME}-activity-trace`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Aggregate source returned HTTP ${response.status}.`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes(expectedType.toLowerCase())) {
    throw new Error(
      `Aggregate source returned unexpected content type: ${contentType || "missing"}.`,
    );
  }
  return response;
}

export async function fetchActivityData() {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const [statsResponse, publicResponse] = await Promise.all([
        fetchChecked(STATS_URL, "image/svg+xml"),
        fetchChecked(PUBLIC_COMMITS_URL, "application/json"),
      ]);
      const [statsSvg, publicPayload] = await Promise.all([
        statsResponse.text(),
        publicResponse.json(),
      ]);
      return buildActivityData(
        parsePrivateInclusiveStats(statsSvg),
        parsePublicCommits(publicPayload),
      );
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolveDelay) =>
          setTimeout(resolveDelay, attempt * 1_000),
        );
      }
    }
  }
  throw new Error("Activity aggregate refresh failed after three attempts.", {
    cause: lastError,
  });
}

function replaceElementText(svg, attribute, value, replacement) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(<(?:text|tspan)\\b[^>]*\\b${attribute}="${escaped}"[^>]*>)([^<]*)(<\\/(?:text|tspan)>)`,
    "g",
  );
  let replacements = 0;
  const output = svg.replace(pattern, (match, start, oldValue, end) => {
    replacements += 1;
    return `${start}${replacement}${end}`;
  });
  if (!replacements) {
    throw new Error(`Template is missing ${attribute}=${value}.`);
  }
  return output;
}

function replaceRoleWidth(svg, role, width) {
  const pattern = new RegExp(
    `(<rect\\b[^>]*\\bdata-role="${role}"[^>]*?\\swidth=")[^"]+("[^>]*>)`,
  );
  if (!pattern.test(svg)) {
    throw new Error(`Template is missing the ${role} width marker.`);
  }
  return svg.replace(pattern, (match, start, end) => `${start}${width}${end}`);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function hydrateTemplate(template, data, logoDataUri, variantName) {
  validateActivityData(data);
  const variant = VARIANTS[variantName];
  if (!variant) {
    throw new Error(`Unknown Activity Trace variant: ${variantName}`);
  }
  if (!logoDataUri.startsWith("data:image/png;base64,")) {
    throw new Error("True North logo must be embedded as a PNG data URI.");
  }

  const publicWidth = data.totalCommits
    ? Math.max(
        variant.minimumPublicWidth,
        Math.round(variant.trackWidth * (data.publicCommits / data.totalCommits)),
      )
    : 0;
  const outsideWidth = data.totalCommits
    ? Math.round(
        variant.trackWidth *
          (data.outsidePublicCommits / data.totalCommits),
      )
    : 0;

  let svg = template.replace("{{LOGO_DATA_URI}}", logoDataUri);
  svg = replaceElementText(
    svg,
    "id",
    "public-commits",
    formatNumber(data.publicCommits),
  );
  svg = replaceElementText(
    svg,
    "id",
    "outside-public-percent",
    String(data.outsidePublicPercent),
  );
  svg = replaceElementText(
    svg,
    "id",
    "outside-public-commits",
    formatNumber(data.outsidePublicCommits),
  );
  svg = replaceElementText(
    svg,
    "data-dyn",
    "total-commits",
    formatNumber(data.totalCommits),
  );
  svg = replaceElementText(
    svg,
    "id",
    "total-commits",
    formatNumber(data.totalCommits),
  );
  svg = replaceElementText(
    svg,
    "id",
    "pull-requests",
    formatNumber(data.pullRequests),
  );
  svg = replaceElementText(svg, "id", "issues", formatNumber(data.issues));
  svg = replaceElementText(svg, "id", "rank", data.rank);
  svg = replaceElementText(
    svg,
    "id",
    "percentile",
    data.percentile.toFixed(1),
  );
  svg = replaceRoleWidth(svg, "public-fill", publicWidth);
  svg = replaceRoleWidth(svg, "outside-fill", outsideWidth);

  if (svg.includes("{{") || svg.includes("logo-true-north-sticker")) {
    throw new Error("Activity Trace template still contains an unresolved asset.");
  }
  return svg;
}

async function verifiedAsset(path, expectedHash, label) {
  const asset = await readFile(path);
  const hash = createHash("sha256").update(asset).digest("hex");
  if (hash !== expectedHash) {
    throw new Error(`${label} hash changed unexpectedly: ${hash}`);
  }
  return asset;
}

async function logoDataUri() {
  const logo = await verifiedAsset(LOGO_PATH, LOGO_SHA256, "True North logo");
  return `data:image/png;base64,${logo.toString("base64")}`;
}

export async function renderActivityTrace(data) {
  validateActivityData(data);
  const embeddedLogo = await logoDataUri();
  await Promise.all([
    verifiedAsset(
      FONT_REGULAR_PATH,
      FONT_REGULAR_SHA256,
      "Google Sans regular font",
    ),
    verifiedAsset(FONT_BOLD_PATH, FONT_BOLD_SHA256, "Google Sans bold font"),
  ]);

  for (const [name, variant] of Object.entries(VARIANTS)) {
    const template = await readFile(resolve(TEMPLATE_DIR, `${name}.svg`), "utf8");
    const svg = hydrateTemplate(template, data, embeddedLogo, name);
    await writeFile(resolve(ASSET_DIR, `${name}.svg`), svg);
    const renderer = new Resvg(svg, {
      fitTo: { mode: "width", value: variant.outputWidth },
      font: {
        fontFiles: [FONT_REGULAR_PATH, FONT_BOLD_PATH],
        loadSystemFonts: false,
        defaultFontFamily: "Google Sans 18pt",
      },
    });
    const png = renderer.render().asPng();
    await writeFile(resolve(ASSET_DIR, `${name}.png`), png);
  }
}

async function readCommittedData() {
  return validateActivityData(JSON.parse(await readFile(DATA_PATH, "utf8")));
}

async function writeActivityData(data) {
  await writeFile(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`);
}

async function main() {
  const command = process.argv[2] || "build";
  if (!new Set(["build", "refresh"]).has(command)) {
    throw new Error("Usage: node scripts/activity-trace.mjs [build|refresh]");
  }
  const data =
    command === "refresh" ? await fetchActivityData() : await readCommittedData();
  if (command === "refresh") {
    await writeActivityData(data);
  }
  await renderActivityTrace(data);
  process.stdout.write(
    `Activity Trace: ${formatNumber(data.publicCommits)} public / ${formatNumber(data.totalCommits)} total commits, rank ${data.rank}.\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

export {
  ASSET_DIR,
  DATA_PATH,
  FONT_BOLD_PATH,
  FONT_BOLD_SHA256,
  FONT_REGULAR_PATH,
  FONT_REGULAR_SHA256,
  LOGO_PATH,
  LOGO_SHA256,
  TOP_LEVEL_KEYS,
  VARIANTS,
};
