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

import {getSnapshotMentions, mergeSnapshot} from '../src/core.js';

const DEFAULT_API = 'https://webmention.io/api/mentions.jf2';
const PER_PAGE = 100;
const PAGE_DELAY_MS = 500;

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

    const response = await fetch(`${apiUrl}?${params}`);

    if (!response.ok) {
      // Leave the existing snapshot alone rather than replacing good data with
      // a partial fetch; the next scheduled run picks up where this stopped.
      console.error(`webmention.io responded with ${response.status}; keeping the current snapshot.`);
      process.exit(1);
    }

    const batch = (await response.json())?.children || [];
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
