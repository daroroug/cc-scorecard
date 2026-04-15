/**
 * Tests for html-renderer.mjs
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { renderScorecard } from '../lib/html-renderer.mjs';

function makeMetrics() {
  return {
    costEfficiency: { score: 82, details: { totalCost: 1.23, costPerTurn: 0.041, costPerToolCall: 0.062, turns: 30, toolCalls: 20 } },
    cacheHealth: { score: 75, details: { hitRatio: 0.72, cacheRead: 50000, cacheCreation: 20000, idleGaps: 2, cacheWasteTokens: 20000 } },
    toolDiscipline: { score: 88, details: { readEditRatio: 3.5, reads: 21, edits: 6, writes: 0, greps: 3, blindEdits: 1 } },
    stuckThrash: { score: 90, details: { stuckPeriods: 0, maxConsecutiveFailures: 1, retryLoops: 1, totalFailures: 2 } },
    qualitySignals: { score: 95, details: { hallucinationIncidents: 0, blindMutations: 1, failedLookupRate: 0.05, failedLookups: 1, totalLookups: 20 } },
    sessionPacing: { score: 85, details: { idleGaps: 1, burstPeriods: 0, avgGapMs: 45000, turnCount: 30 } },
    overall: { score: 85, grade: 'A' },
  };
}

function makeTranscript() {
  return {
    sessionId: 'abc12345-test-session',
    projectDir: '/Users/test/project',
    turns: Array.from({ length: 30 }, (_, i) => ({
      index: i,
      timestamp: Date.now() + i * 60000,
      usage: { inputTokens: 2000, outputTokens: 400, cacheCreation: 500, cacheRead: 1200 },
      toolCalls: [],
      cost: 0.04,
    })),
    allToolCalls: [],
    totals: { inputTokens: 60000, outputTokens: 12000, cacheCreation: 15000, cacheRead: 36000, cost: 1.23 },
    durationMs: 30 * 60 * 1000,
    lineCount: 200,
  };
}

let outputPath = null;

afterEach(() => {
  if (outputPath && existsSync(outputPath)) rmSync(outputPath);
});

describe('renderScorecard', () => {
  it('generates a valid HTML file', () => {
    outputPath = renderScorecard(makeMetrics(), makeTranscript());
    expect(existsSync(outputPath)).toBe(true);

    const html = readFileSync(outputPath, 'utf8');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Session Scorecard');
  });

  it('includes the overall grade', () => {
    outputPath = renderScorecard(makeMetrics(), makeTranscript());
    const html = readFileSync(outputPath, 'utf8');
    expect(html).toContain('>A<');
  });

  it('includes all 6 dimension scores', () => {
    outputPath = renderScorecard(makeMetrics(), makeTranscript());
    const html = readFileSync(outputPath, 'utf8');
    expect(html).toContain('Cost Efficiency');
    expect(html).toContain('Cache Health');
    expect(html).toContain('Tool Discipline');
    expect(html).toContain('Stuck');
    expect(html).toContain('Quality');
    expect(html).toContain('Pacing');
  });

  it('includes session metadata', () => {
    outputPath = renderScorecard(makeMetrics(), makeTranscript());
    const html = readFileSync(outputPath, 'utf8');
    expect(html).toContain('abc12345');
    expect(html).toContain('$1.23');
  });

  it('is self-contained (no external dependencies)', () => {
    outputPath = renderScorecard(makeMetrics(), makeTranscript());
    const html = readFileSync(outputPath, 'utf8');
    expect(html).not.toContain('href="http');
    expect(html).not.toContain('src="http');
    // Inline styles only
    expect(html).toContain('<style>');
  });

  it('produces a file under 200KB', () => {
    outputPath = renderScorecard(makeMetrics(), makeTranscript());
    const size = readFileSync(outputPath).length;
    expect(size).toBeLessThan(200 * 1024);
  });
});
