/**
 * Barrel for shared UI primitives (frontend steering §5: "Shared primitives ...
 * go in `/components/ui`").
 */
export {
  AiDisclaimerNotice,
  AI_DISCLAIMER_DEFAULT_MESSAGE,
  type AiDisclaimerNoticeProps,
} from './AiDisclaimerNotice';

export {
  statusColorMap,
  getStatusColorEntry,
  getStatusColor,
  type StatusColorEntry,
} from './statusColorMap';

export { StatusBadge, type StatusBadgeProps } from './StatusBadge';

export {
  severityLevelMap,
  type SeverityLevel,
  type SeverityLevelEntry,
} from './severityLevelMap';

export { SeverityBadge, type SeverityBadgeProps } from './SeverityBadge';

export { RoleGate, type RoleGateProps } from './RoleGate';
