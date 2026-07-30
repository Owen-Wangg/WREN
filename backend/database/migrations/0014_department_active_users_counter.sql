-- Migration 0014 — Seed aggregate_counter rows for department active user counts.
--
-- Defines the canonical "active users" metric for a department as the number
-- of distinct students who have submitted at least one document to any document
-- type belonging to that department.
--
-- The window_start sentinel '-infinity' represents a timeless running total
-- (distinct from the weekly-windowed feedback_items_generated metric). The
-- UNIQUE constraint on (scope_kind, scope_id, metric, window_start) ensures
-- exactly one row per department for this metric.
--
-- Ongoing maintenance (increment on document create, decrement on document
-- delete) is handled by the application write path in the Document_Service.

INSERT INTO aggregate_counter (scope_kind, scope_id, metric, window_start, value)
SELECT
    'department',
    d.id,
    'active_users',
    '-infinity'::timestamptz,
    COALESCE(COUNT(DISTINCT doc.owner_user_id), 0)
FROM department d
LEFT JOIN document_type dt ON dt.department_id = d.id
LEFT JOIN document doc ON doc.document_type_id = dt.id
GROUP BY d.id
ON CONFLICT (scope_kind, scope_id, metric, window_start)
DO UPDATE SET value = EXCLUDED.value;
