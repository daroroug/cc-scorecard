/**
 * Tests for transcript-parser.mjs
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deriveProjectHash, parseTranscript } from '../lib/transcript-parser.mjs';

const TEST_DIR = join(tmpdir(), 'cc-scorecard-test-' + Date.now());
const TRANSCRIPT_PATH = join(TEST_DIR, 'test-session.jsonl');

function makeAssistantEntry(usage, toolUseBlocks = [], timestamp = '2026-04-15T10:00:00Z') {
  const content = [
    { type: 'text', text: 'Some response' },
    ...toolUseBlocks,
  ];
  return JSON.stringify({
    type: 'assistant',
    timestamp,
    message: { usage, content },
    uuid: 'test-' + Math.random().toString(36).slice(2),
  });
}

function makeToolResult(toolUseId, isError = false, content = 'ok') {
  return JSON.stringify({
    type: 'user',
    timestamp: '2026-04-15T10:00:01Z',
    toolUseResult: { toolUseId, is_error: isError, content },
    uuid: 'result-' + Math.random().toString(36).slice(2),
  });
}

function makeToolUse(name, input = {}, id = 'toolu_' + Math.random().toString(36).slice(2)) {
  return { type: 'tool_use', name, input, id };
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('deriveProjectHash', () => {
  it('replaces slashes with hyphens', () => {
    expect(deriveProjectHash('/Users/dan/CodeRepos/rarix')).toBe('-Users-dan-CodeRepos-rarix');
  });

  it('handles root path', () => {
    expect(deriveProjectHash('/')).toBe('-');
  });
});

describe('parseTranscript', () => {
  it('parses basic assistant turns with usage data', () => {
    const lines = [
      makeAssistantEntry({
        input_tokens: 1000,
        output_tokens: 200,
        cache_creation_input_tokens: 500,
        cache_read_input_tokens: 300,
      }),
      makeAssistantEntry({
        input_tokens: 800,
        output_tokens: 150,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 700,
      }),
    ];
    writeFileSync(TRANSCRIPT_PATH, lines.join('\n'));

    const result = parseTranscript(TRANSCRIPT_PATH);
    expect(result.turns).toHaveLength(2);
    expect(result.totals.inputTokens).toBe(1800);
    expect(result.totals.outputTokens).toBe(350);
    expect(result.totals.cacheCreation).toBe(500);
    expect(result.totals.cacheRead).toBe(1000);
    expect(result.totals.cost).toBeGreaterThan(0);
  });

  it('extracts tool calls from assistant content', () => {
    const readTool = makeToolUse('Read', { file_path: '/src/index.js' }, 'toolu_read1');
    const editTool = makeToolUse('Edit', { file_path: '/src/index.js', old_string: 'a', new_string: 'b' }, 'toolu_edit1');

    const lines = [
      makeAssistantEntry({ input_tokens: 100, output_tokens: 50 }, [readTool]),
      makeToolResult('toolu_read1'),
      makeAssistantEntry({ input_tokens: 100, output_tokens: 50 }, [editTool]),
      makeToolResult('toolu_edit1'),
    ];
    writeFileSync(TRANSCRIPT_PATH, lines.join('\n'));

    const result = parseTranscript(TRANSCRIPT_PATH);
    expect(result.allToolCalls).toHaveLength(2);
    expect(result.allToolCalls[0].name).toBe('Read');
    expect(result.allToolCalls[0].filePath).toBe('/src/index.js');
    expect(result.allToolCalls[1].name).toBe('Edit');
  });

  it('detects failed tool calls', () => {
    const readTool = makeToolUse('Read', { file_path: '/missing.js' }, 'toolu_fail1');

    const lines = [
      makeAssistantEntry({ input_tokens: 100, output_tokens: 50 }, [readTool]),
      makeToolResult('toolu_fail1', true, 'File not found: /missing.js'),
    ];
    writeFileSync(TRANSCRIPT_PATH, lines.join('\n'));

    const result = parseTranscript(TRANSCRIPT_PATH);
    expect(result.allToolCalls[0].failed).toBe(true);
    expect(result.allToolCalls[0].errorSnippet).toContain('File not found');
  });

  it('extracts Bash commands', () => {
    const bashTool = makeToolUse('Bash', { command: 'npm test', description: 'run tests' }, 'toolu_bash1');

    const lines = [
      makeAssistantEntry({ input_tokens: 100, output_tokens: 50 }, [bashTool]),
      makeToolResult('toolu_bash1'),
    ];
    writeFileSync(TRANSCRIPT_PATH, lines.join('\n'));

    const result = parseTranscript(TRANSCRIPT_PATH);
    expect(result.allToolCalls[0].command).toBe('npm test');
  });

  it('computes session duration from timestamps', () => {
    const lines = [
      makeAssistantEntry({ input_tokens: 100, output_tokens: 50 }, [], '2026-04-15T10:00:00Z'),
      makeAssistantEntry({ input_tokens: 100, output_tokens: 50 }, [], '2026-04-15T10:30:00Z'),
    ];
    writeFileSync(TRANSCRIPT_PATH, lines.join('\n'));

    const result = parseTranscript(TRANSCRIPT_PATH);
    expect(result.durationMs).toBe(30 * 60 * 1000); // 30 minutes
  });

  it('handles empty transcript', () => {
    writeFileSync(TRANSCRIPT_PATH, '');
    const result = parseTranscript(TRANSCRIPT_PATH);
    expect(result.turns).toHaveLength(0);
    expect(result.allToolCalls).toHaveLength(0);
    expect(result.totals.cost).toBe(0);
  });

  it('handles malformed JSON lines gracefully', () => {
    const lines = [
      'not valid json',
      makeAssistantEntry({ input_tokens: 100, output_tokens: 50 }),
      '{ broken',
    ];
    writeFileSync(TRANSCRIPT_PATH, lines.join('\n'));

    const result = parseTranscript(TRANSCRIPT_PATH);
    expect(result.turns).toHaveLength(1);
  });

  it('calculates per-turn costs', () => {
    const lines = [
      makeAssistantEntry({
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      }),
    ];
    writeFileSync(TRANSCRIPT_PATH, lines.join('\n'));

    const result = parseTranscript(TRANSCRIPT_PATH);
    expect(result.turns[0].cost).toBeGreaterThan(0);
    expect(result.totals.cost).toBe(result.turns[0].cost);
  });

  it('handles multiple tool calls in a single turn', () => {
    const tools = [
      makeToolUse('Read', { file_path: '/a.js' }),
      makeToolUse('Read', { file_path: '/b.js' }),
      makeToolUse('Edit', { file_path: '/a.js' }),
    ];

    const lines = [
      makeAssistantEntry({ input_tokens: 100, output_tokens: 50 }, tools),
    ];
    writeFileSync(TRANSCRIPT_PATH, lines.join('\n'));

    const result = parseTranscript(TRANSCRIPT_PATH);
    expect(result.turns[0].toolCalls).toHaveLength(3);
    expect(result.allToolCalls).toHaveLength(3);
  });
});
