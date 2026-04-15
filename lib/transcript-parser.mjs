/**
 * Transcript Parser — Parse Claude Code JSONL transcripts into structured timelines.
 *
 * Reads ~/.claude/projects/<hash>/<session>.jsonl and extracts:
 * - Token usage per turn (input, output, cache)
 * - Tool call sequences with timing
 * - File paths touched by tools
 * - Error/failure events
 *
 * Zero dependencies — uses only Node.js built-ins.
 *
 * @module cc-scorecard/lib/transcript-parser
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Derive the Claude Code project hash from an absolute project path.
 * Claude Code uses the path with / replaced by - as the directory name.
 * @param {string} projectDir
 * @returns {string}
 */
export function deriveProjectHash(projectDir) {
  return projectDir.replace(/\//g, '-');
}

/**
 * Find all JSONL transcript files for a project, sorted newest first.
 * @param {string} projectDir
 * @returns {{ path: string, sessionId: string, mtime: number }[]}
 */
export function findTranscripts(projectDir) {
  const hash = deriveProjectHash(projectDir);
  const dir = join(homedir(), '.claude', 'projects', hash);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => ({
      path: join(dir, f),
      sessionId: f.replace('.jsonl', ''),
      mtime: statSync(join(dir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
}

/**
 * Find the most recent transcript for a project.
 * @param {string} projectDir
 * @returns {string|null}
 */
export function findLatestTranscript(projectDir) {
  const transcripts = findTranscripts(projectDir);
  return transcripts.length > 0 ? transcripts[0].path : null;
}

// Pricing: Claude Opus 4.6 rates
const INPUT_RATE = 15.0 / 1_000_000;
const OUTPUT_RATE = 75.0 / 1_000_000;
const CACHE_READ_RATE = 1.5 / 1_000_000;
const CACHE_WRITE_RATE = 18.75 / 1_000_000;

function calculateTurnCost(usage) {
  return (usage.inputTokens || 0) * INPUT_RATE
    + (usage.outputTokens || 0) * OUTPUT_RATE
    + (usage.cacheRead || 0) * CACHE_READ_RATE
    + (usage.cacheCreation || 0) * CACHE_WRITE_RATE;
}

function extractFilePath(toolName, input) {
  if (!input || typeof input !== 'object') return null;
  if (input.file_path) return input.file_path;
  if (input.path) return input.path;
  if (input.pattern && toolName === 'Glob') return input.pattern;
  return null;
}

function extractCommand(input) {
  if (!input || typeof input !== 'object') return null;
  return input.command || null;
}

/**
 * Parse a JSONL transcript into a structured timeline.
 * @param {string} transcriptPath
 * @param {Object} [opts]
 * @param {string} [opts.projectDir] - Override project dir for metadata
 * @returns {Object} ParsedTranscript
 */
export function parseTranscript(transcriptPath, opts = {}) {
  const content = readFileSync(transcriptPath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());
  const sessionId = transcriptPath.split('/').pop().replace('.jsonl', '');

  const turns = [];
  const allToolCalls = [];
  let firstTimestamp = null;
  let lastTimestamp = null;

  // First pass: collect tool results to match with tool_use blocks
  const toolResults = new Map();
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    if (entry?.type === 'user' && entry?.toolUseResult) {
      const result = entry.toolUseResult;
      if (result.toolUseId) {
        toolResults.set(result.toolUseId, {
          error: result.is_error || false,
          content: typeof result.content === 'string'
            ? result.content.slice(0, 200)
            : JSON.stringify(result.content || '').slice(0, 200),
        });
      }
    }
  }

  // Second pass: extract turns and tool calls
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    const ts = entry?.timestamp ? new Date(entry.timestamp).getTime() : null;
    if (ts) {
      if (!firstTimestamp) firstTimestamp = ts;
      lastTimestamp = ts;
    }

    if (entry?.type !== 'assistant') continue;

    const usage = entry?.message?.usage;
    const contentBlocks = entry?.message?.content;

    const turn = {
      index: turns.length,
      timestamp: ts || Date.now(),
      usage: {
        inputTokens: usage?.input_tokens || 0,
        outputTokens: usage?.output_tokens || 0,
        cacheCreation: usage?.cache_creation_input_tokens || 0,
        cacheRead: usage?.cache_read_input_tokens || 0,
      },
      toolCalls: [],
      cost: 0,
    };

    turn.cost = calculateTurnCost(turn.usage);

    if (Array.isArray(contentBlocks)) {
      for (const block of contentBlocks) {
        if (block?.type !== 'tool_use') continue;

        const toolResult = toolResults.get(block.id);
        const toolCall = {
          name: block.name || 'unknown',
          id: block.id,
          filePath: extractFilePath(block.name, block.input),
          command: block.name === 'Bash' ? extractCommand(block.input) : null,
          timestamp: ts || Date.now(),
          failed: toolResult?.error || false,
          errorSnippet: toolResult?.error ? toolResult.content : null,
        };

        turn.toolCalls.push(toolCall);
        allToolCalls.push(toolCall);
      }
    }

    turns.push(turn);
  }

  const totals = turns.reduce((acc, t) => ({
    inputTokens: acc.inputTokens + t.usage.inputTokens,
    outputTokens: acc.outputTokens + t.usage.outputTokens,
    cacheCreation: acc.cacheCreation + t.usage.cacheCreation,
    cacheRead: acc.cacheRead + t.usage.cacheRead,
    cost: acc.cost + t.cost,
  }), { inputTokens: 0, outputTokens: 0, cacheCreation: 0, cacheRead: 0, cost: 0 });

  return {
    sessionId,
    projectDir: opts.projectDir || '',
    turns,
    allToolCalls,
    totals,
    durationMs: (lastTimestamp && firstTimestamp) ? lastTimestamp - firstTimestamp : 0,
    lineCount: lines.length,
  };
}
