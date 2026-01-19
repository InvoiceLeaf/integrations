/**
 * Slack Module Exports
 */

export { SlackClient, SlackApiError, SlackWebhookValidationError } from './client.js';
export type { SlackClientOptions } from './client.js';

export {
  // Element builders
  plainText,
  mrkdwn,
  button,
  // Block builders
  header,
  section,
  sectionWithFields,
  context,
  divider,
  actions,
  // Message builders
  buildDocumentCreatedBlocks,
  buildDocumentProcessedBlocks,
  buildDocumentUpdatedBlocks,
  buildExportCompletedBlocks,
  buildDailySummaryBlocks,
  buildTestConnectionBlocks,
  statusAttachment,
} from './blocks.js';
