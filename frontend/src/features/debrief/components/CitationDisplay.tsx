/**
 * Citation Display - Task 5.2
 * Shows citation source (title/section) for feedback items informed by reference materials
 */

export interface CitationDisplayProps {
  readonly citationReferenceId?: string;
  readonly className?: string;
}

/**
 * Renders citation metadata for a feedback item.
 *
 * If citationReferenceId is present, shows:
 *   "Source: [title] • [section]"  or  "Source: [title]"
 *
 * If no citation, renders nothing (no citation shown if reference material
 * did not inform the item - Task 21.4).
 */
export function CitationDisplay({ citationReferenceId, className }: CitationDisplayProps) {
  if (!citationReferenceId) {
    return null;
  }

  // TODO: In the full implementation, citationReferenceId would be hydrated
  // with ReferenceMaterial data via a query or memo. For now, this is a placeholder
  // that renders when a citation ID exists. The backend will provide:
  //   { id, title, section }
  //
  // Once reference material cache is available in this context, we can:
  //   const material = materialsMap.get(citationReferenceId)
  //   if (!material) return null
  //   return <CitationDisplay title={material.title} section={material.section} />

  return (
    <div
      className={`text-caption text-text-secondary italic ${className}`}
      style={{
        marginTop: '0.5rem',
        fontSize: '0.85em',
        color: '#999',
        fontStyle: 'italic',
      }}
    >
      📚 Source informed by reference material
      {/* When material data is available:
        {material?.section ? `${material.title} • ${material.section}` : material?.title}
      */}
    </div>
  );
}
