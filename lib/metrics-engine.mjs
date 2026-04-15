/**
 * Metrics Engine — Compute 6-dimension session quality scores.
 *
 * Dimensions:
 * 1. Cost Efficiency (20%) — $/turn, total spend
 * 2. Cache Health (20%) — cache hit ratio, idle gaps
 * 3. Tool Discipline (20%) — Read:Edit ratio, blind writes
 * 4. Stuck/Thrash (15%) — consecutive failures, retry loops
 * 5. Quality Signals (15%) — hallucination incidents
 * 6. Session Pacing (10%) — idle gaps, burst periods
 *
 * @module cc-scorecard/lib/metrics-engine
 */

const WEIGHTS = {
  costEfficiency: 0.20,
  cacheHealth: 0.20,
  toolDiscipline: 0.20,
  stuckThrash: 0.15,
  qualitySignals: 0.15,
  sessionPacing: 0.10,
};

function clamp(val, min = 0, max = 100) {
  return Math.max(min, Math.min(max, val));
}

function letterGrade(score) {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

// --- Dimension 1: Cost Efficiency ---
function scoreCostEfficiency(transcript) {
  const cost = transcript.totals.cost;
  const turns = transcript.turns.length || 1;
  const costPerTurn = cost / turns;
  const toolCalls = transcript.allToolCalls.length || 1;
  const costPerToolCall = cost / toolCalls;

  // Score based on cost-per-turn (normalizes for session length).
  // Opus 4.6 pricing: typical turn costs $0.15-0.80. Good sessions < $0.30/turn.
  let score;
  if (costPerTurn <= 0.10) score = 100;
  else if (costPerTurn <= 0.30) score = 85 + (0.30 - costPerTurn) / 0.20 * 15;
  else if (costPerTurn <= 0.60) score = 70 + (0.60 - costPerTurn) / 0.30 * 15;
  else if (costPerTurn <= 1.00) score = 55 + (1.00 - costPerTurn) / 0.40 * 15;
  else if (costPerTurn <= 2.00) score = 40 + (2.00 - costPerTurn) / 1.00 * 15;
  else score = Math.max(0, 40 - (costPerTurn - 2.0) * 10);

  return {
    score: clamp(Math.round(score)),
    details: {
      totalCost: Math.round(cost * 1000) / 1000,
      costPerTurn: Math.round(costPerTurn * 10000) / 10000,
      costPerToolCall: Math.round(costPerToolCall * 10000) / 10000,
      turns,
      toolCalls: transcript.allToolCalls.length,
    },
  };
}

// --- Dimension 2: Cache Health ---
function scoreCacheHealth(transcript) {
  const { cacheCreation, cacheRead } = transcript.totals;
  const totalCacheTokens = cacheCreation + cacheRead;
  const hitRatio = totalCacheTokens > 0 ? cacheRead / totalCacheTokens : 0;

  // Detect idle gaps (>5 min between turns) that would bust cache TTL
  let idleGaps = 0;
  const CACHE_TTL_MS = 5 * 60 * 1000;
  for (let i = 1; i < transcript.turns.length; i++) {
    const gap = transcript.turns[i].timestamp - transcript.turns[i - 1].timestamp;
    if (gap > CACHE_TTL_MS) idleGaps++;
  }

  // Score: 80%+ hit ratio = A, scales down
  let score;
  if (hitRatio >= 0.80) score = 85 + (hitRatio - 0.80) * 75;
  else if (hitRatio >= 0.60) score = 70 + ((hitRatio - 0.60) / 0.20) * 15;
  else if (hitRatio >= 0.40) score = 55 + ((hitRatio - 0.40) / 0.20) * 15;
  else if (hitRatio >= 0.20) score = 40 + ((hitRatio - 0.20) / 0.20) * 15;
  else score = hitRatio * 200;

  // Penalize idle gaps
  score -= idleGaps * 5;

  // No cache data at all = neutral (not penalized)
  if (totalCacheTokens === 0 && transcript.turns.length <= 1) score = 75;

  return {
    score: clamp(Math.round(score)),
    details: {
      hitRatio: Math.round(hitRatio * 1000) / 1000,
      cacheRead,
      cacheCreation,
      idleGaps,
      cacheWasteTokens: cacheCreation, // tokens that had to be re-created
    },
  };
}

// --- Dimension 3: Tool Discipline ---
function scoreToolDiscipline(transcript) {
  const tools = transcript.allToolCalls;
  if (tools.length === 0) return { score: 75, details: { readEditRatio: 0, blindEdits: 0, grepBeforeEdit: 0 } };

  const reads = tools.filter(t => t.name === 'Read').length;
  const edits = tools.filter(t => t.name === 'Edit').length;
  const writes = tools.filter(t => t.name === 'Write').length;
  const greps = tools.filter(t => t.name === 'Grep' || t.name === 'Glob').length;
  const mutations = edits + writes;

  const readEditRatio = mutations > 0 ? (reads + greps) / mutations : reads + greps > 0 ? 10 : 0;

  // Detect blind edits: Edit/Write to a file that wasn't Read first in this session
  const readPaths = new Set();
  let blindEdits = 0;
  for (const tool of tools) {
    if ((tool.name === 'Read' || tool.name === 'Grep') && tool.filePath) {
      readPaths.add(tool.filePath);
    }
    if ((tool.name === 'Edit' || tool.name === 'Write') && tool.filePath) {
      if (!readPaths.has(tool.filePath)) blindEdits++;
    }
  }

  // Score: R:E > 3:1 = A, > 2:1 = B, > 1.5:1 = C, > 1:1 = D, < 1:1 = F
  let score;
  if (readEditRatio >= 3.0) score = 90;
  else if (readEditRatio >= 2.0) score = 75 + ((readEditRatio - 2.0) / 1.0) * 15;
  else if (readEditRatio >= 1.5) score = 60 + ((readEditRatio - 1.5) / 0.5) * 15;
  else if (readEditRatio >= 1.0) score = 45 + ((readEditRatio - 1.0) / 0.5) * 15;
  else score = readEditRatio * 45;

  // Penalize blind edits
  score -= blindEdits * 5;

  return {
    score: clamp(Math.round(score)),
    details: {
      readEditRatio: Math.round(readEditRatio * 100) / 100,
      reads,
      edits,
      writes,
      greps,
      blindEdits,
    },
  };
}

// --- Dimension 4: Stuck/Thrash ---
function scoreStuckThrash(transcript) {
  const tools = transcript.allToolCalls;
  if (tools.length === 0) return { score: 100, details: { stuckPeriods: 0, maxConsecutiveFailures: 0, retryLoops: 0 } };

  // Detect consecutive failure runs
  let maxConsecutive = 0;
  let currentRun = 0;
  let stuckPeriods = 0;

  for (const tool of tools) {
    if (tool.failed) {
      currentRun++;
      if (currentRun >= 3 && currentRun === 3) stuckPeriods++;
    } else {
      if (currentRun > maxConsecutive) maxConsecutive = currentRun;
      currentRun = 0;
    }
  }
  if (currentRun > maxConsecutive) maxConsecutive = currentRun;

  // Detect retry loops: same tool + same target repeated 3+ times in non-overlapping windows
  let retryLoops = 0;
  const seen = new Set();
  for (let i = 0; i <= tools.length - 3; i++) {
    const fp = `${tools[i].name}:${tools[i].filePath || ''}`;
    // Only count if same fingerprint appears 3 consecutive times AND involves failures
    if (tools[i].filePath &&
        tools[i + 1]?.name === tools[i].name && tools[i + 1]?.filePath === tools[i].filePath &&
        tools[i + 2]?.name === tools[i].name && tools[i + 2]?.filePath === tools[i].filePath) {
      const key = `${i}:${fp}`;
      if (!seen.has(fp)) {
        retryLoops++;
        seen.add(fp);
      }
    }
  }

  // Score: 0 stuck periods = 100, each stuck period or retry loop degrades
  const penalty = stuckPeriods * 25 + retryLoops * 15 + Math.max(0, maxConsecutive - 3) * 5;
  const score = 100 - penalty;

  return {
    score: clamp(Math.round(score)),
    details: {
      stuckPeriods,
      maxConsecutiveFailures: maxConsecutive,
      retryLoops,
      totalFailures: tools.filter(t => t.failed).length,
    },
  };
}

// --- Dimension 5: Quality Signals ---
function scoreQualitySignals(transcript) {
  const tools = transcript.allToolCalls;
  if (tools.length === 0) return { score: 100, details: { hallucinationIncidents: 0, blindMutations: 0, failedLookupRate: 0 } };

  // Detect hallucination: failed Read/Grep then Edit/Write to same path
  let hallucinationIncidents = 0;
  const failedLookupPaths = new Set();
  for (const tool of tools) {
    if ((tool.name === 'Read' || tool.name === 'Grep' || tool.name === 'Glob') && tool.failed && tool.filePath) {
      failedLookupPaths.add(tool.filePath);
    }
    if ((tool.name === 'Edit' || tool.name === 'Write') && tool.filePath && failedLookupPaths.has(tool.filePath)) {
      hallucinationIncidents++;
    }
  }

  // Failed lookup rate
  const lookups = tools.filter(t => ['Read', 'Grep', 'Glob'].includes(t.name));
  const failedLookups = lookups.filter(t => t.failed).length;
  const failedLookupRate = lookups.length > 0 ? failedLookups / lookups.length : 0;

  // Blind edits: Edit (not Write) without prior Read of that file.
  // Write to new files is legitimate (creating files doesn't require reading first).
  const readFiles = new Set(tools.filter(t => t.name === 'Read' && t.filePath).map(t => t.filePath));
  const blindMutations = tools.filter(t =>
    t.name === 'Edit' && t.filePath && !readFiles.has(t.filePath)
  ).length;

  // Score: 0 hallucinations = 100, each degrades proportionally
  const penalty = hallucinationIncidents * 30 + blindMutations * 5 + failedLookupRate * 20;
  const score = 100 - penalty;

  return {
    score: clamp(Math.round(score)),
    details: {
      hallucinationIncidents,
      blindMutations,
      failedLookupRate: Math.round(failedLookupRate * 100) / 100,
      failedLookups,
      totalLookups: lookups.length,
    },
  };
}

// --- Dimension 6: Session Pacing ---
function scoreSessionPacing(transcript) {
  const turns = transcript.turns;
  if (turns.length < 2) return { score: 75, details: { idleGaps: 0, burstPeriods: 0, avgGapMs: 0 } };

  const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 min
  const BURST_THRESHOLD = 10; // 10+ tool calls in 1 minute

  let idleGaps = 0;
  let burstPeriods = 0;
  const gaps = [];

  for (let i = 1; i < turns.length; i++) {
    const gap = turns[i].timestamp - turns[i - 1].timestamp;
    gaps.push(gap);
    if (gap > IDLE_THRESHOLD_MS) idleGaps++;
  }

  // Detect bursts: count turns with many tool calls in quick succession
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].toolCalls.length >= BURST_THRESHOLD) burstPeriods++;
  }

  const avgGapMs = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;

  // Score: even pacing = 100. Normalize idle gap penalty by session length.
  // A 1-hour session with 5 idle gaps is bad. A 10-hour session with 5 is normal.
  const sessionHours = Math.max(1, transcript.durationMs / 3600000);
  const idleGapsPerHour = idleGaps / sessionHours;
  const penalty = Math.min(60, idleGapsPerHour * 20) + burstPeriods * 10;
  const score = 100 - penalty;

  return {
    score: clamp(Math.round(score)),
    details: {
      idleGaps,
      burstPeriods,
      avgGapMs: Math.round(avgGapMs),
      turnCount: turns.length,
    },
  };
}

/**
 * Compute all 6 scoring dimensions for a parsed transcript.
 * @param {Object} transcript - Output of parseTranscript()
 * @returns {Object} Metrics with score, grade, and details for each dimension
 */
export function computeMetrics(transcript) {
  const costEfficiency = scoreCostEfficiency(transcript);
  const cacheHealth = scoreCacheHealth(transcript);
  const toolDiscipline = scoreToolDiscipline(transcript);
  const stuckThrash = scoreStuckThrash(transcript);
  const qualitySignals = scoreQualitySignals(transcript);
  const sessionPacing = scoreSessionPacing(transcript);

  const overallScore =
    costEfficiency.score * WEIGHTS.costEfficiency +
    cacheHealth.score * WEIGHTS.cacheHealth +
    toolDiscipline.score * WEIGHTS.toolDiscipline +
    stuckThrash.score * WEIGHTS.stuckThrash +
    qualitySignals.score * WEIGHTS.qualitySignals +
    sessionPacing.score * WEIGHTS.sessionPacing;

  return {
    costEfficiency,
    cacheHealth,
    toolDiscipline,
    stuckThrash,
    qualitySignals,
    sessionPacing,
    overall: {
      score: Math.round(overallScore),
      grade: letterGrade(overallScore),
    },
  };
}
