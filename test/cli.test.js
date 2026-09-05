import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {parseArgs} from '../bin/snapshot.js';

describe('parseArgs', () => {
  it('treats a trailing flag as boolean true', () => {
    // Regression: `--full` last on the line parsed as undefined, so a full
    // refresh silently ran as an incremental one.
    assert.equal(parseArgs(['--domain', 'example.com', '--full']).full, true);
  });

  it('treats a flag followed by another flag as boolean true', () => {
    const args = parseArgs(['--full', '--out', 'file.json']);

    assert.equal(args.full, true);
    assert.equal(args.out, 'file.json');
  });

  it('reads both --flag value and --flag=value', () => {
    assert.equal(parseArgs(['--domain', 'example.com']).domain, 'example.com');
    assert.equal(parseArgs(['--domain=example.com']).domain, 'example.com');
  });

  it('ignores bare positional arguments', () => {
    assert.deepEqual(parseArgs(['snapshot', 'extra']), {});
  });
});
