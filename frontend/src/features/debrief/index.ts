/**
 * Barrel for the AI Debrief feature (task 18.3 + Task 5.2 citations).
 */
export { AiDebriefModal, type AiDebriefModalProps } from './components/AiDebriefModal';
export { SidebarDebriefPanel, type SidebarDebriefPanelProps } from './components/SidebarDebriefPanel';
export {
  FeedbackHelpfulnessPrompt,
  type FeedbackHelpfulnessPromptProps,
} from './components/FeedbackHelpfulnessPrompt';
export { FeedbackItemsList, type FeedbackItemsListProps } from './components/FeedbackItemsList';
export { CitationDisplay, type CitationDisplayProps } from './components/CitationDisplay';

export {
  debriefPath,
  regenerateDebriefPath,
  FEEDBACK_HELPFULNESS_PATH,
  fetchDebrief,
  regenerateDebrief,
  recordFeedbackHelpfulness,
} from './debriefApi';
export {
  debriefSchema,
  feedbackHelpfulnessInputSchema,
  helpfulnessAckSchema,
  type Debrief,
  type FeedbackHelpfulnessInput,
  type HelpfulnessAck,
} from './debriefTypes';
export { useAiDebrief, useRegenerateDebrief, useFeedbackHelpfulness } from './useDebrief';
