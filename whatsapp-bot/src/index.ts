/**
 * WhatsApp Bot integration handler exports.
 * Manifest is defined in manifest.json at package root.
 */
export {
  buildDocumentProcessedMessage,
  buildExportCompletedMessage,
  buildReminderTriggeredMessage,
  buildPaymentReminderMessage,
  buildWeeklySummaryMessage,
  sendTestWhatsAppMessage,
  applyDocumentAction,
} from './handlers/index.js';
