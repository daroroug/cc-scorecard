/**
 * Integration test for CLI entry point
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI_PATH = join(import.meta.dirname, '..', 'index.mjs');
const TEST_DIR = join(tmpdir(), 'cc-scorecard-cli-test-' + Date.now());

function makeTranscript() {
  const lines = [];
  const base = '2026-04-15T10:00:00Z';
  for (let i = 0; i < 5; i++) {
    const ts = new Date(new Date(base).getTime() + i * 120000).toISOString();
    lines.push(JSON.stringify({
      type: 'assistant',
      timestamp: ts,
      message: {
        usage: { input_tokens: 2000, output_tokens: 400, cache_creation_input_tokens: 500, cache_read_input_tokens: 1200 },
        content: [
          { type: 'text', text: 'response' },
          { type: 'tool_use', name: i % 3 === 0 ? 'Read' : i % 3 === 1 ? 'Edit' : 'Bash',
            id: `toolu_${i}`,
            input: i % 3 === 0 ? { file_path: '/src/app.js' } : i % 3 === 1 ? { file_path: '/src/app.js' } : { command: 'npm test' } },
        ],
      },
      uuid: `turn-${i}`,
    }));
    lines.push(JSON.stringify({
      type: 'user',
      timestamp: ts,
      toolUseResult: { toolUseId: `toolu_${i}`, is_error: false, content: 'ok' },
      uuid: `result-${i}`,
    }));
  }
  return lines.join('\n');
}

describe('CLI', () => {
  it('produces JSON output for a transcript file', () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const transcriptPath = join(TEST_DIR, 'test.jsonl');
    writeFileSync(transcriptPath, makeTranscript());

    const output = execFileSync('node', [CLI_PATH, '--file', transcriptPath, '--json'], {
      encoding: 'utf8',
      timeout: 10000,
    });

    const result = JSON.parse(output);
    expect(result).toHaveProperty('overall');
    expect(result.overall).toHaveProperty('grade');
    expect(result.overall).toHaveProperty('score');
    expect(result).toHaveProperty('costEfficiency');
    expect(result).toHaveProperty('cacheHealth');

    rmSync(TEST_DIR, { recursive: true });
  });
});
