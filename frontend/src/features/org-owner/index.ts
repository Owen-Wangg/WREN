/**
 * Barrel for the Org Owner business console feature (task 19.3): Organization
 * management with Writing Types, Content Types, Metadata Fields, Topics,
 * Members (add users / assign Field Expert), and aggregate analytics.
 *
 * Route path: `/org-owner`
 */

/* Top-level console component */
export {
  OrgOwnerConsole,
  type OrgOwnerConsoleProps,
} from './components/OrgOwnerConsole';

/* Sub-components */
export { WritingTypesList, type WritingTypesListProps } from './components/WritingTypesList';
export { ContentTypesList, type ContentTypesListProps } from './components/ContentTypesList';
export { TopicsList, type TopicsListProps } from './components/TopicsList';
export { MetadataFieldsList, type MetadataFieldsListProps } from './components/MetadataFieldsList';
export { MembersList, type MembersListProps } from './components/MembersList';
export { OrgAnalyticsView, type OrgAnalyticsViewProps } from './components/OrgAnalyticsView';

/* Data-fetching + mutation hooks */
export {
  useOwnedOrganizations,
  useOrgWritingTypes,
  useCreateWritingType,
  useOrgContentTypes,
  useCreateContentType,
  useOrgTopics,
  useCreateTopic,
  useOrgMetadataFields,
  useCreateMetadataField,
  useOrgMembers,
  useAddMember,
  useAssignFieldExpert,
  useOrgAnalytics,
} from './useOrgOwner';

/* API functions */
export {
  ownedOrganizationsPath,
  orgWritingTypesPath,
  orgContentTypesPath,
  orgTopicsPath,
  orgMetadataFieldsPath,
  orgMembersPath,
  orgAnalyticsPath,
  fetchOwnedOrganizations,
  fetchOrgWritingTypes,
  createWritingType,
  fetchOrgContentTypes,
  createContentType,
  fetchOrgTopics,
  createTopic,
  fetchOrgMetadataFields,
  createMetadataField,
  fetchOrgMembers,
  addMember,
  assignFieldExpert,
  fetchOrgAnalytics,
} from './orgOwnerApi';

/* Feature schemas + inferred types */
export {
  organizationSchema,
  organizationsSchema,
  contentTypeSchema,
  contentTypesSchema,
  topicSchema,
  topicsSchema,
  metadataFieldConfigSchema,
  metadataFieldsSchema,
  orgMemberSchema,
  orgMembersSchema,
  orgWritingTypeAggregateSchema,
  orgAggregateAnalyticsSchema,
  createWritingTypeInputSchema,
  createContentTypeInputSchema,
  createTopicInputSchema,
  createMetadataFieldInputSchema,
  addMemberInputSchema,
  assignFieldExpertInputSchema,
  type Organization,
  type ContentType,
  type Topic,
  type MetadataFieldConfigDto,
  type OrgMember,
  type OrgWritingTypeAggregate,
  type OrgAggregateAnalytics,
  type CreateWritingTypeInput,
  type CreateContentTypeInput,
  type CreateTopicInput,
  type CreateMetadataFieldInput,
  type AddMemberInput,
  type AssignFieldExpertInput,
} from './orgOwnerTypes';
