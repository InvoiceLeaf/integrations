/**
 * Telegram Bot integration handler exports.
 * Manifest is defined in manifest.json at package root.
 */
export {
  buildDocumentProcessedMessage,
  buildExportCompletedMessage,
  buildPaymentReminderMessage,
  buildWeeklySummaryMessage,
  sendTestTelegramMessage,
  applyDocumentAction,
} from './handlers/index.js';
