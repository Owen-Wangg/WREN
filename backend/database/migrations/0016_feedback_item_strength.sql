-- Migration 0016 — Add strength kind and positive_note to feedback_item.
--
-- "strength" items represent things the student did well, surfaced in the
-- "What's Done Well" debrief section. positive_note holds the concrete
-- affirmation; question_text holds the follow-up question.
--
-- The kind CHECK is rebuilt via a new constraint (ALTER TABLE DROP/ADD
-- CONSTRAINT) because PostgreSQL does not support ALTER CONSTRAINT for
-- CHECK constraints directly.

BEGIN;

-- 1. Drop the existing kind check so we can widen it.
ALTER TABLE feedback_item
    DROP CONSTRAINT IF EXISTS feedback_item_kind_check;

-- 2. Re-add the check with the new value.
ALTER TABLE feedback_item
    ADD CONSTRAINT feedback_item_kind_check
    CHECK (kind IN ('inline', 'structural', 'strength'));

-- 3. Add the positive_note column (nullable — only set on strength items).
ALTER TABLE feedback_item
    ADD COLUMN IF NOT EXISTS positive_note text;

COMMIT;
