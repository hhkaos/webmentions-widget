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

describe('command entry point', () => {
  it('runs when invoked through a symlink, as npm installs bins', async () => {
    // Regression: comparing import.meta.url against argv[1] made the command a
    // silent no-op under node_modules/.bin, where argv[1] is the symlink.
    const {execFileSync} = await import('node:child_process');
    const {mkdtempSync, symlinkSync} = await import('node:fs');
    const {tmpdir} = await import('node:os');
    const {join, dirname} = await import('node:path');
    const {fileURLToPath} = await import('node:url');

    const binPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'snapshot.js');
    const link = join(mkdtempSync(join(tmpdir(), 'wm-bin-')), 'webmentions-snapshot');
    symlinkSync(binPath, link);

    let output = '';

    try {
      execFileSync(process.execPath, [link, '--domain', 'example.com', '--out', 'x.json'], {
        encoding: 'utf8',
        env: {...process.env, WEBMENTION_IO_TOKEN: ''},
      });
    } catch (error) {
      output = `${error.stdout || ''}${error.stderr || ''}`;
    }

    assert.match(output, /Missing API token/, 'main() ran instead of exiting silently');
  });
});
