/**
 * Tests for grading.mjs
 */

import { describe, it, expect } from 'vitest';
import { getGradeInfo, formatCost, formatDuration, formatTokens } from '../lib/grading.mjs';

describe('getGradeInfo', () => {
  it('returns A for scores >= 85', () => {
    expect(getGradeInfo(85).grade).toBe('A');
    expect(getGradeInfo(100).grade).toBe('A');
  });

  it('returns B for scores 70-84', () => {
    expect(getGradeInfo(70).grade).toBe('B');
    expect(getGradeInfo(84).grade).toBe('B');
  });

  it('returns C for scores 55-69', () => {
    expect(getGradeInfo(55).grade).toBe('C');
    expect(getGradeInfo(69).grade).toBe('C');
  });

  it('returns D for scores 40-54', () => {
    expect(getGradeInfo(40).grade).toBe('D');
  });

  it('returns F for scores < 40', () => {
    expect(getGradeInfo(39).grade).toBe('F');
    expect(getGradeInfo(0).grade).toBe('F');
  });

  it('includes color and label', () => {
    const info = getGradeInfo(90);
    expect(info.color).toBeDefined();
    expect(info.label).toBe('Excellent');
  });
});

describe('formatCost', () => {
  it('formats tiny costs', () => {
    expect(formatCost(0.001)).toBe('<$0.01');
  });

  it('formats sub-dollar costs with 3 decimals', () => {
    expect(formatCost(0.123)).toBe('$0.123');
  });

  it('formats dollar+ costs with 2 decimals', () => {
    expect(formatCost(5.678)).toBe('$5.68');
  });
});

describe('formatDuration', () => {
  it('formats seconds', () => {
    expect(formatDuration(30000)).toBe('30s');
  });

  it('formats minutes', () => {
    expect(formatDuration(300000)).toBe('5m');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(5400000)).toBe('1h 30m');
  });
});

describe('formatTokens', () => {
  it('formats millions', () => {
    expect(formatTokens(1500000)).toBe('1.5M');
  });

  it('formats thousands', () => {
    expect(formatTokens(25000)).toBe('25.0K');
  });

  it('formats small numbers as-is', () => {
    expect(formatTokens(500)).toBe('500');
  });
});
