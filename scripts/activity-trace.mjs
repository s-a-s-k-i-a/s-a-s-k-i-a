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
const GITHUB_GRAPHQL_URL =
  process.env.ACTIVITY_GITHUB_GRAPHQL_URL || "https://api.github.com/graphql";

const LOGO_SHA256 =
  "cd4b188bca3bd43dd8e70ceb6811e286f9a9d14253b02dfcfa33fcd62e2589bc";
const FONT_REGULAR_SHA256 =
  "ca12ffcf9fb834eb6f97ca7a53d014c3792b7c93ac940c35529af9ac2c0a7e4d";
const FONT_BOLD_SHA256 =
  "620fdb4bb3a7306d8042100311bd84f0ecab3d09253572220a8cbcc3bb3fc893";

const TOP_LEVEL_KEYS = [
  "schemaVersion",
  "username",
  "contributions",
  "searchAggregates",
  "rankHeuristic",
  "sources",
];
const CONTRIBUTION_KEYS = ["allTime", "rollingYear", "from", "to"];
const SEARCH_AGGREGATE_KEYS = [
  "publicCommits",
  "privateInclusiveCommits",
  "privateInclusivePullRequests",
  "privateInclusiveIssues",
];
const RANK_KEYS = ["rank", "percentile"];
const SOURCE_KEYS = [
  "contributions",
  "publicCommitSearch",
  "privateInclusiveSearch",
];

const VARIANTS = {
  desktop: {
    logicalWidth: 1280,
    outputWidth: 2560,
    contributionTrackWidth: 628,
    minimumRollingWidth: 34,
  },
  mobile: {
    logicalWidth: 720,
    outputWidth: 1440,
    contributionTrackWidth: 540,
    minimumRollingWidth: 30,
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

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const actual = Object.keys(value);
  if (
    actual.length !== expected.length ||
    expected.some((key) => !actual.includes(key))
  ) {
    throw new Error(`${label} contains missing or unapproved keys.`);
  }
}

function parseDateOnly(value, label) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return { year, month, day };
}

function formatDateOnly(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function contributionWindow(asOf = process.env.ACTIVITY_AS_OF) {
  const current = asOf || new Date().toISOString().slice(0, 10);
  const { year, month, day } = parseDateOnly(current, "activity date");
  const fromYear = year - 1;
  const fromDay = Math.min(day, daysInMonth(fromYear, month));
  const from = formatDateOnly(fromYear, month, fromDay);
  const to = formatDateOnly(year, month, day);
  return {
    from,
    to,
    fromDateTime: `${from}T00:00:00Z`,
    toDateTime: `${to}T23:59:59Z`,
  };
}

export function parsePrivateInclusiveStats(svg) {
  if (typeof svg !== "string" || svg.length < 100 || svg.length > 250_000) {
    throw new Error("Private-inclusive aggregate response has an unexpected size.");
  }

  return {
    commits: parseInteger(
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

export function parseContributionYears(data) {
  const years = data?.user?.contributionsCollection?.contributionYears;
  if (!Array.isArray(years) || years.length === 0) {
    throw new Error("GitHub contribution years are missing.");
  }
  const currentYear = new Date().getUTCFullYear();
  const normalized = years.map((year) => parseInteger(year, "contribution year"));
  if (
    normalized.some((year) => year < 2008 || year > currentYear) ||
    new Set(normalized).size !== normalized.length
  ) {
    throw new Error("GitHub contribution years are invalid.");
  }
  return normalized.sort((a, b) => b - a);
}

export function buildContributionTotalsQuery(years, window) {
  const sortedYears = [...years].sort((a, b) => b - a);
  if (!sortedYears.length || new Set(sortedYears).size !== sortedYears.length) {
    throw new Error("Contribution-year query requires unique years.");
  }
  const toYear = parseDateOnly(window.to, "rolling-window end").year;
  const selections = sortedYears.map((year) => {
    const parsedYear = parseInteger(year, "contribution year");
    if (parsedYear < 2008 || parsedYear > toYear) {
      throw new Error(`Invalid contribution year: ${parsedYear}`);
    }
    const to =
      parsedYear === toYear
        ? window.toDateTime
        : `${parsedYear}-12-31T23:59:59Z`;
    return `y${parsedYear}: contributionsCollection(from: "${parsedYear}-01-01T00:00:00Z", to: "${to}") { contributionCalendar { totalContributions } }`;
  });
  selections.push(
    `rolling: contributionsCollection(from: "${window.fromDateTime}", to: "${window.toDateTime}") { contributionCalendar { totalContributions } }`,
  );
  return `query ActivityContributionTotals($login: String!) { user(login: $login) { ${selections.join(" ")} } }`;
}

export function parseContributionTotals(data, years, window) {
  const user = data?.user;
  if (!user || typeof user !== "object") {
    throw new Error("GitHub contribution totals are missing.");
  }
  const allTime = years.reduce((sum, year) => {
    const total = user[`y${year}`]?.contributionCalendar?.totalContributions;
    return sum + parseInteger(total, `contributions in ${year}`);
  }, 0);
  const rollingYear = parseInteger(
    user.rolling?.contributionCalendar?.totalContributions,
    "rolling-year contributions",
  );
  if (rollingYear > allTime) {
    throw new Error("Rolling-year contributions cannot exceed all-time contributions.");
  }
  return {
    allTime,
    rollingYear,
    from: window.from,
    to: window.to,
  };
}

export function buildActivityData(contributions, privateInclusive, publicCommits) {
  const publicCount = parseInteger(publicCommits, "public commits");
  const privateInclusiveCommits = parseInteger(
    privateInclusive.commits,
    "private-inclusive commits",
  );
  if (publicCount > privateInclusiveCommits) {
    throw new Error("Public commits cannot exceed private-inclusive commits.");
  }

  const data = {
    schemaVersion: 2,
    username: USERNAME,
    contributions: {
      allTime: parseInteger(contributions.allTime, "all-time contributions"),
      rollingYear: parseInteger(
        contributions.rollingYear,
        "rolling-year contributions",
      ),
      from: String(contributions.from),
      to: String(contributions.to),
    },
    searchAggregates: {
      publicCommits: publicCount,
      privateInclusiveCommits,
      privateInclusivePullRequests: parseInteger(
        privateInclusive.pullRequests,
        "private-inclusive pull requests",
      ),
      privateInclusiveIssues: parseInteger(
        privateInclusive.issues,
        "private-inclusive issues",
      ),
    },
    rankHeuristic: {
      rank: String(privateInclusive.rank),
      percentile: parseDecimal(
        privateInclusive.percentile,
        "rank percentile",
      ),
    },
    sources: {
      contributions: "GitHub contribution calendars",
      publicCommitSearch: "GitHub public commit search",
      privateInclusiveSearch: "GitHub Readme Stats heuristic",
    },
  };

  validateActivityData(data);
  return data;
}

export function validateActivityData(data) {
  assertExactKeys(data, TOP_LEVEL_KEYS, "Activity data");
  if (data.schemaVersion !== 2 || data.username !== USERNAME) {
    throw new Error("Activity data schema or username does not match.");
  }

  assertExactKeys(data.contributions, CONTRIBUTION_KEYS, "Contribution data");
  const allTime = parseInteger(
    data.contributions.allTime,
    "all-time contributions",
  );
  const rollingYear = parseInteger(
    data.contributions.rollingYear,
    "rolling-year contributions",
  );
  if (rollingYear > allTime) {
    throw new Error("Rolling-year contributions cannot exceed all-time contributions.");
  }
  const from = parseDateOnly(data.contributions.from, "rolling-window start");
  const to = parseDateOnly(data.contributions.to, "rolling-window end");
  if (
    Date.UTC(from.year, from.month - 1, from.day) >=
    Date.UTC(to.year, to.month - 1, to.day)
  ) {
    throw new Error("Rolling contribution window is not chronological.");
  }

  assertExactKeys(
    data.searchAggregates,
    SEARCH_AGGREGATE_KEYS,
    "Search aggregates",
  );
  for (const key of SEARCH_AGGREGATE_KEYS) {
    parseInteger(data.searchAggregates[key], key);
  }
  if (
    data.searchAggregates.publicCommits >
    data.searchAggregates.privateInclusiveCommits
  ) {
    throw new Error("Public commits cannot exceed private-inclusive commits.");
  }

  assertExactKeys(data.rankHeuristic, RANK_KEYS, "Rank heuristic");
  if (!/^(S|A\+|A|A-|B\+|B|B-|C\+|C)$/.test(data.rankHeuristic.rank)) {
    throw new Error(`Unexpected rank: ${data.rankHeuristic.rank}`);
  }
  parseDecimal(data.rankHeuristic.percentile, "rank percentile");

  assertExactKeys(data.sources, SOURCE_KEYS, "Activity sources");
  const expectedSources = {
    contributions: "GitHub contribution calendars",
    publicCommitSearch: "GitHub public commit search",
    privateInclusiveSearch: "GitHub Readme Stats heuristic",
  };
  if (JSON.stringify(data.sources) !== JSON.stringify(expectedSources)) {
    throw new Error("Activity sources do not match the approved source labels.");
  }

  const serialized = JSON.stringify(data);
  if (
    /repo(?:sitory)?[_ -]?name|customer|client|commit[_ -]?message|email/i.test(
      serialized,
    )
  ) {
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

async function fetchGitHubGraphql(query) {
  const token = process.env.ACTIVITY_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is required for contribution aggregates.");
  }
  const response = await fetch(GITHUB_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": `${USERNAME}-activity-trace`,
    },
    body: JSON.stringify({ query, variables: { login: USERNAME } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub GraphQL returned HTTP ${response.status}.`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(
      `GitHub GraphQL returned unexpected content type: ${contentType || "missing"}.`,
    );
  }
  const payload = await response.json();
  if (Array.isArray(payload.errors) && payload.errors.length) {
    throw new Error("GitHub GraphQL returned contribution-query errors.");
  }
  if (!payload.data) {
    throw new Error("GitHub GraphQL returned no contribution data.");
  }
  return payload.data;
}

async function fetchContributionData() {
  const yearsPayload = await fetchGitHubGraphql(
    "query ActivityContributionYears($login: String!) { user(login: $login) { contributionsCollection { contributionYears } } }",
  );
  const years = parseContributionYears(yearsPayload);
  const window = contributionWindow();
  const totalsPayload = await fetchGitHubGraphql(
    buildContributionTotalsQuery(years, window),
  );
  return parseContributionTotals(totalsPayload, years, window);
}

export async function fetchActivityData() {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const [contributions, statsResponse, publicResponse] = await Promise.all([
        fetchContributionData(),
        fetchChecked(STATS_URL, "image/svg+xml"),
        fetchChecked(PUBLIC_COMMITS_URL, "application/json"),
      ]);
      const [statsSvg, publicPayload] = await Promise.all([
        statsResponse.text(),
        publicResponse.json(),
      ]);
      return buildActivityData(
        contributions,
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

  const rollingPercent = data.contributions.allTime
    ? Math.round(
        (data.contributions.rollingYear / data.contributions.allTime) * 100,
      )
    : 0;
  const rollingWidth = data.contributions.allTime
    ? Math.max(
        variant.minimumRollingWidth,
        Math.round(
          variant.contributionTrackWidth *
            (data.contributions.rollingYear / data.contributions.allTime),
        ),
      )
    : 0;

  let svg = template.replace("{{LOGO_DATA_URI}}", logoDataUri);
  svg = replaceElementText(
    svg,
    "id",
    "all-time-contributions",
    formatNumber(data.contributions.allTime),
  );
  svg = replaceElementText(
    svg,
    "id",
    "rolling-contributions",
    formatNumber(data.contributions.rollingYear),
  );
  svg = replaceElementText(
    svg,
    "id",
    "rolling-percent",
    String(rollingPercent),
  );
  svg = replaceElementText(
    svg,
    "id",
    "public-commits",
    formatNumber(data.searchAggregates.publicCommits),
  );
  svg = replaceElementText(
    svg,
    "data-dyn",
    "private-inclusive-commits",
    formatNumber(data.searchAggregates.privateInclusiveCommits),
  );
  svg = replaceElementText(
    svg,
    "id",
    "private-inclusive-commits",
    formatNumber(data.searchAggregates.privateInclusiveCommits),
  );
  svg = replaceElementText(
    svg,
    "id",
    "pull-requests",
    formatNumber(data.searchAggregates.privateInclusivePullRequests),
  );
  svg = replaceElementText(
    svg,
    "id",
    "issues",
    formatNumber(data.searchAggregates.privateInclusiveIssues),
  );
  svg = replaceElementText(svg, "id", "rank", data.rankHeuristic.rank);
  svg = replaceElementText(
    svg,
    "id",
    "percentile",
    data.rankHeuristic.percentile.toFixed(1),
  );
  svg = replaceRoleWidth(svg, "rolling-fill", rollingWidth);

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
    `Activity Trace: ${formatNumber(data.contributions.allTime)} all-time / ${formatNumber(data.contributions.rollingYear)} rolling-year contributions; ${formatNumber(data.searchAggregates.privateInclusiveCommits)} private-inclusive commit-search results; rank ${data.rankHeuristic.rank}.\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

export {
  ASSET_DIR,
  CONTRIBUTION_KEYS,
  DATA_PATH,
  FONT_BOLD_PATH,
  FONT_BOLD_SHA256,
  FONT_REGULAR_PATH,
  FONT_REGULAR_SHA256,
  LOGO_PATH,
  LOGO_SHA256,
  RANK_KEYS,
  SEARCH_AGGREGATE_KEYS,
  SOURCE_KEYS,
  TOP_LEVEL_KEYS,
  VARIANTS,
};
