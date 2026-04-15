/**
 * HTML Renderer — Generate a beautiful, self-contained HTML scorecard.
 *
 * Design: clean white background, system fonts, SVG score circle,
 * dimension bars, and key metrics. No external dependencies.
 *
 * @module cc-scorecard/lib/html-renderer
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getGradeInfo, formatCost, formatDuration, formatTokens } from './grading.mjs';

function svgScoreCircle(score, grade, size = 180) {
  const { color } = getGradeInfo(score);
  const r = (size - 20) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - score / 100);

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="10"/>
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="10"
      stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
      stroke-linecap="round" transform="rotate(-90 ${c} ${c})"
      style="transition: stroke-dashoffset 1s ease-out"/>
    <text x="${c}" y="${c - 12}" text-anchor="middle" font-size="48" font-weight="700" fill="${color}">${grade}</text>
    <text x="${c}" y="${c + 22}" text-anchor="middle" font-size="18" fill="#64748b">${score}/100</text>
  </svg>`;
}

function dimensionBar(name, score, detail) {
  const { color } = getGradeInfo(score);
  const width = Math.max(2, score);
  return `<div class="dim-row">
    <div class="dim-label">${name}</div>
    <div class="dim-bar-track">
      <div class="dim-bar-fill" style="width:${width}%;background:${color}"></div>
    </div>
    <div class="dim-score" style="color:${color}">${score}</div>
    <div class="dim-detail">${detail}</div>
  </div>`;
}

function statCard(label, value, sub = '') {
  return `<div class="stat-card">
    <div class="stat-value">${value}</div>
    <div class="stat-label">${label}</div>
    ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
  </div>`;
}

function insightCard(icon, title, body) {
  return `<div class="insight-card">
    <div class="insight-icon">${icon}</div>
    <div class="insight-body">
      <div class="insight-title">${title}</div>
      <div class="insight-text">${body}</div>
    </div>
  </div>`;
}

function generateInsights(metrics) {
  const insights = [];
  const ce = metrics.costEfficiency.details;
  const ch = metrics.cacheHealth.details;
  const td = metrics.toolDiscipline.details;
  const st = metrics.stuckThrash.details;
  const qs = metrics.qualitySignals.details;

  if (ch.hitRatio < 0.5) {
    insights.push(insightCard('&#x26A0;', 'Low Cache Hit Ratio',
      `Your cache hit ratio is ${Math.round(ch.hitRatio * 100)}%. Idle gaps (${ch.idleGaps}) may be busting the 5-minute cache TTL. Try to keep interactions flowing without long pauses.`));
  } else if (ch.hitRatio > 0.8) {
    insights.push(insightCard('&#x2705;', 'Excellent Cache Efficiency',
      `${Math.round(ch.hitRatio * 100)}% cache hit ratio means you\'re reusing context efficiently. ${formatTokens(ch.cacheRead)} tokens served from cache.`));
  }

  if (td.readEditRatio < 1.5) {
    insights.push(insightCard('&#x26A0;', 'Low Read:Edit Ratio',
      `Your R:E ratio is ${td.readEditRatio}:1. Sessions with R:E > 3:1 have significantly fewer hallucinations. Read more before editing.`));
  } else if (td.readEditRatio >= 3) {
    insights.push(insightCard('&#x2705;', 'Strong Read:Edit Discipline',
      `${td.readEditRatio}:1 Read:Edit ratio shows thorough understanding before modification. ${td.reads} reads, ${td.edits} edits.`));
  }

  if (td.blindEdits > 3) {
    insights.push(insightCard('&#x1F6A8;', 'Blind Edits Detected',
      `${td.blindEdits} files were edited without being read first in this session. This increases hallucination risk.`));
  }

  if (st.stuckPeriods > 0) {
    insights.push(insightCard('&#x1F504;', 'Stuck Loops Detected',
      `${st.stuckPeriods} stuck period(s) with ${st.maxConsecutiveFailures} max consecutive failures. Consider breaking the approach when 3+ failures occur.`));
  }

  if (qs.hallucinationIncidents > 0) {
    insights.push(insightCard('&#x1F6A8;', 'Hallucination Risk',
      `${qs.hallucinationIncidents} instance(s) where a failed file lookup was followed by an edit to the same path. The agent may have proceeded on false assumptions.`));
  }

  if (ce.totalCost > 5) {
    insights.push(insightCard('&#x1F4B0;', 'High Session Cost',
      `This session cost ${formatCost(ce.totalCost)} (${formatCost(ce.costPerTurn)}/turn). Consider using /fast mode for routine tasks or breaking long sessions into smaller chunks.`));
  }

  if (insights.length === 0) {
    insights.push(insightCard('&#x2728;', 'Clean Session',
      'No significant issues detected. Good discipline across all dimensions.'));
  }

  return insights.join('\n');
}

/**
 * Render a self-contained HTML scorecard.
 * @param {Object} metrics - Output of computeMetrics()
 * @param {Object} transcript - Output of parseTranscript()
 * @param {Object} [opts]
 * @param {string} [opts.outputDir] - Override output directory
 * @returns {string} Path to generated HTML file
 */
export function renderScorecard(metrics, transcript, opts = {}) {
  const outputDir = opts.outputDir || join(process.cwd(), '.claude', 'diagrams');
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  const outputPath = join(outputDir, `session-scorecard-${transcript.sessionId.slice(0, 8)}-${date}.html`);

  const grade = getGradeInfo(metrics.overall.score);
  const ce = metrics.costEfficiency.details;
  const ch = metrics.cacheHealth.details;
  const td = metrics.toolDiscipline.details;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Session Scorecard — Grade ${metrics.overall.grade} (${metrics.overall.score}/100)</title>
<meta name="description" content="Claude Code Session Scorecard: ${metrics.overall.grade} grade across 6 quality dimensions. Generated by cc-scorecard.">
<style>
  :root { --bg:#fff; --surface:#f8fafc; --border:#e2e8f0; --text:#1e293b; --muted:#64748b; --r:10px; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:system-ui,-apple-system,sans-serif; background:var(--bg); color:var(--text); line-height:1.6; }
  .container { max-width:860px; margin:0 auto; padding:2rem; }

  /* Header */
  .header { text-align:center; padding:2rem 0 1.5rem; border-bottom:1px solid var(--border); margin-bottom:2rem; }
  .header h1 { font-size:1.6rem; font-weight:700; letter-spacing:-0.02em; }
  .header .subtitle { color:var(--muted); font-size:0.95rem; margin-top:0.3rem; }

  /* Grade circle */
  .grade-section { text-align:center; margin:1.5rem 0 2rem; }

  /* Stats row */
  .stats-row { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:1rem; margin-bottom:2rem; }
  .stat-card { background:var(--surface); border:1px solid var(--border); border-radius:var(--r); padding:1rem; text-align:center; }
  .stat-value { font-size:1.4rem; font-weight:700; }
  .stat-label { font-size:0.8rem; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; }
  .stat-sub { font-size:0.75rem; color:var(--muted); margin-top:0.2rem; }

  /* Dimensions */
  .dimensions { margin:2rem 0; }
  .dimensions h2 { font-size:1.2rem; margin-bottom:1rem; }
  .dim-row { display:grid; grid-template-columns:140px 1fr 50px 200px; align-items:center; gap:0.8rem; margin-bottom:0.7rem; }
  .dim-label { font-size:0.9rem; font-weight:600; }
  .dim-bar-track { height:12px; background:#e2e8f0; border-radius:6px; overflow:hidden; }
  .dim-bar-fill { height:100%; border-radius:6px; transition:width 0.8s ease-out; }
  .dim-score { font-size:0.95rem; font-weight:700; text-align:right; }
  .dim-detail { font-size:0.8rem; color:var(--muted); }

  /* Insights */
  .insights { margin:2rem 0; }
  .insights h2 { font-size:1.2rem; margin-bottom:1rem; }
  .insight-card { display:flex; gap:0.8rem; padding:0.8rem 1rem; background:var(--surface); border:1px solid var(--border); border-radius:var(--r); margin-bottom:0.6rem; }
  .insight-icon { font-size:1.3rem; flex-shrink:0; }
  .insight-title { font-weight:600; font-size:0.9rem; }
  .insight-text { font-size:0.85rem; color:var(--muted); margin-top:0.2rem; }

  /* Footer */
  .footer { text-align:center; padding:2rem 0; border-top:1px solid var(--border); margin-top:2rem; font-size:0.8rem; color:var(--muted); }
  .footer a { color:var(--muted); }

  @media (max-width:700px) {
    .dim-row { grid-template-columns:1fr; gap:0.3rem; }
    .dim-detail { display:none; }
  }
</style>
</head>
<body>
<div class="container">

  <div class="header">
    <h1>Claude Code Session Scorecard</h1>
    <div class="subtitle">Session ${transcript.sessionId.slice(0, 8)}... &middot; ${date}</div>
  </div>

  <div class="grade-section">
    ${svgScoreCircle(metrics.overall.score, metrics.overall.grade)}
  </div>

  <div class="stats-row">
    ${statCard('Total Cost', formatCost(ce.totalCost), `${formatCost(ce.costPerTurn)}/turn`)}
    ${statCard('Duration', formatDuration(transcript.durationMs))}
    ${statCard('Turns', String(transcript.turns.length), `${ce.toolCalls} tool calls`)}
    ${statCard('Cache Hit', `${Math.round(ch.hitRatio * 100)}%`, `${formatTokens(ch.cacheRead)} tokens cached`)}
    ${statCard('R:E Ratio', `${td.readEditRatio}:1`, `${td.reads}R / ${td.edits}E`)}
    ${statCard('Tokens', formatTokens(transcript.totals.inputTokens + transcript.totals.outputTokens), `${formatTokens(transcript.totals.inputTokens)} in / ${formatTokens(transcript.totals.outputTokens)} out`)}
  </div>

  <div class="dimensions">
    <h2>Scoring Dimensions</h2>
    ${dimensionBar('Cost Efficiency', metrics.costEfficiency.score, `${formatCost(ce.totalCost)} total, ${formatCost(ce.costPerToolCall)}/tool`)}
    ${dimensionBar('Cache Health', metrics.cacheHealth.score, `${Math.round(ch.hitRatio * 100)}% hit, ${ch.idleGaps} idle gaps`)}
    ${dimensionBar('Tool Discipline', metrics.toolDiscipline.score, `${td.readEditRatio}:1 R:E, ${td.blindEdits} blind edits`)}
    ${dimensionBar('Stuck/Thrash', metrics.stuckThrash.score, `${metrics.stuckThrash.details.stuckPeriods} stuck, ${metrics.stuckThrash.details.retryLoops} retry loops`)}
    ${dimensionBar('Quality Signals', metrics.qualitySignals.score, `${metrics.qualitySignals.details.hallucinationIncidents} hallucinations, ${metrics.qualitySignals.details.blindMutations} blind edits`)}
    ${dimensionBar('Session Pacing', metrics.sessionPacing.score, `${metrics.sessionPacing.details.idleGaps} idle gaps, ${metrics.sessionPacing.details.burstPeriods} bursts`)}
  </div>

  <div class="insights">
    <h2>Insights</h2>
    ${generateInsights(metrics)}
  </div>

  <div class="footer">
    Generated by cc-scorecard &middot; ${new Date().toISOString().slice(0, 19)}
  </div>

</div>
</body>
</html>`;

  writeFileSync(outputPath, html);
  return outputPath;
}
