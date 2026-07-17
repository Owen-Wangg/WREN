/**
 * `@wren/feedback` — Feedback_Service for WREN Writing Coach (Node 22).
 *
 * Orchestrates feedback generation: receives requests from the frontend,
 * enqueues jobs to SQS for async processing, and polls for completion status.
 */
export { handler } from './lambda-handler.js';
