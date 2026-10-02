/**
 * Parse/serialize helpers for the Feedback-Engine department prompt
 * (`department.prompt`), stored as up to three marker-delimited sections.
 */

export interface DepartmentPromptFields {
  context: string;
  standards: string;
  restricted: string;
}

export const EMPTY_DEPARTMENT_PROMPT_FIELDS: DepartmentPromptFields = {
  context: '',
  standards: '',
  restricted: '',
};

const SECTION_MARKERS = {
  context: '[Department Context]',
  standards: '[Writing Standards]',
  restricted: '[Restricted Topics]',
} as const;

/** Split a stored prompt into its marked sections (unmarked text becomes context). */
export function parseDepartmentPrompt(raw: string): DepartmentPromptFields {
  const fields: DepartmentPromptFields = { ...EMPTY_DEPARTMENT_PROMPT_FIELDS };
  if (!raw) return fields;

  const hasMarkers = Object.values(SECTION_MARKERS).some((m) => raw.includes(m));
  if (!hasMarkers) {
    fields.context = raw.trim();
    return fields;
  }

  function extractSection(marker: string): string {
    const idx = raw.indexOf(marker);
    if (idx === -1) return '';
    const start = idx + marker.length;
    const nextMarkerPositions = Object.values(SECTION_MARKERS)
      .filter((m) => m !== marker)
      .map((m) => raw.indexOf(m, start))
      .filter((i) => i !== -1);
    const end = nextMarkerPositions.length > 0 ? Math.min(...nextMarkerPositions) : raw.length;
    return raw.slice(start, end).trim();
  }

  fields.context = extractSection(SECTION_MARKERS.context);
  fields.standards = extractSection(SECTION_MARKERS.standards);
  fields.restricted = extractSection(SECTION_MARKERS.restricted);
  return fields;
}

/** Join the non-empty sections back into the stored marker format. */
export function serializeDepartmentPrompt(fields: DepartmentPromptFields): string {
  const parts: string[] = [];
  if (fields.context.trim()) {
    parts.push(`${SECTION_MARKERS.context}\n${fields.context.trim()}`);
  }
  if (fields.standards.trim()) {
    parts.push(`${SECTION_MARKERS.standards}\n${fields.standards.trim()}`);
  }
  if (fields.restricted.trim()) {
    parts.push(`${SECTION_MARKERS.restricted}\n${fields.restricted.trim()}`);
  }
  return parts.join('\n\n');
}
