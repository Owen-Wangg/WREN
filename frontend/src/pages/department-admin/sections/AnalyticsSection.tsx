import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export interface FeedbackCategory {
  id: string;
  title: string;
  description: string;
}

interface AnalyticsSectionProps {
  documentTypeId: string;
  feedbackCategories: FeedbackCategory[];
}

export function AnalyticsSection({
  documentTypeId,
  feedbackCategories,
}: AnalyticsSectionProps) {
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
            {feedbackCategories.map((category, index) => (
              <Line
                key={category.id}
                type="monotone"
                dataKey={category.title}
                stroke={colors[index % colors.length]}
                strokeWidth={2}
                dot={{ fill: colors[index % colors.length], r: 4 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Summary Stats */}
      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        {feedbackCategories.map((category, index) => {
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

      <div className="mt-8">
        <p className="text-sm text-gray-600">
          Analytics update weekly based on student submissions and AI debrief feedback across all users in this department.
        </p>
      </div>
    </div>
  );
}
