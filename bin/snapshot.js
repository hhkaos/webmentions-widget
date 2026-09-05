#!/usr/bin/env node

/**
 * Refresh a build-time webmentions snapshot.
 *
 * Queries webmention.io once for the whole domain instead of once per page,
 * and only for what is new since the last run (`since_id`). A site that runs
 * this daily costs webmention.io one or two requests a day, versus one request
 * per visitor per page view when the widget fetches in the browser.
 *
 * Usage:
 *   webmentions-snapshot --domain example.com --out src/data/webmentions.json
 *
 * The API token (webmention.io → Settings → API Key) is read from
 * WEBMENTION_IO_TOKEN, or --token. Domain queries require it.
 */

import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';

import {getSnapshotMentions, mergeSnapshot, parseWebmentionJson} from '../src/core.js';

const DEFAULT_API = 'https://webmention.io/api/mentions.jf2';
const PER_PAGE = 100;
const PAGE_DELAY_MS = 500;
const RETRIES = 8;
const RETRY_DELAY_MS = 3000;
const MAX_RETRY_DELAY_MS = 30000;

function parseArgs(argv) {
  const args = {};

  argv.forEach((arg, index) => {
    if (!arg.startsWith('--')) {
      return;
    }

    const [flag, inline] = arg.slice(2).split('=');
    args[flag] = inline ?? (argv[index + 1]?.startsWith('--') ? true : argv[index + 1]);
  });

  return args;
}

async function readExisting(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * webmention.io returns intermittent 502s. A daily job that gives up on the
 * first one silently skips a whole day, so retry with backoff before deciding
 * the API is really unavailable.
 */
async function fetchPage(url) {
  let lastError = null;

  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    if (attempt > 0) {
      // Capped exponential backoff with jitter. webmention.io has spent today
      // failing roughly two requests in three, so a job that gives up after
      // half a minute loses the coin flip often enough to skip whole days; a
      // daily job can afford to be patient for a couple of minutes instead.
      const backoff = Math.min(RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);

      await wait(backoff + Math.random() * 1000);
    }

    try {
      const response = await fetch(url);

      if (response.ok) {
        return parseWebmentionJson(await response.text());
      }

      lastError = new Error(`webmention.io responded with ${response.status}`);

      // A 4xx will not fix itself; only server errors are worth retrying.
      if (response.status < 500 && response.status !== 429) {
        break;
      }
    } catch (error) {
      lastError = error;
    }

    console.error(`  attempt ${attempt + 1}/${RETRIES + 1} failed: ${lastError.message}`);
  }

  throw lastError;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const domain = args.domain;
  const out = args.out;
  const token = args.token || process.env.WEBMENTION_IO_TOKEN;
  const apiUrl = args.api || DEFAULT_API;

  if (!domain || !out) {
    console.error('Usage: webmentions-snapshot --domain <domain> --out <file.json> [--token <token>]');
    process.exit(2);
  }

  if (!token) {
    console.error('Missing API token: set WEBMENTION_IO_TOKEN or pass --token.');
    process.exit(2);
  }

  const existing = await readExisting(out);
  const sinceId = args.full ? null : existing?.lastId ?? null;
  const collected = [];

  for (let page = 0; ; page += 1) {
    const params = new URLSearchParams({
      domain,
      token,
      'per-page': String(PER_PAGE),
      page: String(page),
      'sort-by': 'created',
      'sort-dir': 'up',
    });

    if (sinceId) {
      params.set('since_id', String(sinceId));
    }

    let payload;

    try {
      payload = await fetchPage(`${apiUrl}?${params}`);
    } catch (error) {
      // Leave the existing snapshot alone rather than replacing good data with
      // a partial fetch; the next scheduled run picks up where this stopped.
      console.error(`${error.message}; keeping the current snapshot.`);
      process.exit(1);
    }

    const batch = payload?.children || [];
    collected.push(...batch);

    if (batch.length < PER_PAGE) {
      break;
    }

    await wait(PAGE_DELAY_MS);
  }

  const before = getSnapshotMentions(existing).length;

  if (!collected.length && existing) {
    console.log(`No new mentions since #${sinceId}. Snapshot unchanged (${before}).`);
    return;
  }

  const snapshot = mergeSnapshot(existing, collected);

  if (snapshot.count === before) {
    console.log(`Snapshot unchanged (${before} mentions).`);
    return;
  }

  await mkdir(dirname(out), {recursive: true});
  await writeFile(out, `${JSON.stringify(snapshot, null, 2)}\n`);

  console.log(`Snapshot updated: ${before} → ${snapshot.count} mentions (lastId ${snapshot.lastId}).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
