import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Settings, LineChart, CheckCircle2 } from 'lucide-react';

import { FeedbackTypeSection } from './sections/FeedbackTypeSection';
import { ManagePromptSection } from './sections/ManagePromptSection';
import { AnalyticsSection } from './sections/AnalyticsSection';

type SidebarTab = 'feedback-types' | 'manage-prompt' | 'analytics';

export function DocumentTypeDetailPage() {
  const navigate = useNavigate();
  const { documentTypeId } = useParams<{ documentTypeId: string }>();
  const [activeTab, setActiveTab] = useState<SidebarTab>('feedback-types');

  // Mock data
  const documentType = {
    id: documentTypeId || '1',
    name: 'Memorandum',
    departmentId: 'dept-1',
  };

  const feedbackCategories = [
    { id: '1', title: 'Spelling/Grammar', description: 'Spelling errors, grammatical mistakes, and punctuation issues' },
    { id: '2', title: 'Tone', description: 'Formality, professionalism, and authority of language appropriate for legal writing' },
    { id: '3', title: 'Clarity', description: 'How clear, precise, and understandable the writing is; avoiding ambiguity' },
    { id: '4', title: 'Consistency/Coherence', description: 'Logical consistency, coherent arguments, and maintaining parallel structure' },
    { id: '5', title: 'Persuasiveness', description: 'Strength of arguments, evidence support, and persuasive impact' },
    { id: '6', title: 'Objectivity/Neutrality', description: 'Maintaining neutral language and avoiding bias in legal writing' },
    { id: '7', title: 'Organization', description: 'Structure, logical flow, proper section organization, and document layout' },
  ];

  const sidebarItems = [
    { id: 'feedback-types' as const, label: 'Feedback Types', icon: CheckCircle2 },
    { id: 'manage-prompt' as const, label: 'Manage Prompt', icon: Settings },
    { id: 'analytics' as const, label: 'Analytics', icon: LineChart },
  ];

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="w-64 border-r border-gray-200 bg-white p-6">
        <button
          onClick={() => navigate('/dept-admin')}
          className="mb-8 flex items-center gap-2 text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft size={20} />
          Back
        </button>

        <div className="mb-8">
          <p className="text-xs font-semibold text-gray-500 uppercase">Document Type</p>
          <h2 className="mt-2 text-lg font-semibold text-gray-900">{documentType.name}</h2>
        </div>

        <nav className="space-y-2">
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition ${
                activeTab === item.id
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <item.icon size={18} />
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="p-8">
          {activeTab === 'feedback-types' && (
            <FeedbackTypeSection
              feedbackCategories={feedbackCategories}
            />
          )}
          {activeTab === 'manage-prompt' && (
            <ManagePromptSection
              documentTypeName={documentType.name}
            />
          )}
          {activeTab === 'analytics' && (
            <AnalyticsSection
              feedbackCategories={feedbackCategories}
            />
          )}
        </div>
      </div>
    </div>
  );
}
