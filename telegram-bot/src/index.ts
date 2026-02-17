/**
 * Telegram Bot integration handler exports.
 * Manifest is defined in manifest.json at package root.
 */
export {
  buildDocumentProcessedMessage,
  buildExportCompletedMessage,
  buildReminderTriggeredMessage,
  buildPaymentReminderMessage,
  buildWeeklySummaryMessage,
  sendTestTelegramMessage,
  applyDocumentAction,
} from './handlers/index.js';
