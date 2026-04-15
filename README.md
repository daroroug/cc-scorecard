# cc-scorecard

**Grade your Claude Code sessions.** Analyzes JSONL transcripts and produces a quality scorecard across 6 dimensions — cost efficiency, cache health, tool discipline, stuck loops, hallucination signals, and session pacing.

Zero dependencies. Works with any Claude Code session. Generates a shareable HTML report.

## Quick Start

```bash
# Run on your current project
npx cc-scorecard

# Specific transcript file
npx cc-scorecard --file ~/.claude/projects/-Users-you-project/session.jsonl

# JSON output (for scripting)
npx cc-scorecard --json
```

## What It Measures

| Dimension | Weight | What It Catches |
|-----------|--------|-----------------|
| **Cost Efficiency** | 20% | High cost-per-turn, wasteful token usage |
| **Cache Health** | 20% | Low cache hit ratio, idle gaps busting the 5-min TTL |
| **Tool Discipline** | 20% | Low Read:Edit ratio, blind edits without reading first |
| **Stuck/Thrash** | 15% | Consecutive failures, retry loops on the same file |
| **Quality Signals** | 15% | Hallucination patterns (failed Read → Edit same path) |
| **Session Pacing** | 10% | Long idle gaps, burst periods |

Each dimension scores 0–100. The weighted composite produces a letter grade:

| Grade | Score | Meaning |
|-------|-------|---------|
| **A** | ≥ 85 | Excellent — efficient, disciplined, no issues |
| **B** | ≥ 70 | Good — minor inefficiencies |
| **C** | ≥ 55 | Fair — notable waste or quality issues |
| **D** | ≥ 40 | Poor — significant problems |
| **F** | < 40 | Failing — major issues across dimensions |

## How It Works

Every Claude Code session writes a JSONL transcript to `~/.claude/projects/`. Each line contains token usage, tool calls, file paths, and timestamps. cc-scorecard reads these transcripts and computes quality metrics — no hooks, no configuration, no API keys needed.

### The 6 Dimensions Explained

**Cost Efficiency** — Measures cost-per-turn normalized for model pricing. Opus sessions are inherently more expensive than Sonnet; the scoring accounts for this. Sessions where the agent wastes turns on failed approaches score lower.

**Cache Health** — Claude Code caches prompt context with a 5-minute TTL. Every time you pause for >5 minutes, the cache expires and the full context must be re-sent (at full price). This dimension measures your cache hit ratio and penalizes idle gaps.

**Tool Discipline** — The Read:Edit ratio is one of the strongest predictors of session quality. Sessions where the agent reads extensively before editing (R:E > 3:1) have significantly fewer hallucinations than sessions where it edits blind (R:E < 1:1).

**Stuck/Thrash** — Detects when the agent enters a failure loop — retrying the same operation, getting the same error, making no progress. Each stuck period wastes tokens and time.

**Quality Signals** — Detects hallucination patterns: when the agent tries to read a file, fails (file doesn't exist), then proceeds to edit that same file anyway. This indicates the agent is operating on false assumptions.

**Session Pacing** — Measures the rhythm of your session. Long idle gaps (>5 min) waste cache. Extreme bursts (many tool calls in rapid succession) may indicate the agent is thrashing. Even pacing scores highest.

## Output Formats

### HTML Report (default)

Generates a self-contained HTML file with:
- Overall grade circle (SVG)
- 6 dimension score bars
- Key metrics (cost, duration, tokens, cache hit ratio)
- Actionable insights based on your scores

The HTML file has zero external dependencies — share it with your team, attach to a PR, or post it on social media.

### JSON (for scripting)

```bash
cc-scorecard --json | jq '.overall'
# { "score": 72, "grade": "B" }
```

### Terminal Summary

The terminal output shows a quick overview with ASCII bar charts:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SESSION SCORECARD — Grade: B (74/100)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Session:  abc12345...
  Duration: 45m
  Cost:     $3.21
  Turns:    28
  Tools:    42
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Cost Efficiency    ████████████████░░░░  82/100  $3.21 total
  Cache Health       ███████████████░░░░░  75/100  72% hit ratio
  Tool Discipline    █████████████████░░░  88/100  3.5:1 R:E ratio
  Stuck/Thrash       ██████████████████░░  90/100  0 stuck periods
  Quality Signals    ███████████████████░  95/100  0 hallucinations
  Session Pacing     █████████████████░░░  85/100  1 idle gap
```

## CLI Options

| Flag | Description |
|------|-------------|
| `--file <path>` | Analyze a specific JSONL transcript file |
| `--session <id>` | Find transcript by session ID (prefix match) |
| `--project <dir>` | Override project directory for auto-detection |
| `--json` | Output JSON to stdout (no HTML) |
| `--html` | Generate HTML report (default) |

## Requirements

- Node.js ≥ 18
- Claude Code JSONL transcripts (generated automatically by Claude Code)

## How Scores Are Calculated

### Cost Efficiency

Based on **cost per turn** (normalizes for session length):
- ≤ $0.10/turn → 100
- ≤ $0.30/turn → 85+
- ≤ $0.60/turn → 70+
- ≤ $1.00/turn → 55+
- \> $2.00/turn → below 40

### Cache Health

Based on **cache hit ratio** (cache_read / total_cache_tokens):
- ≥ 80% → 85+
- ≥ 60% → 70+
- ≥ 40% → 55+

Penalized by idle gaps (>5 min pauses that bust the cache TTL).

### Tool Discipline

Based on **Read:Edit ratio**:
- ≥ 3:1 → 90+
- ≥ 2:1 → 75+
- ≥ 1.5:1 → 60+
- < 1:1 → below 45

Penalized by blind edits (editing files never read in the session).

### Stuck/Thrash

Based on **stuck periods** (3+ consecutive failures) and **retry loops** (same tool+file repeated 3+ times):
- 0 stuck periods, 0 retry loops → 100
- Each stuck period → -25
- Each retry loop → -15

### Quality Signals

Based on **hallucination incidents** (failed Read then Edit same path) and **blind mutations**:
- 0 hallucinations → 100
- Each hallucination → -30
- Each blind edit → -5

### Session Pacing

Based on **idle gaps per hour** and **burst periods**:
- Even pacing, <1 idle gap/hour → 85+
- Penalized proportionally for more frequent gaps

## Background

This tool was built from production experience running multi-agent Claude Code sessions. The scoring dimensions are derived from patterns observed across hundreds of real sessions — specifically the signals that correlate with session quality (fewer bugs, less rework, lower cost).

The Read:Edit ratio in particular emerged from analyzing the Opus 4.6 reasoning regression (Feb-Mar 2026), where degraded sessions showed a characteristic collapse in R:E ratio before quality visibly dropped.

## License

MIT
