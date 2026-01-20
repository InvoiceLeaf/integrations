/**
 * Slack Notifications Integration for InvoiceLeaf
 *
 * Sends real-time notifications to Slack when invoice-related events occur.
 *
 * The integration manifest is defined in manifest.json at the package root.
 * This file exports the handlers referenced by the manifest.
 *
 * @packageDocumentation
 */

// ============================================================================
// Handler Exports
// ============================================================================

// Export all handlers that are referenced in manifest.json
export {
  handleDocumentCreated,
  handleDocumentProcessed,
  handleDocumentUpdated,
  handleExportCompleted,
  handleDailySummary,
  sendTestMessage,
} from './handlers/index.js';

// ============================================================================
// Type Exports
// ============================================================================

export type {
  SlackIntegrationConfig,
  SlackMessage,
  SlackBlock,
  Document,
  Company,
  Export,
  DailySummaryStats,
} from './types.js';

// ============================================================================
// Utility Exports
// ============================================================================

export { SlackClient, SlackApiError, SlackWebhookValidationError } from './slack/index.js';

