import { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';

import { useGetHelpfulnessAnalytics, useGetImprovementTrends } from '@/hooks/useDepartmentAdmin';

export interface FeedbackCategory {
  id: string;
  title: string;
  description: string;
}

interface AnalyticsSectionProps {
  documentTypeId: string;
}

const colors = ['#1f2937', '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444'];

const DONUT_COLORS = { helpful: '#10b981', notHelpful: '#e5e7eb' };

type RangePreset = '4w' | '12w' | 'custom' | 'all';

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: '4w',  label: 'Last 4 weeks'  },
  { key: '12w', label: 'Last 12 weeks' },
  { key: 'all', label: 'All time'      },
  { key: 'custom', label: 'Custom'     },
];

function relativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 30) return `${diffDays} days ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return diffMonths === 1 ? '1 month ago' : `${diffMonths} months ago`;
}

export function AnalyticsSection({ documentTypeId }: AnalyticsSectionProps) {
  const { data: helpfulness, isLoading: helpfulnessLoading } = useGetHelpfulnessAnalytics(documentTypeId);
  const { data: trendsData, isLoading: trendsLoading } = useGetImprovementTrends(documentTypeId);

  // ── Date filter state ─────────────────────────────────────────────────────
  const [preset, setPreset] = useState<RangePreset>('12w');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]     = useState('');

  const helpfulPct = helpfulness && helpfulness.total > 0
    ? Math.round((helpfulness.helpful / helpfulness.total) * 100)
    : null;

  const donutData = helpfulness
    ? [
        { name: 'Helpful', value: helpfulness.helpful },
        { name: 'Not helpful', value: helpfulness.notHelpful },
      ]
    : [];

  // ── Filter trend points by selected range ─────────────────────────────────
  const filteredPoints = (() => {
    const all = trendsData?.trends ?? [];
    if (preset === 'all') return all;

    let cutoff: Date | null = null;
    if (preset === '4w') {
      cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 28);
    } else if (preset === '12w') {
      cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 84);
    } else if (preset === 'custom' && customFrom) {
      cutoff = new Date(customFrom);
    }

    const until = preset === 'custom' && customTo ? new Date(customTo) : null;

    return all.filter((p) => {
      const d = new Date(p.weekStart);
      if (cutoff && d < cutoff) return false;
      if (until && d > until) return false;
      return true;
    });
  })();

  // Transform flat trend points → [{ weekLabel, [categoryName]: score }, ...]
  const { chartData, categoryNames } = (() => {
    const points = filteredPoints;
    const weekOrder: string[] = [];
    const weekMap = new Map<string, Record<string, number>>();
    const nameSet = new Set<string>();

    for (const p of points) {
      nameSet.add(p.categoryName);
      if (!weekMap.has(p.week)) {
        weekOrder.push(p.week);
        const label = new Date(p.weekStart).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        });
        weekMap.set(p.week, { weekLabel: label } as unknown as Record<string, number>);
      }
      weekMap.get(p.week)![p.categoryName] = Math.round(p.score);
    }

    return {
      chartData: weekOrder.map((w) => weekMap.get(w)!),
      categoryNames: Array.from(nameSet),
    };
  })();

  // Summary: latest and first week within the filtered window
  const summaryStats = categoryNames.map((name, idx) => {
    const allForCat = filteredPoints.filter((p) => p.categoryName === name);
    const latest = allForCat.at(-1);
    const first  = allForCat.at(0);
    const score  = latest?.score != null ? Math.round(latest.score) : null;
    const improvement = latest && first ? Math.round(latest.score - first.score) : null;
    return { name, score, improvement, idx };
  });

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Analytics</h1>
        <p className="mt-2 text-gray-600">
          Track aggregate student improvement across all feedback categories over time.
        </p>
      </div>

      {/* Improvement Trends Chart */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        {/* Header row: title + preset chips */}
        <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900">Student Improvement Trends</h2>
          <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
            {PRESETS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setPreset(key)}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  preset === key
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="mb-4 text-sm text-gray-500">
          Each week, the AI checks whether students fully resolved the feedback flagged in their previous draft.
          The score is the percentage of issues that were completely addressed — <strong>100</strong> means every flagged issue was fixed,
          <strong> 0</strong> means none were. Partially addressed issues are counted as unresolved.
          Only weeks where students submitted revised drafts appear.
        </p>

        {/* Custom date range — only shown when Custom is selected */}
        {preset === 'custom' && (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <span className="text-xs font-semibold text-gray-500">From</span>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
            <span className="text-xs font-semibold text-gray-500">To</span>
            <input
              type="date"
              value={customTo}
              min={customFrom}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
            {(customFrom || customTo) && (
              <button
                type="button"
                onClick={() => { setCustomFrom(''); setCustomTo(''); }}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Clear
              </button>
            )}
          </div>
        )}


        {trendsLoading ? (
          <p className="text-sm text-gray-500">Loading trends…</p>
        ) : chartData.length === 0 ? (
          <p className="text-sm text-gray-500">
            No improvement data yet. Trends appear once students start submitting revised drafts.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="weekLabel" />
              <YAxis domain={[0, 100]} />
              <Tooltip formatter={(value) => `${value}%`} />
              <Legend />
              {categoryNames.map((name, idx) => (
                <Line
                  key={name}
                  type="monotone"
                  dataKey={name}
                  stroke={colors[idx % colors.length]}
                  strokeWidth={2}
                  dot={{ fill: colors[idx % colors.length], r: 4 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Summary Stats */}
      {summaryStats.length > 0 && (
        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          {summaryStats.map(({ name, score, improvement, idx }) => (
            <div key={name} className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase"
                style={{ color: colors[idx % colors.length] }}>
                {name}
              </p>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {score != null ? `${score}%` : '—'}
              </p>
              {improvement != null && (
                <p className={`mt-1 text-sm font-medium ${improvement >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {improvement >= 0 ? '+' : ''}{improvement}% from start
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* AI Debrief Helpfulness */}
      <div className="mt-10">
        <h2 className="text-xl font-semibold text-gray-900">AI Debrief Helpfulness</h2>
        <p className="mt-1 text-sm text-gray-600">
          Aggregate ratings submitted by students after receiving AI feedback.
        </p>

        {helpfulnessLoading ? (
          <p className="mt-6 text-sm text-gray-500">Loading helpfulness data…</p>
        ) : !helpfulness || helpfulness.total === 0 ? (
          <p className="mt-6 text-sm text-gray-500">No ratings submitted yet for this document type.</p>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Donut chart */}
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h3 className="mb-4 text-base font-semibold text-gray-900">Helpfulness Breakdown</h3>
              <div className="flex items-center gap-6">
                <div className="relative flex-shrink-0">
                  <PieChart width={160} height={160}>
                    <Pie
                      data={donutData}
                      cx={75}
                      cy={75}
                      innerRadius={52}
                      outerRadius={72}
                      startAngle={90}
                      endAngle={-270}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      <Cell fill={DONUT_COLORS.helpful} />
                      <Cell fill={DONUT_COLORS.notHelpful} />
                    </Pie>
                  </PieChart>
                  {/* Center label */}
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold text-gray-900">{helpfulPct}%</span>
                    <span className="text-xs text-gray-500">helpful</span>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-emerald-500 flex-shrink-0" />
                    <span className="text-sm text-gray-700">
                      Helpful — <strong>{helpfulness.helpful}</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-gray-200 flex-shrink-0" />
                    <span className="text-sm text-gray-700">
                      Not helpful — <strong>{helpfulness.notHelpful}</strong>
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">{helpfulness.total} total ratings</p>
                </div>
              </div>
            </div>

            {/* Comments feed */}
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h3 className="mb-4 text-base font-semibold text-gray-900">Recent Comments</h3>
              {helpfulness.comments.length === 0 ? (
                <p className="text-sm text-gray-500">No comments submitted yet.</p>
              ) : (
                <ul className="max-h-64 space-y-3 overflow-y-auto pr-1">
                  {helpfulness.comments.map((c, i) => (
                    <li key={i} className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={[
                            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                            c.helpful
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-red-100 text-red-600',
                          ].join(' ')}
                        >
                          {c.helpful ? '✓ Helpful' : '✗ Not helpful'}
                        </span>
                        <span className="text-xs text-gray-400">{relativeTime(c.createdAt)}</span>
                      </div>
                      <p className="mt-1 text-sm text-gray-700">{c.comment}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="mt-8">
        <p className="text-sm text-gray-600">
          Analytics update weekly based on student submissions and AI debrief feedback across all users in this department.
        </p>
      </div>
    </div>
  );
}
