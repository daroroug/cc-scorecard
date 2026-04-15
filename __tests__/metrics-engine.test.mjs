/**
 * Tests for metrics-engine.mjs — the 6-dimension scoring system
 */

import { describe, it, expect } from 'vitest';
import { computeMetrics } from '../lib/metrics-engine.mjs';

function makeParsedTranscript(overrides = {}) {
  return {
    sessionId: 'test-session',
    projectDir: '/test',
    turns: overrides.turns || [],
    allToolCalls: overrides.allToolCalls || [],
    totals: overrides.totals || { inputTokens: 0, outputTokens: 0, cacheCreation: 0, cacheRead: 0, cost: 0 },
    durationMs: overrides.durationMs || 0,
    lineCount: overrides.lineCount || 0,
  };
}

function makeToolCall(name, opts = {}) {
  return {
    name,
    id: 'toolu_' + Math.random().toString(36).slice(2),
    filePath: opts.filePath || null,
    command: opts.command || null,
    timestamp: opts.timestamp || Date.now(),
    failed: opts.failed || false,
    errorSnippet: opts.errorSnippet || null,
  };
}

function makeTurn(toolCalls = [], opts = {}) {
  return {
    index: opts.index || 0,
    timestamp: opts.timestamp || Date.now(),
    usage: opts.usage || { inputTokens: 1000, outputTokens: 200, cacheCreation: 0, cacheRead: 500 },
    toolCalls,
    cost: opts.cost || 0.05,
  };
}

describe('computeMetrics', () => {
  it('returns all 6 dimensions plus overall grade', () => {
    const transcript = makeParsedTranscript({
      turns: [makeTurn()],
      totals: { inputTokens: 1000, outputTokens: 200, cacheCreation: 100, cacheRead: 500, cost: 0.05 },
    });

    const metrics = computeMetrics(transcript);
    expect(metrics).toHaveProperty('costEfficiency');
    expect(metrics).toHaveProperty('cacheHealth');
    expect(metrics).toHaveProperty('toolDiscipline');
    expect(metrics).toHaveProperty('stuckThrash');
    expect(metrics).toHaveProperty('qualitySignals');
    expect(metrics).toHaveProperty('sessionPacing');
    expect(metrics).toHaveProperty('overall');
    expect(metrics.overall).toHaveProperty('score');
    expect(metrics.overall).toHaveProperty('grade');
  });

  it('grades A for a well-run session', () => {
    const reads = Array.from({ length: 10 }, (_, i) =>
      makeToolCall('Read', { filePath: `/src/file${i}.js`, timestamp: Date.now() + i * 60000 })
    );
    const edits = Array.from({ length: 3 }, (_, i) =>
      makeToolCall('Edit', { filePath: `/src/file${i}.js`, timestamp: Date.now() + (10 + i) * 60000 })
    );
    const allToolCalls = [...reads, ...edits];
    const turns = [makeTurn(allToolCalls, {
      usage: { inputTokens: 5000, outputTokens: 1000, cacheCreation: 500, cacheRead: 4000 },
      cost: 0.30,
    })];

    const transcript = makeParsedTranscript({
      turns,
      allToolCalls,
      totals: { inputTokens: 5000, outputTokens: 1000, cacheCreation: 500, cacheRead: 4000, cost: 0.30 },
      durationMs: 20 * 60 * 1000,
    });

    const metrics = computeMetrics(transcript);
    expect(metrics.overall.grade).toMatch(/^[AB]$/);
  });

  it('scores costEfficiency based on total session cost', () => {
    const transcript = makeParsedTranscript({
      turns: [makeTurn()],
      totals: { inputTokens: 100, outputTokens: 50, cacheCreation: 0, cacheRead: 0, cost: 0.10 },
    });

    const metrics = computeMetrics(transcript);
    expect(metrics.costEfficiency.score).toBeGreaterThanOrEqual(0);
    expect(metrics.costEfficiency.score).toBeLessThanOrEqual(100);
  });

  it('scores cacheHealth from hit ratio', () => {
    const transcript = makeParsedTranscript({
      turns: [makeTurn()],
      totals: { inputTokens: 100, outputTokens: 50, cacheCreation: 200, cacheRead: 800, cost: 0.05 },
    });

    const metrics = computeMetrics(transcript);
    expect(metrics.cacheHealth.score).toBeGreaterThan(50);
    expect(metrics.cacheHealth.details.hitRatio).toBeCloseTo(0.8, 1);
  });

  it('scores toolDiscipline from Read:Edit ratio', () => {
    const reads = Array.from({ length: 6 }, () => makeToolCall('Read', { filePath: '/a.js' }));
    const edits = [makeToolCall('Edit', { filePath: '/a.js' })];
    const allToolCalls = [...reads, ...edits];

    const transcript = makeParsedTranscript({
      turns: [makeTurn(allToolCalls)],
      allToolCalls,
      totals: { inputTokens: 100, outputTokens: 50, cacheCreation: 0, cacheRead: 0, cost: 0.05 },
    });

    const metrics = computeMetrics(transcript);
    expect(metrics.toolDiscipline.details.readEditRatio).toBeCloseTo(6, 0);
    expect(metrics.toolDiscipline.score).toBeGreaterThan(70);
  });

  it('detects stuck/thrash patterns from consecutive failures', () => {
    const failedCalls = Array.from({ length: 6 }, () =>
      makeToolCall('Bash', { command: 'npm test', failed: true, errorSnippet: 'FAIL: test.js' })
    );

    const transcript = makeParsedTranscript({
      turns: [makeTurn(failedCalls)],
      allToolCalls: failedCalls,
      totals: { inputTokens: 100, outputTokens: 50, cacheCreation: 0, cacheRead: 0, cost: 0.05 },
    });

    const metrics = computeMetrics(transcript);
    expect(metrics.stuckThrash.score).toBeLessThan(70);
    expect(metrics.stuckThrash.details.stuckPeriods).toBeGreaterThan(0);
  });

  it('detects hallucination signals (failed Read then Edit same path)', () => {
    const failedRead = makeToolCall('Read', { filePath: '/missing.js', failed: true, errorSnippet: 'not found' });
    const blindEdit = makeToolCall('Edit', { filePath: '/missing.js' });

    const transcript = makeParsedTranscript({
      turns: [makeTurn([failedRead, blindEdit])],
      allToolCalls: [failedRead, blindEdit],
      totals: { inputTokens: 100, outputTokens: 50, cacheCreation: 0, cacheRead: 0, cost: 0.05 },
    });

    const metrics = computeMetrics(transcript);
    expect(metrics.qualitySignals.details.hallucinationIncidents).toBeGreaterThanOrEqual(1);
  });

  it('scores session pacing from idle gaps and bursts', () => {
    const base = Date.now();
    const turns = [
      makeTurn([], { timestamp: base, index: 0 }),
      makeTurn([], { timestamp: base + 60000, index: 1 }),      // 1 min gap - normal
      makeTurn([], { timestamp: base + 600000, index: 2 }),      // 10 min gap - idle
      makeTurn([], { timestamp: base + 660000, index: 3 }),      // 1 min gap - normal
    ];

    const transcript = makeParsedTranscript({
      turns,
      durationMs: 660000,
    });

    const metrics = computeMetrics(transcript);
    expect(metrics.sessionPacing.details.idleGaps).toBeGreaterThanOrEqual(1);
  });

  it('handles empty transcript gracefully', () => {
    const transcript = makeParsedTranscript();
    const metrics = computeMetrics(transcript);
    expect(metrics.overall.grade).toBeDefined();
    expect(metrics.overall.score).toBeGreaterThanOrEqual(0);
  });
});
