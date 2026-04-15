#!/usr/bin/env node
/**
 * cc-scorecard — Claude Code Session Scorecard
 *
 * Analyzes Claude Code JSONL transcripts and produces a graded quality report.
 *
 * Usage:
 *   node cc-scorecard/index.mjs                     # auto-detect current project
 *   node cc-scorecard/index.mjs --file <path>        # specific transcript file
 *   node cc-scorecard/index.mjs --session <id>       # specific session ID
 *   node cc-scorecard/index.mjs --json               # output JSON instead of HTML
 *   node cc-scorecard/index.mjs --html               # generate HTML report (default)
 *
 * @module cc-scorecard
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseTranscript, findLatestTranscript, findTranscripts } from './lib/transcript-parser.mjs';
import { computeMetrics } from './lib/metrics-engine.mjs';
import { getGradeInfo, formatCost, formatDuration, formatTokens } from './lib/grading.mjs';

function parseArgs(argv) {
  const args = { file: null, session: null, json: false, html: true, projectDir: null };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--file': args.file = argv[++i]; break;
      case '--session': args.session = argv[++i]; break;
      case '--json': args.json = true; args.html = false; break;
      case '--html': args.html = true; args.json = false; break;
      case '--project': args.projectDir = argv[++i]; break;
      default: break;
    }
  }
  return args;
}

function findTranscriptFile(args) {
  if (args.file) {
    if (!existsSync(args.file)) {
      console.error(`Error: Transcript file not found: ${args.file}`);
      process.exit(1);
    }
    return args.file;
  }

  const projectDir = args.projectDir || process.cwd();

  if (args.session) {
    const transcripts = findTranscripts(projectDir);
    const match = transcripts.find(t => t.sessionId === args.session || t.sessionId.startsWith(args.session));
    if (!match) {
      console.error(`Error: No transcript found for session "${args.session}" in project ${projectDir}`);
      process.exit(1);
    }
    return match.path;
  }

  const latest = findLatestTranscript(projectDir);
  if (!latest) {
    console.error(`Error: No transcripts found for project ${projectDir}`);
    console.error(`Expected transcripts at ~/.claude/projects/`);
    process.exit(1);
  }
  return latest;
}

function printTextSummary(metrics, transcript) {
  const grade = getGradeInfo(metrics.overall.score);
  const bar = (score) => {
    const filled = Math.round(score / 5);
    return '\u2588'.repeat(filled) + '\u2591'.repeat(20 - filled);
  };

  console.log('');
  console.log('\u2501'.repeat(60));
  console.log(`  SESSION SCORECARD — Grade: ${grade.grade} (${metrics.overall.score}/100)`);
  console.log('\u2501'.repeat(60));
  console.log(`  Session:  ${transcript.sessionId.slice(0, 8)}...`);
  console.log(`  Duration: ${formatDuration(transcript.durationMs)}`);
  console.log(`  Cost:     ${formatCost(transcript.totals.cost)}`);
  console.log(`  Turns:    ${transcript.turns.length}`);
  console.log(`  Tools:    ${transcript.allToolCalls.length}`);
  console.log('\u2501'.repeat(60));
  console.log('');

  const dims = [
    ['Cost Efficiency', metrics.costEfficiency, `${formatCost(metrics.costEfficiency.details.totalCost)} total`],
    ['Cache Health',    metrics.cacheHealth,     `${Math.round(metrics.cacheHealth.details.hitRatio * 100)}% hit ratio`],
    ['Tool Discipline', metrics.toolDiscipline,  `${metrics.toolDiscipline.details.readEditRatio}:1 R:E ratio`],
    ['Stuck/Thrash',   metrics.stuckThrash,      `${metrics.stuckThrash.details.stuckPeriods} stuck periods`],
    ['Quality Signals', metrics.qualitySignals,   `${metrics.qualitySignals.details.hallucinationIncidents} hallucinations`],
    ['Session Pacing', metrics.sessionPacing,     `${metrics.sessionPacing.details.idleGaps} idle gaps`],
  ];

  for (const [name, dim, detail] of dims) {
    const g = getGradeInfo(dim.score);
    console.log(`  ${name.padEnd(18)} ${bar(dim.score)} ${String(dim.score).padStart(3)}/100  ${detail}`);
  }

  console.log('');
  console.log('\u2501'.repeat(60));
}

async function main() {
  const args = parseArgs(process.argv);
  const transcriptPath = findTranscriptFile(args);
  const transcript = parseTranscript(transcriptPath, { projectDir: args.projectDir || process.cwd() });
  const metrics = computeMetrics(transcript);

  if (args.json) {
    console.log(JSON.stringify(metrics, null, 2));
    return;
  }

  // Default: text summary to terminal
  printTextSummary(metrics, transcript);

  // If --html flag or default, also generate HTML
  if (args.html && !args.json) {
    try {
      const { renderScorecard } = await import('./lib/html-renderer.mjs');
      const htmlPath = renderScorecard(metrics, transcript);
      console.log(`  HTML Report: ${htmlPath}`);
      console.log('');

      // Auto-open in browser
      const { execSync } = await import('node:child_process');
      try {
        execSync(`open "${htmlPath}"`, { stdio: 'ignore' });
      } catch {
        // Not on macOS or open failed — just print path
      }
    } catch (e) {
      console.log(`  (HTML renderer not available: ${e.message})`);
      console.log('');
    }
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
