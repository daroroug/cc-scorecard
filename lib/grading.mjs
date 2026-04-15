/**
 * Grading — Letter grades and display formatting.
 * @module cc-scorecard/lib/grading
 */

export const GRADE_THRESHOLDS = [
  { grade: 'A', min: 85, color: '#22c55e', label: 'Excellent' },
  { grade: 'B', min: 70, color: '#3b82f6', label: 'Good' },
  { grade: 'C', min: 55, color: '#eab308', label: 'Fair' },
  { grade: 'D', min: 40, color: '#f97316', label: 'Poor' },
  { grade: 'F', min: 0,  color: '#ef4444', label: 'Failing' },
];

export function getGradeInfo(score) {
  for (const g of GRADE_THRESHOLDS) {
    if (score >= g.min) return g;
  }
  return GRADE_THRESHOLDS[GRADE_THRESHOLDS.length - 1];
}

export function formatCost(cost) {
  if (cost < 0.01) return '<$0.01';
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

export function formatDuration(ms) {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

export function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
