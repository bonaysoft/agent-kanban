#!/usr/bin/env node
/**
 * Cost killswitch: queries Cloudflare GraphQL Analytics for today's usage
 * and exits non-zero when any threshold is exceeded.
 *
 * Env:
 *   CF_ACCOUNT_ID             — required
 *   CF_API_TOKEN              — required, needs Analytics: Read
 *   DAILY_WORKER_REQUESTS     — optional, default 1_000_000
 *   DAILY_D1_ROWS_READ        — optional, default 10_000_000
 *   DAILY_DO_REQUESTS         — optional, default 500_000
 *   DAILY_DO_DURATION_SEC     — optional, default 100_000  (active seconds, not GB-sec)
 *
 * Exit codes:
 *   0  — all thresholds ok
 *   1  — one or more thresholds tripped
 *   2  — query failed (treat as unknown, do NOT auto-disable)
 *
 * Stdout: a single JSON line with { tripped, usage, thresholds, reasons }
 * Stderr: human-readable diagnostics
 */

const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const API_TOKEN = process.env.CF_API_TOKEN;

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error("CF_ACCOUNT_ID and CF_API_TOKEN are required");
  process.exit(2);
}

// GitHub Actions passes undefined repo vars as "", so use || to fall through
// to defaults on both empty string and undefined.
const thresholds = {
  workerRequests: Number(process.env.DAILY_WORKER_REQUESTS || 1_000_000),
  d1RowsRead: Number(process.env.DAILY_D1_ROWS_READ || 10_000_000),
  doRequests: Number(process.env.DAILY_DO_REQUESTS || 500_000),
  doDurationSec: Number(process.env.DAILY_DO_DURATION_SEC || 100_000),
};

// UTC day window — CF billing resets at 00:00 UTC
const now = new Date();
const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const startIso = start.toISOString();
const nowIso = now.toISOString();

const query = `
  query Usage($accountTag: String!, $start: Time!, $end: Time!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        workersInvocationsAdaptive(
          filter: { datetime_geq: $start, datetime_lt: $end }
          limit: 10000
        ) {
          sum { requests errors }
        }
        durableObjectsInvocationsAdaptiveGroups(
          filter: { datetime_geq: $start, datetime_lt: $end }
          limit: 10000
        ) {
          sum { requests }
        }
        durableObjectsPeriodicGroups(
          filter: { datetime_geq: $start, datetime_lt: $end }
          limit: 10000
        ) {
          sum { activeTime }
        }
        d1AnalyticsAdaptiveGroups(
          filter: { datetime_geq: $start, datetime_lt: $end }
          limit: 10000
        ) {
          sum { readQueries writeQueries rowsRead rowsWritten }
        }
      }
    }
  }
`;

async function callGraphQL() {
  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: { accountTag: ACCOUNT_ID, start: startIso, end: nowIso },
    }),
  });
  if (!res.ok) {
    throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  if (data.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
  }
  return data.data.viewer.accounts[0] ?? {};
}

function sumBy(rows, key) {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((acc, r) => acc + (r?.sum?.[key] ?? 0), 0);
}

function main() {
  return callGraphQL().then((acct) => {
    const usage = {
      workerRequests: sumBy(acct.workersInvocationsAdaptive, "requests"),
      workerErrors: sumBy(acct.workersInvocationsAdaptive, "errors"),
      doRequests: sumBy(acct.durableObjectsInvocationsAdaptiveGroups, "requests"),
      // activeTime is returned in microseconds; convert to seconds for human-friendly threshold
      doDurationSec: Math.round(sumBy(acct.durableObjectsPeriodicGroups, "activeTime") / 1_000_000),
      d1RowsRead: sumBy(acct.d1AnalyticsAdaptiveGroups, "rowsRead"),
      d1RowsWritten: sumBy(acct.d1AnalyticsAdaptiveGroups, "rowsWritten"),
    };

    const reasons = [];
    if (usage.workerRequests > thresholds.workerRequests) {
      reasons.push(`workerRequests ${usage.workerRequests} > ${thresholds.workerRequests}`);
    }
    if (usage.d1RowsRead > thresholds.d1RowsRead) {
      reasons.push(`d1RowsRead ${usage.d1RowsRead} > ${thresholds.d1RowsRead}`);
    }
    if (usage.doRequests > thresholds.doRequests) {
      reasons.push(`doRequests ${usage.doRequests} > ${thresholds.doRequests}`);
    }
    if (usage.doDurationSec > thresholds.doDurationSec) {
      reasons.push(`doDurationSec ${usage.doDurationSec} > ${thresholds.doDurationSec}`);
    }

    const tripped = reasons.length > 0;
    const result = { tripped, windowStart: startIso, windowEnd: nowIso, usage, thresholds, reasons };

    console.log(JSON.stringify(result));
    console.error(
      `[killswitch] window=${startIso}..${nowIso}\n` +
      `  workerRequests: ${usage.workerRequests} / ${thresholds.workerRequests}\n` +
      `  d1RowsRead:     ${usage.d1RowsRead} / ${thresholds.d1RowsRead}\n` +
      `  doRequests:     ${usage.doRequests} / ${thresholds.doRequests}\n` +
      `  doDurationSec:  ${usage.doDurationSec} / ${thresholds.doDurationSec}\n` +
      `  tripped: ${tripped}${tripped ? ` (${reasons.join("; ")})` : ""}`
    );

    process.exit(tripped ? 1 : 0);
  }).catch((err) => {
    console.error(`[killswitch] query failed: ${err.message}`);
    console.log(JSON.stringify({ tripped: false, error: err.message }));
    process.exit(2);
  });
}

main();
