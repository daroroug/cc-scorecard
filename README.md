<p align="center">
  <h1 align="center">cc-scorecard</h1>
  <p align="center"><strong>Grade your Claude Code sessions.</strong></p>
  <p align="center">
    6-dimension quality analysis &bull; Self-contained HTML report &bull; Zero dependencies
  </p>
</p>

---

Every Claude Code session writes a JSONL transcript. Nobody reads them. **cc-scorecard** does — it parses your transcripts, scores your session across 6 quality dimensions, and tells you exactly what went well and what burned money.

## Example Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SESSION SCORECARD — Grade: B (74/100)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Session:  abc12345...
  Duration: 42m
  Cost:     $2.84
  Turns:    32
  Tools:    48
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Cost Efficiency    ████████████████░░░░  82/100  $2.84 total
  Cache Health       ███████████████░░░░░  75/100  72% hit ratio
  Tool Discipline    █████████████████░░░  88/100  3.5:1 R:E ratio
  Stuck/Thrash       ██████████████████░░  90/100  0 stuck periods
  Quality Signals    ███████████████████░  95/100  0 hallucinations
  Session Pacing     █████████████████░░░  85/100  1 idle gap
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

It also generates a **beautiful HTML report** you can share with your team:

<!-- TODO: Add screenshot of HTML report -->
<!-- ![HTML Report](docs/screenshot.png) -->

## Quick Start

```bash
# Analyze your current project's latest session
npx cc-scorecard

# Analyze a specific transcript file
npx cc-scorecard --file ~/.claude/projects/-Users-you-myproject/session-id.jsonl

# Get JSON output (pipe to jq, scripts, dashboards)
npx cc-scorecard --json
```

That's it. No config. No API keys. No setup.

## What It Measures

### The 6 Dimensions

| Dimension | Weight | What It Catches | Why It Matters |
|-----------|--------|-----------------|----------------|
| **Cost Efficiency** | 20% | High $/turn, wasteful token usage | Opus sessions at $0.50+/turn are burning money |
| **Cache Health** | 20% | Low cache hit ratio, idle gaps busting TTL | Every 5-min pause costs you a full context re-send |
| **Tool Discipline** | 20% | Low Read:Edit ratio, blind edits | Sessions with R:E > 3:1 have far fewer hallucinations |
| **Stuck/Thrash** | 15% | Consecutive failures, retry loops | Stuck loops waste 15-20% of typical session tokens |
| **Quality Signals** | 15% | Failed Read then Edit to same path | The #1 hallucination pattern: editing files that don't exist |
| **Session Pacing** | 10% | Long idle gaps, burst periods | Cache TTL is 5 minutes — every pause costs real money |

### Grading Scale

| Grade | Score | What It Means |
|-------|-------|---------------|
| **A** | ≥ 85 | Excellent — efficient, disciplined, no issues |
| **B** | ≥ 70 | Good — minor inefficiencies, mostly clean |
| **C** | ≥ 55 | Fair — notable waste or quality issues to address |
| **D** | ≥ 40 | Poor — significant problems dragging down quality |
| **F** | < 40 | Failing — major issues, session was wasteful or risky |

## How It Works

```
~/.claude/projects/<hash>/<session>.jsonl    ← Every CC session writes this
         │
         ▼
   cc-scorecard analyze                      ← Parses token usage, tool calls, timing
         │
         ├── Cost: token counts × pricing
         ├── Cache: cache_read / (cache_read + cache_creation)
         ├── Tools: Read:Edit ratio, blind edit detection
         ├── Stuck: consecutive failure runs, retry fingerprints
         ├── Quality: failed-lookup → write correlation
         └── Pacing: idle gap detection, burst analysis
         │
         ▼
   Grade: B (74/100)                         ← Weighted composite
   + HTML report                             ← Opens in browser
```

**Zero dependencies.** Pure Node.js built-ins (`fs`, `path`, `os`). No `better-sqlite3`, no API calls, no external services. Reads files that already exist on your machine.

## The Key Insight: Read:Edit Ratio

The single most predictive metric for session quality is the **Read:Edit ratio** — how many files the agent reads before it edits.

| R:E Ratio | What It Means | Quality Impact |
|-----------|---------------|----------------|
| > 3:1 | Agent reads extensively before editing | Significantly fewer hallucinations |
| 2:1 – 3:1 | Reasonable discipline | Some blind spots |
| 1:1 – 2:1 | Editing as much as reading | Elevated hallucination risk |
| < 1:1 | Editing more than reading | High risk — agent is guessing |

This metric emerged from analyzing the [Opus 4.6 reasoning regression](https://github.com/daroroug/rarix/blob/main/docs/claude-degradation/claude-code-degradation-remedy-package-public.html) (Feb-Mar 2026), where degraded sessions showed a characteristic R:E ratio collapse before quality visibly dropped.

## CLI Reference

| Flag | Description |
|------|-------------|
| `--file <path>` | Analyze a specific JSONL transcript |
| `--session <id>` | Find transcript by session ID (prefix match) |
| `--project <dir>` | Override project directory for auto-detection |
| `--json` | Output JSON to stdout (for scripting) |
| `--html` | Generate HTML report and open in browser (default) |

## JSON Output

```bash
npx cc-scorecard --json | jq '.overall'
```

```json
{
  "score": 74,
  "grade": "B"
}
```

Full output includes all 6 dimensions with details:

```bash
npx cc-scorecard --json | jq '.cacheHealth'
```

```json
{
  "score": 75,
  "details": {
    "hitRatio": 0.72,
    "cacheRead": 50000,
    "cacheCreation": 20000,
    "idleGaps": 2,
    "cacheWasteTokens": 20000
  }
}
```

## Requirements

- Node.js ≥ 18
- Claude Code JSONL transcripts (generated automatically by every Claude Code session)

## Background

Built from production experience running multi-agent Claude Code sessions (4+ agents, 8+ hour sessions). The scoring dimensions come from real patterns observed across hundreds of sessions — specifically the signals that correlate with fewer bugs, less rework, and lower cost.

## License

MIT — [Dan Arouag](https://github.com/daroroug)
