# Slack Notifications Integration

Real-time Slack notifications for InvoiceLeaf invoice events.

## Features

- **Document Uploaded** - Get notified when new documents are uploaded
- **Document Processed** - See extracted invoice details (vendor, amount, invoice #)
- **Document Updated** - Know when invoices are modified
- **Export Ready** - Download exports without waiting
- **Reminder Triggered** - Deliver scheduled reminder messages to Slack
- **Daily Summary** - Morning overview of yesterday's activity

## Installation

```bash
npm install @invoiceleaf/integration-slack-notifications
```

## Quick Start

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click "Create New App" → "From scratch"
3. Name it "InvoiceLeaf" and select your workspace

### 2. Enable Incoming Webhooks

1. In your app settings, go to "Incoming Webhooks"
2. Toggle "Activate Incoming Webhooks" to On
3. Click "Add New Webhook to Workspace"
4. Select the channel for notifications

### 3. Configure in InvoiceLeaf

1. Go to Settings → Integrations → Marketplace
2. Find "Slack Notifications" and click Install
3. Paste your webhook URL
4. Configure notification preferences
5. Click "Send Test Message" to verify

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `webhookUrl` | string | required | Slack Incoming Webhook URL |
| `channelOverride` | string | - | Override default channel |
| `username` | string | - | Custom bot username |
| `iconEmoji` | string | - | Custom bot icon emoji |
| `notifyOnDocumentCreated` | boolean | false | Notify on upload |
| `notifyOnDocumentProcessed` | boolean | true | Notify on processing complete |
| `notifyOnDocumentUpdated` | boolean | false | Notify on updates |
| `notifyOnExportCompleted` | boolean | true | Notify when exports ready |
| `notifyOnReminderTriggered` | boolean | true | Notify when reminders trigger |
| `enableDailySummary` | boolean | false | Enable daily summary at 9 AM |
| `minimumAmount` | number | 0 | Minimum amount filter (0 = all) |
| `minimumAmountCurrency` | string | EUR | Currency for minimum amount |
| `vendorFilter` | string[] | [] | Only notify for these vendors |
| `categoryFilter` | string[] | [] | Only notify for these categories |

## Message Examples

### Document Processed

```
┌─────────────────────────────────────────────┐
│ 📄 Invoice Processed                        │
├─────────────────────────────────────────────┤
│ Vendor: Amazon Web Services                 │
│ Amount: €1,234.56                           │
│ Invoice #: INV-2024-001                     │
│ Date: Jan 15, 2024                          │
│                                             │
│ Net: €1,037.44 | VAT: €197.12               │
│ Category: Cloud Services                    │
│                                             │
│ [View Invoice]                              │
└─────────────────────────────────────────────┘
```

### Daily Summary

```
┌─────────────────────────────────────────────┐
│ 📊 Daily Invoice Summary                    │
├─────────────────────────────────────────────┤
│ Processed: 15 invoices                      │
│ Total Amount: €12,345.67                    │
│ Pending Review: 3                           │
│ Top Vendor: Amazon (5)                      │
│                                             │
│ By Category: Office: 6 | Cloud: 5 | Other: 4│
│                                             │
│ [Open Dashboard] [View Documents]           │
└─────────────────────────────────────────────┘
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Type check
npm run typecheck

# Lint
npm run lint
```

## Project Structure

```
src/
├── index.ts              # Main entry, manifest export
├── types.ts              # TypeScript type definitions
├── handlers/
│   ├── index.ts          # Handler exports
│   ├── documentCreated.ts
│   ├── documentProcessed.ts
│   ├── documentUpdated.ts
│   ├── exportCompleted.ts
│   ├── reminderTriggered.ts
│   ├── dailySummary.ts
│   └── testConnection.ts
├── slack/
│   ├── index.ts          # Slack module exports
│   ├── client.ts         # Webhook client
│   └── blocks.ts         # Block Kit builders
└── utils/
    ├── index.ts          # Utility exports
    ├── formatters.ts     # Currency, date formatting
    └── filters.ts        # Notification filters
```

## API Reference

### SlackClient

```typescript
import { SlackClient } from '@invoiceleaf/integration-slack-notifications';

const client = new SlackClient(webhookUrl, {
  timeout: 10000,  // Request timeout (ms)
  retries: 2,      // Retry count for transient errors
  retryDelay: 1000 // Base delay between retries (ms)
});

await client.sendMessage({
  text: 'Fallback text',
  blocks: [...],
  channel: '#invoices',
  username: 'InvoiceLeaf',
  icon_emoji: ':receipt:'
});
```

### Block Builders

```typescript
import {
  header,
  section,
  sectionWithFields,
  context,
  divider,
  actions,
  button,
  mrkdwn,
  plainText
} from '@invoiceleaf/integration-slack-notifications';

const blocks = [
  header('Invoice Processed'),
  sectionWithFields([
    mrkdwn('*Vendor*\nAmazon'),
    mrkdwn('*Amount*\n€1,234.56')
  ]),
  context(mrkdwn('Category: Cloud Services')),
  divider(),
  actions(
    button('View Invoice', 'view_invoice', { url: 'https://...' })
  )
];
```

### Filters

```typescript
import { shouldNotify, isNotificationEnabled } from '@invoiceleaf/integration-slack-notifications';

// Check if document passes filters
const result = shouldNotify(document, config);
if (!result.shouldNotify) {
  console.log(`Skipped: ${result.reason}`);
}

// Check if notification type is enabled
if (isNotificationEnabled('notifyOnDocumentProcessed', config)) {
  // Send notification
}
```

## License

MIT © InvoiceLeaf
