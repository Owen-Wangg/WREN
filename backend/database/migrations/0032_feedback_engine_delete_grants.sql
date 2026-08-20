-- Grant DELETE on resolution_status_history, feedback_item, and anchor to
-- wren_feedback_engine so the idempotent delete-before-insert in
-- insert_feedback_items and _persist_carried_forward_items can clear stale rows.

BEGIN;

GRANT DELETE ON TABLE
  feedback_item,
  anchor,
  resolution_status_history
  TO wren_feedback_engine;

COMMIT;
