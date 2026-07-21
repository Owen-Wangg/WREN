import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';

import { useGetHelpfulnessAnalytics } from '@/hooks/useDepartmentAdmin';

export interface FeedbackCategory {
  id: string;
  title: string;
  description: string;
}

interface AnalyticsSectionProps {
  feedbackCategories: FeedbackCategory[];
  documentTypeId: string;
}

// Mock analytics data - showing improvement over time per feedback category
const analyticsData = [
  {
    week: 'Week 1',
    'Spelling/Grammar': 65,
    'Tone': 60,
    'Clarity': 55,
    'Consistency/Coherence': 50,
    'Persuasiveness': 58,
    'Objectivity/Neutrality': 62,
    'Organization': 70,
  },
  {
    week: 'Week 2',
    'Spelling/Grammar': 72,
    'Tone': 68,
    'Clarity': 62,
    'Consistency/Coherence': 60,
    'Persuasiveness': 65,
    'Objectivity/Neutrality': 68,
    'Organization': 75,
  },
  {
    week: 'Week 3',
    'Spelling/Grammar': 78,
    'Tone': 75,
    'Clarity': 70,
    'Consistency/Coherence': 72,
    'Persuasiveness': 75,
    'Objectivity/Neutrality': 76,
    'Organization': 80,
  },
  {
    week: 'Week 4',
    'Spelling/Grammar': 82,
    'Tone': 80,
    'Clarity': 77,
    'Consistency/Coherence': 80,
    'Persuasiveness': 82,
    'Objectivity/Neutrality': 82,
    'Organization': 85,
  },
  {
    week: 'Week 5',
    'Spelling/Grammar': 87,
    'Tone': 85,
    'Clarity': 82,
    'Consistency/Coherence': 85,
    'Persuasiveness': 87,
    'Objectivity/Neutrality': 86,
    'Organization': 88,
  },
];

const colors = ['#1f2937', '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444'];

const DONUT_COLORS = { helpful: '#10b981', notHelpful: '#e5e7eb' };

function relativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 30) return `${diffDays} days ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return diffMonths === 1 ? '1 month ago' : `${diffMonths} months ago`;
}

export function AnalyticsSection({ feedbackCategories, documentTypeId }: AnalyticsSectionProps) {
  const { data: helpfulness, isLoading: helpfulnessLoading } = useGetHelpfulnessAnalytics(documentTypeId);

  const helpfulPct = helpfulness && helpfulness.total > 0
    ? Math.round((helpfulness.helpful / helpfulness.total) * 100)
    : null;

  const donutData = helpfulness
    ? [
        { name: 'Helpful', value: helpfulness.helpful },
        { name: 'Not helpful', value: helpfulness.notHelpful },
      ]
    : [];

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
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Student Improvement Trends</h2>
        <p className="mb-6 text-sm text-gray-600">
          Average improvement scores by feedback category (scale: 0-100)
        </p>

        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={analyticsData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="week" />
            <YAxis domain={[0, 100]} />
            <Tooltip formatter={(value) => `${value}%`} />
            <Legend />
            {feedbackCategories.map((category, idx) => (
              <Line
                key={category.id}
                type="monotone"
                dataKey={category.title}
                stroke={colors[idx % colors.length]}
                strokeWidth={2}
                dot={{ fill: colors[idx % colors.length], r: 4 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Summary Stats */}
      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        {feedbackCategories.map((category) => {
          const lastDataPoint = analyticsData[analyticsData.length - 1];
          const score = lastDataPoint[category.title as keyof typeof lastDataPoint] || 0;
          const firstDataPoint = analyticsData[0];
          const initialScore = firstDataPoint[category.title as keyof typeof firstDataPoint] || 0;
          const improvement = (score as number) - (initialScore as number);

          return (
            <div key={category.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase">{category.title}</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">{score}%</p>
              <p className={`mt-1 text-sm font-medium ${improvement >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {improvement >= 0 ? '+' : ''}{improvement}% from start
              </p>
            </div>
          );
        })}
      </div>

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
