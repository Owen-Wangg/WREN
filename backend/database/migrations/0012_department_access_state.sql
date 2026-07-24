-- Department-wide student access lock (OPEN/LOCKED), controlled by System Admin.
-- Defaults to OPEN. Document-type access_state is retained for compatibility but
-- enforcement and admin UI move to the department.

ALTER TABLE department
  ADD COLUMN IF NOT EXISTS access_state text NOT NULL DEFAULT 'OPEN';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'department_access_state_check'
  ) THEN
    ALTER TABLE department
      ADD CONSTRAINT department_access_state_check
      CHECK (access_state IN ('OPEN', 'LOCKED'));
  END IF;
END $$;

-- Existing departments: open unless every document type is currently locked
-- (and at least one exists). Empty departments stay OPEN.
UPDATE department d
SET access_state = CASE
  WHEN EXISTS (
    SELECT 1 FROM document_type dt WHERE dt.department_id = d.id
  ) AND NOT EXISTS (
    SELECT 1 FROM document_type dt
    WHERE dt.department_id = d.id AND dt.access_state = 'OPEN'
  ) THEN 'LOCKED'
  ELSE 'OPEN'
END;

-- New document types default open; sync existing types to their department state.
ALTER TABLE document_type ALTER COLUMN access_state SET DEFAULT 'OPEN';
UPDATE document_type dt
SET access_state = d.access_state
FROM department d
WHERE dt.department_id = d.id;
