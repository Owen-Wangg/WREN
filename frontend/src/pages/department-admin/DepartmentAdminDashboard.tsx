import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';

import { listDepartments, listDocumentTypes } from '@/features/department-admin/departmentAdminApi';
import { ManageFeedbackCategoriesModal, type FeedbackCategory } from './ManageFeedbackCategoriesModal';

export function DepartmentAdminDashboard() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [feedbackCategories, setFeedbackCategories] = useState<FeedbackCategory[]>([
    { id: '1', title: 'Spelling/Grammar', description: 'Spelling errors, grammatical mistakes, and punctuation issues' },
    { id: '2', title: 'Tone', description: 'Formality, professionalism, and authority of language appropriate for legal writing' },
    { id: '3', title: 'Clarity', description: 'How clear, precise, and understandable the writing is; avoiding ambiguity' },
    { id: '4', title: 'Consistency/Coherence', description: 'Logical consistency, coherent arguments, and maintaining parallel structure' },
    { id: '5', title: 'Persuasiveness', description: 'Strength of arguments, evidence support, and persuasive impact' },
    { id: '6', title: 'Objectivity/Neutrality', description: 'Maintaining neutral language and avoiding bias in legal writing' },
    { id: '7', title: 'Organization', description: 'Structure, logical flow, proper section organization, and document layout' },
  ]);

  const { data: departments = [], isLoading: deptLoading } = useQuery({
    queryKey: ['dept-admin-departments'],
    queryFn: () => listDepartments(),
  });

  const currentDepartment = departments[0]; // Use first administered department

  const { data: documentTypes = [], isLoading: typesLoading } = useQuery({
    queryKey: ['dept-admin-document-types', currentDepartment?.id],
    queryFn: () => currentDepartment?.id ? listDocumentTypes(currentDepartment.id) : Promise.resolve([]),
    enabled: !!currentDepartment?.id,
  });

  if (deptLoading || typesLoading) {
    return <div className="p-8">Loading...</div>;
  }

  const filteredDocumentTypes = documentTypes.filter((docType) =>
    docType.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleAddCategory = (category: Omit<FeedbackCategory, 'id'>) => {
    const newId = Math.random().toString(36).substr(2, 9);
    setFeedbackCategories([...feedbackCategories, { id: newId, ...category }]);
  };

  const handleUpdateCategory = (id: string, category: Omit<FeedbackCategory, 'id'>) => {
    setFeedbackCategories(
      feedbackCategories.map((cat) => (cat.id === id ? { id, ...category } : cat))
    );
  };

  const handleDeleteCategory = (id: string) => {
    setFeedbackCategories(feedbackCategories.filter((cat) => cat.id !== id));
  };

  return (
    <div className="p-8">
      {/* Department Banner */}
      <div className="mb-12 rounded-lg border border-blue-200 bg-blue-50 p-6">
        <h2 className="text-lg font-semibold text-blue-900">Department Admin</h2>
        <p className="mt-2 text-sm text-blue-800">
          Managing document types for <span className="font-semibold">{currentDepartment?.name}</span>
        </p>
      </div>

      {/* Document Types Section */}
      <div className="mb-12">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900">Document Types</h1>
          <div className="flex gap-3">
            <button
              onClick={() => setIsModalOpen(true)}
              className="rounded-lg border border-gray-300 px-4 py-2 font-semibold text-gray-900 hover:bg-gray-100"
            >
              Manage Feedback Categories
            </button>
            <button className="rounded-lg bg-gray-900 px-4 py-2 font-semibold text-white hover:bg-gray-800">
              Create new Document Type
            </button>
          </div>
        </div>

        <p className="mb-6 font-semibold text-gray-900">My Document Types ({documentTypes.length})</p>

        <div className="mb-6">
          <input
            type="text"
            placeholder="Search Document Types"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
          />
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {filteredDocumentTypes.map((docType) => (
            <div
              key={docType.id}
              className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => navigate(`/dept-admin/document-type/${docType.id}`)}
            >
              <div className="mb-4 flex items-start justify-between">
                <h3 className="text-xl font-semibold text-gray-900">{docType.name}</h3>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  className="p-1 text-gray-400 hover:text-red-500 transition hover:bg-gray-100 rounded"
                >
                  <Trash2 size={18} />
                </button>
              </div>
              <div className="mb-6 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Department:</span>
                  <span className="font-semibold text-gray-900">{currentDepartment?.name}</span>
                </div>
              </div>
              <button
                className="w-full rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 transition"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/dept-admin/document-type/${docType.id}`);
                }}
              >
                Manage Document Type
              </button>
            </div>
          ))}
        </div>

        {filteredDocumentTypes.length === 0 && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center">
            <p className="text-gray-600">No document types found.</p>
            <button className="mt-4 rounded-lg bg-gray-900 px-4 py-2 font-semibold text-white hover:bg-gray-800">
              Create your first Document Type
            </button>
          </div>
        )}
      </div>

      <ManageFeedbackCategoriesModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        categories={feedbackCategories}
        onAddCategory={handleAddCategory}
        onUpdateCategory={handleUpdateCategory}
        onDeleteCategory={handleDeleteCategory}
      />
    </div>
  );
}
