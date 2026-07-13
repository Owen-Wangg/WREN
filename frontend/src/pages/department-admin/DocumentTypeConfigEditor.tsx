/**
 * Document Type Configuration Editor - Task 6.1
 * Department Admin UI for managing taxonomy, prompts, and reference materials
 *
 * Boundary:
 * - Dept Admin edits: prompt content (tone, density, priority, type text)
 * - System scaffolding shown read-only (controlled by Tech Admin)
 * - Ghostwriting guardrail rejects unsafe prompts
 */
import React, { useState } from 'react';
import { useAuth, useGetDocumentTypeConfig, useUpdateDocumentTypeConfig } from '@/hooks';
import { ReferenceMaterialManager } from './ReferenceMaterialManager';

export interface DocumentTypeConfigEditorProps {
  readonly departmentId: string;
  readonly documentTypeId: string;
}

export function DocumentTypeConfigEditor({
  departmentId,
  documentTypeId,
}: DocumentTypeConfigEditorProps) {
  const { user } = useAuth();
  const configQuery = useGetDocumentTypeConfig(documentTypeId);
  const updateConfigMutation = useUpdateDocumentTypeConfig();

  const [promptContent, setPromptContent] = useState('');
  const [tone, setTone] = useState('');
  const [density, setDensity] = useState('');
  const [priority, setPriority] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const config = configQuery.data;

  React.useEffect(() => {
    if (config) {
      setPromptContent(config.promptText || '');
      setTone(config.tone || '');
      setDensity(config.density || '');
      setPriority(config.priority || '');
    }
  }, [config]);

  const validatePrompt = (text: string): string | null => {
    // Guardrail: reject ghostwriting instructions (REQ-PROMPT-EDIT-01.5)
    const ghostwritingPatterns = [
      /write.*for.*student/i,
      /generate.*submission/i,
      /create.*essay/i,
      /replace.*student.*work/i,
    ];

    for (const pattern of ghostwritingPatterns) {
      if (pattern.test(text)) {
        return 'Prompt cannot contain ghostwriting instructions. The AI should provide feedback and guidance only, not generate student work.';
      }
    }

    return null;
  };

  const handleSaveConfig = async () => {
    const validation = validatePrompt(promptContent);
    if (validation) {
      setError(validation);
      return;
    }

    try {
      setError(null);
      await updateConfigMutation.mutateAsync({
        documentTypeId,
        promptText: promptContent,
        tone,
        density,
        priority,
      });
      setSuccessMessage('Configuration saved successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration');
    }
  };

  if (configQuery.isLoading) {
    return <div>Loading configuration...</div>;
  }

  if (configQuery.isError) {
    return <div>Error loading configuration</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Header */}
      <h2 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>
        Document Type Configuration
      </h2>

      {/* Messages */}
      {error && (
        <div
          style={{
            padding: '1rem',
            backgroundColor: '#ffe0e0',
            color: '#cc0000',
            borderRadius: '4px',
          }}
        >
          ⚠️ {error}
        </div>
      )}
      {successMessage && (
        <div
          style={{
            padding: '1rem',
            backgroundColor: '#e0ffe0',
            color: '#00aa00',
            borderRadius: '4px',
          }}
        >
          ✓ {successMessage}
        </div>
      )}

      {/* Prompt Editor Section */}
      <div style={{ border: '1px solid #ddd', borderRadius: '4px', padding: '1.5rem' }}>
        <h3 style={{ margin: '0 0 1rem 0', fontWeight: 600 }}>
          Feedback Prompt
        </h3>
        <p style={{ color: '#666', fontSize: '0.9em', margin: '0 0 1rem 0' }}>
          Edit the prompt that guides AI feedback generation for this document type.
          System scaffolding is managed by Technical Admin and shown read-only below.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Prompt Content */}
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem' }}>
              Prompt Content *
            </label>
            <textarea
              value={promptContent}
              onChange={(e) => setPromptContent(e.target.value)}
              placeholder="Describe what kind of feedback this document type should receive..."
              rows={8}
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontFamily: 'monospace',
                fontSize: '0.9em',
              }}
            />
          </div>

          {/* Tone */}
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem' }}>
              Tone
            </label>
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '1px solid #ddd',
                borderRadius: '4px',
              }}
            >
              <option value="">Select tone...</option>
              <option value="formal">Formal</option>
              <option value="conversational">Conversational</option>
              <option value="encouraging">Encouraging</option>
              <option value="direct">Direct</option>
            </select>
          </div>

          {/* Density */}
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem' }}>
              Feedback Density
            </label>
            <select
              value={density}
              onChange={(e) => setDensity(e.target.value)}
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '1px solid #ddd',
                borderRadius: '4px',
              }}
            >
              <option value="">Select density...</option>
              <option value="light">Light (few items)</option>
              <option value="moderate">Moderate</option>
              <option value="comprehensive">Comprehensive (many items)</option>
            </select>
          </div>

          {/* Priority */}
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem' }}>
              Focus Priority
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '1px solid #ddd',
                borderRadius: '4px',
              }}
            >
              <option value="">Select priority...</option>
              <option value="clarity">Clarity</option>
              <option value="structure">Structure</option>
              <option value="mechanics">Mechanics</option>
              <option value="argument">Argument Strength</option>
            </select>
          </div>

          {/* System Scaffolding (read-only) */}
          <div
            style={{
              padding: '1rem',
              backgroundColor: '#f5f5f5',
              borderRadius: '4px',
              border: '1px solid #ddd',
            }}
          >
            <p style={{ margin: '0 0 0.5rem 0', fontWeight: 600, fontSize: '0.9em' }}>
              🔒 System Scaffolding (Read-only - managed by Technical Admin)
            </p>
            <p style={{ margin: 0, fontSize: '0.85em', color: '#666' }}>
              {config?.systemScaffold
                ? config.systemScaffold
                : 'No system scaffolding configured'}
            </p>
          </div>

          {/* Save Button */}
          <button
            onClick={handleSaveConfig}
            disabled={updateConfigMutation.isPending}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: '#0066cc',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 600,
              opacity: updateConfigMutation.isPending ? 0.6 : 1,
            }}
          >
            {updateConfigMutation.isPending ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>

      {/* Reference Materials Manager */}
      <ReferenceMaterialManager
        departmentId={departmentId}
        documentTypeId={documentTypeId}
      />
    </div>
  );
}
