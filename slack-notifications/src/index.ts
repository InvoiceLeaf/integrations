/**
 * Slack Notifications Integration for InvoiceLeaf
 *
 * Sends real-time notifications to Slack when invoice-related events occur.
 *
 * @packageDocumentation
 */

import { defineIntegration } from '@invoiceleaf/integration-sdk';
import type { SlackIntegrationConfig, DEFAULT_CONFIG } from './types.js';

// Re-export handlers
export {
  handleDocumentCreated,
  handleDocumentProcessed,
  handleDocumentUpdated,
  handleExportCompleted,
  handleDailySummary,
  sendTestMessage,
} from './handlers/index.js';

// Re-export types
export type {
  SlackIntegrationConfig,
  SlackMessage,
  SlackBlock,
  Document,
  Company,
  Export,
  DailySummaryStats,
} from './types.js';

// Re-export Slack utilities
export { SlackClient, SlackApiError, SlackWebhookValidationError } from './slack/index.js';

// ============================================================================
// Integration Manifest
// ============================================================================

/**
 * Slack Notifications Integration Manifest
 *
 * This defines the integration for registration in InvoiceLeaf.
 */
export const manifest = defineIntegration({
  // ─────────────────────────────────────────────────────────────────────────
  // Core Identity
  // ─────────────────────────────────────────────────────────────────────────

  /** Unique identifier (slug) for the integration */
  id: 'slack-notifications',

  /** Display name shown in marketplace */
  name: 'Slack Notifications',

  /** Short description for marketplace listing */
  description:
    'Get real-time Slack notifications when invoices are uploaded, processed, or exported. ' +
    'Stay informed about your invoice activity without leaving Slack.',

  /** Semantic version */
  version: '1.0.0',

  /** Author information */
  author: {
    name: 'InvoiceLeaf',
    email: 'support@invoiceleaf.com',
    url: 'https://invoiceleaf.com',
  },

  /** Icon identifier (maps to icon in frontend) */
  icon: 'slack',

  /** Category for marketplace filtering */
  category: 'notifications',

  /** Tags for search */
  tags: ['slack', 'notifications', 'alerts', 'messaging', 'real-time'],

  // ─────────────────────────────────────────────────────────────────────────
  // Data Access Declarations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Data types this integration needs access to.
   * Used for permission display and scope validation.
   */
  dataAccess: ['documents', 'companies', 'categories'],

  // ─────────────────────────────────────────────────────────────────────────
  // External Authentication (None for webhooks)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * External service authentication requirements.
   * Slack Incoming Webhooks don't require OAuth - just a webhook URL.
   */
  externalAuth: [],

  // ─────────────────────────────────────────────────────────────────────────
  // Triggers (Event Handlers)
  // ─────────────────────────────────────────────────────────────────────────

  triggers: [
    {
      id: 'on-document-created',
      type: 'event',
      name: 'Document Uploaded',
      description: 'Triggered when a new document is uploaded',
      events: ['document.created'],
      handler: 'handleDocumentCreated',
      configurable: true,
    },
    {
      id: 'on-document-processed',
      type: 'event',
      name: 'Document Processed',
      description: 'Triggered when document processing (OCR/extraction) completes',
      events: ['document.processed'],
      handler: 'handleDocumentProcessed',
      configurable: true,
    },
    {
      id: 'on-document-updated',
      type: 'event',
      name: 'Document Updated',
      description: 'Triggered when a document is modified',
      events: ['document.updated'],
      handler: 'handleDocumentUpdated',
      configurable: true,
    },
    {
      id: 'on-export-completed',
      type: 'event',
      name: 'Export Ready',
      description: 'Triggered when an export is ready for download',
      events: ['export.completed'],
      handler: 'handleExportCompleted',
      configurable: true,
    },
    {
      id: 'daily-summary',
      type: 'schedule',
      name: 'Daily Summary',
      description: 'Sends a daily summary of invoice activity at 9 AM',
      schedule: '0 9 * * *', // Cron: 9 AM every day
      handler: 'handleDailySummary',
      configurable: true,
    },
  ],

  // ─────────────────────────────────────────────────────────────────────────
  // Actions (User-Triggered)
  // ─────────────────────────────────────────────────────────────────────────

  actions: [
    {
      id: 'test-connection',
      name: 'Send Test Message',
      description: 'Send a test message to verify the Slack connection',
      handler: 'sendTestMessage',
      icon: 'send',
    },
  ],

  // ─────────────────────────────────────────────────────────────────────────
  // Configuration Schema (JSON Schema)
  // ─────────────────────────────────────────────────────────────────────────

  configSchema: {
    type: 'object',
    properties: {
      // Connection Settings
      webhookUrl: {
        type: 'string',
        title: 'Slack Webhook URL',
        description:
          'Create an Incoming Webhook in your Slack workspace settings. ' +
          'Go to api.slack.com/apps → Create App → Incoming Webhooks → Add New Webhook.',
        format: 'uri',
        pattern: '^https://hooks\\.slack\\.com/services/T[A-Z0-9]+/B[A-Z0-9]+/[a-zA-Z0-9]+$',
      },
      channelOverride: {
        type: 'string',
        title: 'Channel Override',
        description: 'Override the default channel (e.g., #invoices). Leave empty to use webhook default.',
      },
      username: {
        type: 'string',
        title: 'Bot Username',
        description: 'Custom username for the bot (e.g., InvoiceLeaf). Leave empty for default.',
        maxLength: 80,
      },
      iconEmoji: {
        type: 'string',
        title: 'Bot Icon Emoji',
        description: 'Custom emoji for the bot icon (e.g., :receipt:). Leave empty for default.',
        pattern: '^:[a-z0-9_+-]+:$',
      },

      // Notification Toggles
      notifyOnDocumentCreated: {
        type: 'boolean',
        title: 'Notify on document upload',
        description: 'Send a notification when a new document is uploaded',
        default: false,
      },
      notifyOnDocumentProcessed: {
        type: 'boolean',
        title: 'Notify when processing completes',
        description: 'Send a notification when invoice processing is complete with extracted details',
        default: true,
      },
      notifyOnDocumentUpdated: {
        type: 'boolean',
        title: 'Notify on document updates',
        description: 'Send a notification when a document is modified',
        default: false,
      },
      notifyOnExportCompleted: {
        type: 'boolean',
        title: 'Notify when exports are ready',
        description: 'Send a notification when an export is ready for download',
        default: true,
      },
      enableDailySummary: {
        type: 'boolean',
        title: 'Enable daily summary',
        description: 'Send a daily summary of invoice activity at 9 AM',
        default: false,
      },

      // Filters
      minimumAmount: {
        type: 'number',
        title: 'Minimum Amount',
        description: 'Only notify for invoices above this amount (0 = all invoices)',
        minimum: 0,
        default: 0,
      },
      minimumAmountCurrency: {
        type: 'string',
        title: 'Minimum Amount Currency',
        description: 'Currency for the minimum amount filter',
        enum: ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD'],
        default: 'EUR',
      },
      vendorFilter: {
        type: 'array',
        title: 'Vendor Filter',
        description: 'Only notify for invoices from these vendors (empty = all vendors)',
        items: {
          type: 'string',
        },
        uniqueItems: true,
        default: [],
      },
      categoryFilter: {
        type: 'array',
        title: 'Category Filter',
        description: 'Only notify for invoices in these categories (empty = all categories)',
        items: {
          type: 'string',
        },
        uniqueItems: true,
        default: [],
      },
    },
    required: ['webhookUrl'],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // UI Configuration
  // ─────────────────────────────────────────────────────────────────────────

  ui: {
    /** Configuration form layout groups */
    configGroups: [
      {
        title: 'Connection',
        description: 'Configure your Slack webhook connection',
        fields: ['webhookUrl', 'channelOverride', 'username', 'iconEmoji'],
      },
      {
        title: 'Notification Settings',
        description: 'Choose which events trigger notifications',
        fields: [
          'notifyOnDocumentCreated',
          'notifyOnDocumentProcessed',
          'notifyOnDocumentUpdated',
          'notifyOnExportCompleted',
          'enableDailySummary',
        ],
      },
      {
        title: 'Filters',
        description: 'Filter which invoices trigger notifications',
        fields: ['minimumAmount', 'minimumAmountCurrency', 'vendorFilter', 'categoryFilter'],
      },
    ],

    /** Setup instructions displayed during installation */
    setupInstructions: `
## How to Set Up Slack Notifications

1. **Create a Slack App**
   - Go to [api.slack.com/apps](https://api.slack.com/apps)
   - Click "Create New App" → "From scratch"
   - Name it "InvoiceLeaf" and select your workspace

2. **Enable Incoming Webhooks**
   - In your app settings, go to "Incoming Webhooks"
   - Toggle "Activate Incoming Webhooks" to On
   - Click "Add New Webhook to Workspace"
   - Select the channel where you want notifications

3. **Copy the Webhook URL**
   - Copy the webhook URL (starts with https://hooks.slack.com/services/...)
   - Paste it in the "Slack Webhook URL" field below

4. **Configure Notifications**
   - Choose which events you want to be notified about
   - Optionally set filters for amount or vendor

5. **Test the Connection**
   - Click "Send Test Message" to verify everything works
    `,
  },
});

// ============================================================================
// Integration Registration Data
// ============================================================================

/**
 * Registration data for inserting into the Integration table.
 *
 * Use this when registering the integration in the database.
 */
export const registrationData = {
  // Database fields
  slug: 'slack-notifications',
  name: 'Slack Notifications',
  description:
    'Get real-time Slack notifications when invoices are uploaded, processed, or exported. ' +
    'Stay informed about your invoice activity without leaving Slack.',
  longDescription: `
## Stay Connected to Your Invoices

The Slack Notifications integration keeps your team informed about invoice activity in real-time.
No more checking the dashboard constantly - get notified directly in Slack when:

- **New invoices are uploaded** - Know immediately when documents arrive
- **Processing completes** - See extracted details like vendor, amount, and invoice number
- **Exports are ready** - Download your exports without waiting
- **Daily summaries** - Get a morning overview of yesterday's activity

### Smart Filtering

Don't want notification overload? Configure filters to only receive alerts for:
- Invoices above a certain amount
- Specific vendors you care about
- Particular categories

### Easy Setup

Just create a Slack webhook, paste the URL, and you're done. No OAuth complexity, no permissions to manage.
  `.trim(),
  version: '1.0.0',
  category: 'notifications',
  tags: ['slack', 'notifications', 'alerts', 'messaging', 'real-time'],
  icon: 'slack',
  iconUrl: 'https://cdn.invoiceleaf.com/integrations/slack-icon.svg',

  // Author info
  authorName: 'InvoiceLeaf',
  authorEmail: 'support@invoiceleaf.com',
  authorUrl: 'https://invoiceleaf.com',

  // Package source
  packageSource: '@invoiceleaf/integration-slack-notifications',
  packageVersion: '1.0.0',

  // Permissions
  dataAccess: ['documents', 'companies', 'categories'],

  // Status (first-party integrations are pre-approved)
  isPublic: true,
  status: 'PUBLISHED',
  isFirstParty: true,

  // Links
  documentationUrl: 'https://docs.invoiceleaf.com/integrations/slack',
  supportUrl: 'https://support.invoiceleaf.com',
  privacyPolicyUrl: 'https://invoiceleaf.com/privacy',
};

// Default export is the manifest
export default manifest;
