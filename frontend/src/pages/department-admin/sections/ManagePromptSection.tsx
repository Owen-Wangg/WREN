import { useState } from 'react';
import { Clock, RotateCcw } from 'lucide-react';

interface PromptVersion {
  id: string;
  createdAt: string;
  createdBy: string;
}

interface ManagePromptSectionProps {
  documentTypeName: string;
}

const promptSections = [
  {
    id: 'purpose',
    label: 'Purpose & Context',
    placeholder: 'What is the purpose of this document type? What context should students understand before writing?',
    helperText: 'Help students understand what this document is for and when they would write it.',
  },
  {
    id: 'criteria',
    label: 'Key Evaluation Criteria',
    placeholder: 'What specific elements or requirements should the document have? What makes a good one?',
    helperText: "List the key things you'll be evaluating this writing on.",
  },
  {
    id: 'tone',
    label: 'Tone & Style',
    placeholder: 'What tone should this document have? How formal should it be? Any specific voice or perspective?',
    helperText: 'Describe the expected tone, formality level, and writing style.',
  },
  {
    id: 'structure',
    label: 'Structure & Organization',
    placeholder: 'How should this document be organized? What sections or structure should it follow?',
    helperText: 'Outline the expected structure, sections, and logical flow.',
  },
  {
    id: 'restrictions',
    label: "Restrictions & Don'ts",
    placeholder: 'What should students avoid? Any specific things that should NOT be in this document?',
    helperText: 'Clarify what mistakes or patterns to watch out for.',
  },
  {
    id: 'notes',
    label: 'Additional Notes',
    placeholder: 'Any other guidance, examples, or context that would be helpful?',
    helperText: "Add any additional information that doesn't fit in other sections.",
  },
];

export function ManagePromptSection({
  documentTypeName,
}: ManagePromptSectionProps) {
  const [promptData, setPromptData] = useState<Record<string, string>>({
    purpose: '',
    criteria: '',
    tone: '',
    structure: '',
    restrictions: '',
    notes: '',
  });

  const [showVersionHistory, setShowVersionHistory] = useState(false);

  // Mock versions
  const versions: PromptVersion[] = [
    {
      id: '3',
      createdAt: '2024-07-10 14:30',
      createdBy: 'You',
    },
    {
      id: '2',
      createdAt: '2024-07-08 10:15',
      createdBy: 'You',
    },
    {
      id: '1',
      createdAt: '2024-07-01 09:00',
      createdBy: 'You',
    },
  ];

  const handleInputChange = (sectionId: string, value: string) => {
    setPromptData((prev) => ({
      ...prev,
      [sectionId]: value,
    }));
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Manage Prompt</h1>
        <p className="mt-2 text-gray-600">
          Configure the prompt that guides how AI will evaluate {documentTypeName} submissions.
          This prompt is combined with the department prompt to provide comprehensive feedback.
        </p>
      </div>

      {/* Version History Button */}
      <div className="mb-8">
        <button
          onClick={() => setShowVersionHistory(!showVersionHistory)}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-100"
        >
          <Clock size={18} />
          Version History ({versions.length})
        </button>

        {showVersionHistory && (
          <div className="mt-4 max-w-md rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="mb-3 text-sm font-semibold text-gray-900">Previous Versions</p>
            <div className="space-y-2">
              {versions.map((version) => (
                <div key={version.id} className="flex items-center justify-between rounded bg-white p-3">
                  <div className="text-sm">
                    <p className="font-medium text-gray-900">{version.createdAt}</p>
                    <p className="text-xs text-gray-600">{version.createdBy}</p>
                  </div>
                  <div className="flex gap-2">
                    <button className="rounded px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100">
                      View
                    </button>
                    <button className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100">
                      <RotateCcw size={14} />
                      Restore
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Prompt Sections */}
      <div className="space-y-6">
        {promptSections.map((section) => (
          <div key={section.id} className="rounded-lg border border-gray-200 bg-white p-6">
            <div className="mb-3">
              <label className="block text-sm font-semibold text-gray-900">
                {section.label}
              </label>
              <p className="mt-1 text-xs text-gray-500">{section.helperText}</p>
            </div>
            <textarea
              value={promptData[section.id]}
              onChange={(e) => handleInputChange(section.id, e.target.value)}
              placeholder={section.placeholder}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              rows={4}
            />
          </div>
        ))}
      </div>

      <div className="mt-8 flex gap-3">
        <button className="rounded-lg bg-gray-900 px-4 py-2 font-semibold text-white hover:bg-gray-800">
          Save Prompt
        </button>
      </div>
    </div>
  );
}
