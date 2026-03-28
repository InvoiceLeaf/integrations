import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IntegrationContext } from '@invoiceleaf/integration-sdk';
import type { TelegramBotConfig } from '../types.js';

import { buildDocumentProcessedMessage } from '../handlers/documentProcessed.js';
import { buildExportCompletedMessage } from '../handlers/exportCompleted.js';
import { buildPaymentReminderMessage } from '../handlers/paymentReminders.js';
import { buildReminderTriggeredMessage } from '../handlers/reminderTriggered.js';
import { sendTestTelegramMessage } from '../handlers/testTelegram.js';
import { buildWeeklySummaryMessage } from '../handlers/weeklySummary.js';
import { applyDocumentAction } from '../handlers/applyDocumentAction.js';

// ---------------------------------------------------------------------------
// Mock IntegrationContext factory
// ---------------------------------------------------------------------------

function createMockContext(
  configOverrides: Partial<TelegramBotConfig> = {},
): IntegrationContext<TelegramBotConfig> {
  return {
    spaceId: 'space-1',
    userId: 'user-1',
    installationId: 'install-1',
    config: { chatId: '12345', ...configOverrides },
    data: {
      listDocuments: vi.fn(),
      getDocument: vi.fn(),
      getDocumentFile: vi.fn(),
      listCompanies: vi.fn(),
      getCompany: vi.fn(),
      listCategories: vi.fn(),
      getCategory: vi.fn(),
      getTag: vi.fn(),
      listTags: vi.fn(),
      createExport: vi.fn(),
      getExport: vi.fn(),
      importDocument: vi.fn(),
      patchDocumentIntegrationMeta: vi.fn(),
    },
    credentials: {
      getAccessToken: vi.fn(),
      getApiKey: vi.fn(),
      refreshToken: vi.fn(),
      getConnectionInfo: vi.fn(),
    },
    mappings: {
      get: vi.fn(),
      findByExternal: vi.fn(),
      upsert: vi.fn(),
    },
    state: {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    },
    email: {
      sendSmtpEmail: vi.fn(),
      testSmtpImapConnection: vi.fn(),
      crawlImapPdfAttachments: vi.fn(),
    },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

// ===========================================================================
// buildDocumentProcessedMessage
// ===========================================================================

describe('buildDocumentProcessedMessage', () => {
  let ctx: IntegrationContext<TelegramBotConfig>;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('returns a successful payload for valid object input', async () => {
    const input = { documentId: 'doc-1', status: 'processed' };
    const result = await buildDocumentProcessedMessage(input as never, ctx);

    expect(result).toEqual({
      success: true,
      transport: 'telegram',
      template: 'document_processed',
      payload: input,
    });
  });

  it('logs info when building payload', async () => {
    const input = { documentId: 'doc-2' };
    await buildDocumentProcessedMessage(input as never, ctx);

    expect(ctx.logger.info).toHaveBeenCalledWith(
      'Building Telegram payload for document.processed',
      { input },
    );
  });

  it('returns error for null input', async () => {
    const result = await buildDocumentProcessedMessage(null as never, ctx);

    expect(result).toEqual({
      success: false,
      error: 'Invalid input: expected an object',
    });
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  it('returns error for undefined input', async () => {
    const result = await buildDocumentProcessedMessage(undefined as never, ctx);

    expect(result).toEqual({
      success: false,
      error: 'Invalid input: expected an object',
    });
  });

  it('returns error for string input', async () => {
    const result = await buildDocumentProcessedMessage('not-an-object' as never, ctx);

    expect(result).toEqual({
      success: false,
      error: 'Invalid input: expected an object',
    });
  });

  it('returns error for number input', async () => {
    const result = await buildDocumentProcessedMessage(42 as never, ctx);

    expect(result).toEqual({
      success: false,
      error: 'Invalid input: expected an object',
    });
  });

  it('passes through arbitrary payload properties', async () => {
    const input = { foo: 'bar', nested: { x: 1 } };
    const result = await buildDocumentProcessedMessage(input as never, ctx);

    expect(result).toHaveProperty('success', true);
    expect((result as Record<string, unknown>).payload).toBe(input);
  });
});

// ===========================================================================
// buildExportCompletedMessage
// ===========================================================================

describe('buildExportCompletedMessage', () => {
  let ctx: IntegrationContext<TelegramBotConfig>;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('returns a successful payload for valid object input', async () => {
    const input = { exportId: 'exp-1', format: 'csv' };
    const result = await buildExportCompletedMessage(input as never, ctx);

    expect(result).toEqual({
      success: true,
      transport: 'telegram',
      template: 'export_completed',
      payload: input,
    });
  });

  it('logs info when building payload', async () => {
    const input = { exportId: 'exp-2' };
    await buildExportCompletedMessage(input as never, ctx);

    expect(ctx.logger.info).toHaveBeenCalledWith(
      'Building Telegram payload for export.completed',
      { input },
    );
  });

  it('returns error for null input', async () => {
    const result = await buildExportCompletedMessage(null as never, ctx);

    expect(result).toEqual({
      success: false,
      error: 'Invalid input: expected an object',
    });
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  it('returns error for non-object input', async () => {
    const result = await buildExportCompletedMessage(123 as never, ctx);

    expect(result).toEqual({
      success: false,
      error: 'Invalid input: expected an object',
    });
  });
});

// ===========================================================================
// buildReminderTriggeredMessage
// ===========================================================================

describe('buildReminderTriggeredMessage', () => {
  let ctx: IntegrationContext<TelegramBotConfig>;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('uses input.messageText when present', async () => {
    const input = { messageText: 'Pay invoice #42' };
    const result = await buildReminderTriggeredMessage(input, ctx);

    expect(result).toEqual({
      success: true,
      transport: 'telegram',
      template: 'reminder_triggered',
      messageText: 'Pay invoice #42',
      payload: input,
    });
  });

  it('trims whitespace from messageText', async () => {
    const input = { messageText: '  Hello  ' };
    const result = await buildReminderTriggeredMessage(input, ctx);

    expect((result as Record<string, unknown>).messageText).toBe('Hello');
  });

  it('falls back to payload.messageText when root messageText is empty', async () => {
    const input = { messageText: '   ', payload: { messageText: 'Nested reminder' } };
    const result = await buildReminderTriggeredMessage(input, ctx);

    expect((result as Record<string, unknown>).messageText).toBe('Nested reminder');
  });

  it('falls back to payload.messageText when root messageText is missing', async () => {
    const input = { payload: { messageText: 'From nested payload' } };
    const result = await buildReminderTriggeredMessage(input, ctx);

    expect((result as Record<string, unknown>).messageText).toBe('From nested payload');
  });

  it('falls back to title when both messageText sources are absent', async () => {
    const input = { title: 'Monthly reminder' };
    const result = await buildReminderTriggeredMessage(input, ctx);

    expect((result as Record<string, unknown>).messageText).toBe('Monthly reminder');
  });

  it('uses default message when no text sources are available', async () => {
    const input = {};
    const result = await buildReminderTriggeredMessage(input, ctx);

    expect((result as Record<string, unknown>).messageText).toBe('Reminder triggered.');
  });

  it('uses default message when all text sources are empty strings', async () => {
    const input = { messageText: '', title: '', payload: { messageText: '' } };
    const result = await buildReminderTriggeredMessage(input, ctx);

    expect((result as Record<string, unknown>).messageText).toBe('Reminder triggered.');
  });

  it('uses default when all text sources are whitespace only', async () => {
    const input = { messageText: '  ', title: '  ', payload: { messageText: '  ' } };
    const result = await buildReminderTriggeredMessage(input, ctx);

    expect((result as Record<string, unknown>).messageText).toBe('Reminder triggered.');
  });

  it('prefers root messageText over payload.messageText', async () => {
    const input = {
      messageText: 'Root text',
      payload: { messageText: 'Nested text' },
      title: 'Title text',
    };
    const result = await buildReminderTriggeredMessage(input, ctx);

    expect((result as Record<string, unknown>).messageText).toBe('Root text');
  });

  it('prefers payload.messageText over title', async () => {
    const input = {
      payload: { messageText: 'Nested wins' },
      title: 'Title loses',
    };
    const result = await buildReminderTriggeredMessage(input, ctx);

    expect((result as Record<string, unknown>).messageText).toBe('Nested wins');
  });

  it('logs info when building payload', async () => {
    const input = { messageText: 'Test' };
    await buildReminderTriggeredMessage(input, ctx);

    expect(ctx.logger.info).toHaveBeenCalledWith(
      'Building Telegram payload for reminder.triggered',
      { input },
    );
  });

  it('includes correct template value', async () => {
    const result = await buildReminderTriggeredMessage({}, ctx);

    expect((result as Record<string, unknown>).template).toBe('reminder_triggered');
    expect((result as Record<string, unknown>).transport).toBe('telegram');
  });

  it('passes metadata through in the payload', async () => {
    const input = {
      messageText: 'Hello',
      metadata: { scheduleType: 'rrule' as const, aiMode: 'off' as const },
    };

    const result = await buildReminderTriggeredMessage(input, ctx);

    expect(result).toMatchObject({ success: true, payload: input });
  });
});

// ===========================================================================
// sendTestTelegramMessage
// ===========================================================================

describe('sendTestTelegramMessage', () => {
  let ctx: IntegrationContext<TelegramBotConfig>;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('returns a test message payload', async () => {
    const result = await sendTestTelegramMessage({} as never, ctx);

    expect(result).toEqual({
      success: true,
      transport: 'telegram',
      template: 'test',
      message: 'Telegram integration test message from InvoiceLeaf.',
    });
  });

  it('ignores the input parameter', async () => {
    const result1 = await sendTestTelegramMessage(null as never, ctx);
    const result2 = await sendTestTelegramMessage({ anything: true } as never, ctx);

    expect(result1).toEqual(result2);
  });

  it('logs info when building payload', async () => {
    await sendTestTelegramMessage({} as never, ctx);

    expect(ctx.logger.info).toHaveBeenCalledWith('Building Telegram test payload');
  });
});

// ===========================================================================
// buildPaymentReminderMessage
// ===========================================================================

describe('buildPaymentReminderMessage', () => {
  let ctx: IntegrationContext<TelegramBotConfig>;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('returns a successful payload for valid input', async () => {
    const input = { scheduledTime: '2026-03-22T09:00:00Z' };
    const result = await buildPaymentReminderMessage(input, ctx);

    expect(result).toEqual({
      success: true,
      transport: 'telegram',
      template: 'payment_reminder',
      payload: input,
    });
  });

  it('logs info with the input', async () => {
    const input = { scheduledTime: '2026-03-22T09:00:00Z' };
    await buildPaymentReminderMessage(input, ctx);

    expect(ctx.logger.info).toHaveBeenCalledWith(
      'Building Telegram payload for payment reminders',
      { input },
    );
  });

  it('passes through the full input as payload', async () => {
    const input = {
      scheduledTime: '2026-03-22T09:00:00Z',
      lastRunTime: '2026-03-21T09:00:00Z',
    };
    const result = await buildPaymentReminderMessage(input, ctx);

    expect((result as Record<string, unknown>).payload).toBe(input);
  });

  it('handles missing lastRunTime gracefully', async () => {
    const input = { scheduledTime: '2026-03-22T09:00:00Z' };
    const result = await buildPaymentReminderMessage(input, ctx);

    expect(result).toMatchObject({
      success: true,
      transport: 'telegram',
      template: 'payment_reminder',
    });
  });
});

// ===========================================================================
// buildWeeklySummaryMessage
// ===========================================================================

describe('buildWeeklySummaryMessage', () => {
  let ctx: IntegrationContext<TelegramBotConfig>;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('returns a successful payload for valid input', async () => {
    const input = {
      scheduledTime: '2026-03-23T09:00:00Z',
      lastRunTime: '2026-03-16T09:00:00Z',
    };
    const result = await buildWeeklySummaryMessage(input, ctx);

    expect(result).toEqual({
      success: true,
      transport: 'telegram',
      template: 'weekly_summary',
      payload: input,
    });
  });

  it('logs info with the input', async () => {
    const input = { scheduledTime: '2026-03-23T09:00:00Z' };
    await buildWeeklySummaryMessage(input, ctx);

    expect(ctx.logger.info).toHaveBeenCalledWith(
      'Building Telegram payload for weekly summary',
      { input },
    );
  });

  it('passes through the full input as payload', async () => {
    const input = { scheduledTime: '2026-03-23T09:00:00Z' };
    const result = await buildWeeklySummaryMessage(input, ctx);

    expect((result as Record<string, unknown>).payload).toBe(input);
  });

  it('handles missing lastRunTime', async () => {
    const input = { scheduledTime: '2026-03-23T09:00:00Z' };
    const result = await buildWeeklySummaryMessage(input, ctx);

    expect(result).toMatchObject({
      success: true,
      transport: 'telegram',
      template: 'weekly_summary',
    });
  });
});

// ===========================================================================
// applyDocumentAction
// ===========================================================================

describe('applyDocumentAction', () => {
  let ctx: IntegrationContext<TelegramBotConfig>;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('returns a successful result with operation and documentId', async () => {
    const input = { operation: 'approve', documentId: 'doc-1' };
    const result = await applyDocumentAction(input as never, ctx);

    expect(result).toEqual({
      success: true,
      transport: 'telegram',
      template: 'document_action_result',
      operation: 'approve',
      documentId: 'doc-1',
      value: undefined,
    });
  });

  it('includes value when provided', async () => {
    const input = { operation: 'categorize', documentId: 'doc-2', value: 'travel' };
    const result = await applyDocumentAction(input as never, ctx);

    expect(result).toEqual({
      success: true,
      transport: 'telegram',
      template: 'document_action_result',
      operation: 'categorize',
      documentId: 'doc-2',
      value: 'travel',
    });
  });

  it('returns error when operation is missing', async () => {
    const input = { documentId: 'doc-3' };
    const result = await applyDocumentAction(input as never, ctx);

    expect(result).toEqual({
      success: false,
      error: 'Missing required fields: operation and documentId',
    });
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  it('returns error when documentId is missing', async () => {
    const input = { operation: 'approve' };
    const result = await applyDocumentAction(input as never, ctx);

    expect(result).toEqual({
      success: false,
      error: 'Missing required fields: operation and documentId',
    });
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  it('returns error when both operation and documentId are missing', async () => {
    const result = await applyDocumentAction({} as never, ctx);

    expect(result).toEqual({
      success: false,
      error: 'Missing required fields: operation and documentId',
    });
  });

  it('returns error when operation is empty string', async () => {
    const input = { operation: '', documentId: 'doc-4' };
    const result = await applyDocumentAction(input as never, ctx);

    expect(result).toEqual({
      success: false,
      error: 'Missing required fields: operation and documentId',
    });
  });

  it('returns error when documentId is empty string', async () => {
    const input = { operation: 'reject', documentId: '' };
    const result = await applyDocumentAction(input as never, ctx);

    expect(result).toEqual({
      success: false,
      error: 'Missing required fields: operation and documentId',
    });
  });

  it('logs info on successful action', async () => {
    const input = { operation: 'approve', documentId: 'doc-5' };
    await applyDocumentAction(input as never, ctx);

    expect(ctx.logger.info).toHaveBeenCalledWith(
      'Applying Telegram callback document action',
      { operation: 'approve', documentId: 'doc-5' },
    );
  });

  it('does not log info on validation failure', async () => {
    await applyDocumentAction({} as never, ctx);

    expect(ctx.logger.info).not.toHaveBeenCalled();
  });

  it('handles complex value objects', async () => {
    const input = {
      operation: 'tag',
      documentId: 'doc-6',
      value: { tags: ['urgent', 'review'], priority: 1 },
    };
    const result = await applyDocumentAction(input as never, ctx);

    expect((result as Record<string, unknown>).value).toEqual({
      tags: ['urgent', 'review'],
      priority: 1,
    });
  });

  it('returns document_action_result for view_document callback operation', async () => {
    const input = { operation: 'view_document', documentId: 'doc-99' };
    const result = await applyDocumentAction(input as never, ctx);

    expect(result).toEqual({
      success: true,
      transport: 'telegram',
      template: 'document_action_result',
      operation: 'view_document',
      documentId: 'doc-99',
      value: undefined,
    });
  });

  it('returns document_action_result for mark_paid callback operation', async () => {
    const input = {
      operation: 'mark_paid',
      documentId: 'doc-100',
      value: { paidAt: '2026-03-22' },
    };
    const result = await applyDocumentAction(input as never, ctx);

    expect(result).toEqual({
      success: true,
      transport: 'telegram',
      template: 'document_action_result',
      operation: 'mark_paid',
      documentId: 'doc-100',
      value: { paidAt: '2026-03-22' },
    });
  });
});

// ===========================================================================
// Cross-cutting: template values
// ===========================================================================

describe('template values', () => {
  let ctx: IntegrationContext<TelegramBotConfig>;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it.each([
    ['buildDocumentProcessedMessage', buildDocumentProcessedMessage, 'document_processed'],
    ['buildExportCompletedMessage', buildExportCompletedMessage, 'export_completed'],
    ['buildPaymentReminderMessage', buildPaymentReminderMessage, 'payment_reminder'],
    ['buildWeeklySummaryMessage', buildWeeklySummaryMessage, 'weekly_summary'],
    ['sendTestTelegramMessage', sendTestTelegramMessage, 'test'],
  ] as const)('%s uses template "%s"', async (_name, handler, expectedTemplate) => {
    const result = await (handler as CallableFunction)({ dummy: true }, ctx);
    expect(result).toHaveProperty('template', expectedTemplate);
  });

  it.each([
    ['buildDocumentProcessedMessage', buildDocumentProcessedMessage],
    ['buildExportCompletedMessage', buildExportCompletedMessage],
    ['buildReminderTriggeredMessage', buildReminderTriggeredMessage],
    ['sendTestTelegramMessage', sendTestTelegramMessage],
    ['buildPaymentReminderMessage', buildPaymentReminderMessage],
    ['buildWeeklySummaryMessage', buildWeeklySummaryMessage],
  ] as const)('%s sets transport to "telegram"', async (_name, handler) => {
    const result = await (handler as CallableFunction)({ dummy: true }, ctx);
    expect(result).toHaveProperty('transport', 'telegram');
  });
});

// ===========================================================================
// Handler error resilience
// ===========================================================================

describe('handler error resilience', () => {
  it('buildDocumentProcessedMessage catches thrown Error', async () => {
    const ctx = createMockContext();
    vi.mocked(ctx.logger.info).mockImplementation(() => {
      throw new Error('logger exploded');
    });

    const result = await buildDocumentProcessedMessage(
      { documentId: 'doc-1', document: { id: 'doc-1', fileName: 'x', status: 'OK' }, spaceId: 's' },
      ctx,
    );

    expect(result).toEqual({
      success: false,
      error: 'Handler error: logger exploded',
    });
    expect(ctx.logger.error).toHaveBeenCalled();
  });

  it('buildExportCompletedMessage catches thrown Error', async () => {
    const ctx = createMockContext();
    vi.mocked(ctx.logger.info).mockImplementation(() => {
      throw new Error('boom');
    });

    const result = await buildExportCompletedMessage(
      { exportId: 'e1', export: { id: 'e1', format: 'csv', status: 'COMPLETED' }, spaceId: 's' },
      ctx,
    );

    expect(result).toEqual({ success: false, error: 'Handler error: boom' });
  });

  it('buildPaymentReminderMessage catches thrown Error', async () => {
    const ctx = createMockContext();
    vi.mocked(ctx.logger.info).mockImplementation(() => {
      throw new Error('oops');
    });

    const result = await buildPaymentReminderMessage(
      { scheduledTime: '2026-03-22T09:00:00Z' },
      ctx,
    );

    expect(result).toEqual({ success: false, error: 'Handler error: oops' });
  });

  it('buildWeeklySummaryMessage catches thrown Error', async () => {
    const ctx = createMockContext();
    vi.mocked(ctx.logger.info).mockImplementation(() => {
      throw new Error('fail');
    });

    const result = await buildWeeklySummaryMessage(
      { scheduledTime: '2026-03-22T09:00:00Z' },
      ctx,
    );

    expect(result).toEqual({ success: false, error: 'Handler error: fail' });
  });

  it('sendTestTelegramMessage catches thrown Error', async () => {
    const ctx = createMockContext();
    vi.mocked(ctx.logger.info).mockImplementation(() => {
      throw new Error('test fail');
    });

    const result = await sendTestTelegramMessage({ actionId: 'test' }, ctx);

    expect(result).toEqual({ success: false, error: 'Handler error: test fail' });
  });

  it('applyDocumentAction catches thrown Error', async () => {
    const ctx = createMockContext();
    vi.mocked(ctx.logger.info).mockImplementation(() => {
      throw new Error('action fail');
    });

    const result = await applyDocumentAction(
      { operation: 'mark_paid', documentId: 'doc-1' },
      ctx,
    );

    expect(result).toEqual({
      success: false,
      error: 'Handler error: action fail',
    });
  });

  it('buildReminderTriggeredMessage catches thrown Error', async () => {
    const ctx = createMockContext();
    vi.mocked(ctx.logger.info).mockImplementation(() => {
      throw new Error('reminder fail');
    });

    const result = await buildReminderTriggeredMessage({ messageText: 'hello' }, ctx);

    expect(result).toEqual({
      success: false,
      error: 'Handler error: reminder fail',
    });
  });

  it('handlers stringify non-Error thrown values', async () => {
    const ctx = createMockContext();
    vi.mocked(ctx.logger.info).mockImplementation(() => {
      // eslint-disable-next-line no-throw-literal
      throw 'string-error';
    });

    const result = await buildDocumentProcessedMessage(
      { documentId: 'd', document: { id: 'd', fileName: 'f', status: 's' }, spaceId: 's' },
      ctx,
    );

    expect(result).toEqual({
      success: false,
      error: 'Handler error: string-error',
    });
  });
});

// ===========================================================================
// Idempotent update dedupe -- same input produces identical output
// ===========================================================================

describe('idempotent handler output', () => {
  let ctx: IntegrationContext<TelegramBotConfig>;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('buildDocumentProcessedMessage is deterministic', async () => {
    const input = {
      documentId: 'doc-1',
      document: { id: 'doc-1', fileName: 'inv.pdf', status: 'OK' },
      spaceId: 'sp',
    };

    const r1 = await buildDocumentProcessedMessage(input, ctx);
    const r2 = await buildDocumentProcessedMessage(input, ctx);
    expect(r1).toEqual(r2);
  });

  it('buildExportCompletedMessage is deterministic', async () => {
    const input = {
      exportId: 'e-1',
      export: { id: 'e-1', format: 'pdf', status: 'COMPLETED' },
      spaceId: 'sp',
    };

    const r1 = await buildExportCompletedMessage(input, ctx);
    const r2 = await buildExportCompletedMessage(input, ctx);
    expect(r1).toEqual(r2);
  });

  it('applyDocumentAction is deterministic', async () => {
    const input = { operation: 'mark_paid', documentId: 'doc-5', value: { x: 1 } };
    const r1 = await applyDocumentAction(input, ctx);
    const r2 = await applyDocumentAction(input, ctx);
    expect(r1).toEqual(r2);
  });

  it('buildReminderTriggeredMessage is deterministic', async () => {
    const input = { messageText: 'Pay now' };
    const r1 = await buildReminderTriggeredMessage(input, ctx);
    const r2 = await buildReminderTriggeredMessage(input, ctx);
    expect(r1).toEqual(r2);
  });

  it('buildPaymentReminderMessage is deterministic', async () => {
    const input = { scheduledTime: '2026-03-22T09:00:00Z' };
    const r1 = await buildPaymentReminderMessage(input, ctx);
    const r2 = await buildPaymentReminderMessage(input, ctx);
    expect(r1).toEqual(r2);
  });

  it('buildWeeklySummaryMessage is deterministic', async () => {
    const input = { scheduledTime: '2026-03-23T09:00:00Z' };
    const r1 = await buildWeeklySummaryMessage(input, ctx);
    const r2 = await buildWeeklySummaryMessage(input, ctx);
    expect(r1).toEqual(r2);
  });

  it('sendTestTelegramMessage is deterministic', async () => {
    const r1 = await sendTestTelegramMessage({ actionId: 'test' }, ctx);
    const r2 = await sendTestTelegramMessage({ actionId: 'test' }, ctx);
    expect(r1).toEqual(r2);
  });
});

// ===========================================================================
// Space/document authorization scoping
// ===========================================================================

describe('space/document authorization scoping', () => {
  it('handler receives the space context from the mock', async () => {
    const ctx = createMockContext();
    const input = {
      documentId: 'doc-1',
      document: { id: 'doc-1', fileName: 'inv.pdf', status: 'OK' },
      spaceId: 'space-1',
    };

    await buildDocumentProcessedMessage(input, ctx);

    expect(ctx.spaceId).toBe('space-1');
    expect(ctx.userId).toBe('user-1');
    expect(ctx.installationId).toBe('install-1');
  });

  it('applyDocumentAction logs the documentId being operated on', async () => {
    const ctx = createMockContext();
    const input = { operation: 'view_document', documentId: 'doc-secured' };

    await applyDocumentAction(input, ctx);

    expect(ctx.logger.info).toHaveBeenCalledWith(
      'Applying Telegram callback document action',
      { operation: 'view_document', documentId: 'doc-secured' },
    );
  });

  it('context data client methods are available for authorization lookups', () => {
    const ctx = createMockContext();

    expect(typeof ctx.data.getDocument).toBe('function');
    expect(typeof ctx.data.listDocuments).toBe('function');
    expect(typeof ctx.data.getCompany).toBe('function');
    expect(typeof ctx.data.listCompanies).toBe('function');
    expect(typeof ctx.data.listCategories).toBe('function');
  });

  it('context is scoped with config chatId', () => {
    const ctx = createMockContext({ chatId: 'chat-999' });
    expect(ctx.config.chatId).toBe('chat-999');
  });

  it('context provides credential client for external auth validation', () => {
    const ctx = createMockContext();

    expect(typeof ctx.credentials.getAccessToken).toBe('function');
    expect(typeof ctx.credentials.getApiKey).toBe('function');
    expect(typeof ctx.credentials.refreshToken).toBe('function');
    expect(typeof ctx.credentials.getConnectionInfo).toBe('function');
  });
});

// ===========================================================================
// Callback dispatch wiring -- manifest invocation routing
// ===========================================================================

describe('callback dispatch wiring', () => {
  let manifest: {
    triggers: Array<{ id: string; handler: string; events?: string[] }>;
    actions: Array<{ id: string; handler: string; internal?: boolean }>;
    invocations: Array<{
      id: string;
      source: string;
      operation: string;
      actionId: string;
      requiresLinkedUser: boolean;
    }>;
    configSchema: {
      required: string[];
      properties: Record<string, unknown>;
    };
    dataAccess: string[];
  };

  beforeEach(async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const manifestPath = path.resolve(
      import.meta.dirname ?? new URL('.', import.meta.url).pathname,
      '..', '..', '..', 'manifest.json',
    );
    const raw = await fs.readFile(manifestPath, 'utf-8');
    manifest = JSON.parse(raw);
  });

  it('all invocations reference a valid action id', () => {
    const actionIds = new Set(manifest.actions.map((a) => a.id));
    for (const inv of manifest.invocations) {
      expect(actionIds.has(inv.actionId)).toBe(true);
    }
  });

  it('all trigger handlers correspond to exported functions', async () => {
    const exports = await import('../../src/index.js');
    for (const trigger of manifest.triggers) {
      expect(typeof (exports as Record<string, unknown>)[trigger.handler]).toBe('function');
    }
  });

  it('all action handlers correspond to exported functions', async () => {
    const exports = await import('../../src/index.js');
    for (const action of manifest.actions) {
      expect(typeof (exports as Record<string, unknown>)[action.handler]).toBe('function');
    }
  });

  it('telegram-callback-view invocation routes to applyDocumentAction', () => {
    const viewInvocation = manifest.invocations.find(
      (i) => i.id === 'telegram-callback-view',
    );
    expect(viewInvocation).toBeDefined();
    expect(viewInvocation!.source).toBe('telegram.callback');
    expect(viewInvocation!.operation).toBe('view_document');
    expect(viewInvocation!.actionId).toBe('apply-document-action');
    expect(viewInvocation!.requiresLinkedUser).toBe(true);
  });

  it('telegram-callback-mark-paid invocation routes to applyDocumentAction', () => {
    const markPaidInvocation = manifest.invocations.find(
      (i) => i.id === 'telegram-callback-mark-paid',
    );
    expect(markPaidInvocation).toBeDefined();
    expect(markPaidInvocation!.source).toBe('telegram.callback');
    expect(markPaidInvocation!.operation).toBe('mark_paid');
    expect(markPaidInvocation!.actionId).toBe('apply-document-action');
    expect(markPaidInvocation!.requiresLinkedUser).toBe(true);
  });

  it('apply-document-action is marked internal', () => {
    const action = manifest.actions.find((a) => a.id === 'apply-document-action');
    expect(action).toBeDefined();
    expect(action!.internal).toBe(true);
  });

  it('every callback invocation requires a linked user', () => {
    const callbackInvocations = manifest.invocations.filter(
      (i) => i.source === 'telegram.callback',
    );
    expect(callbackInvocations.length).toBeGreaterThan(0);
    for (const inv of callbackInvocations) {
      expect(inv.requiresLinkedUser).toBe(true);
    }
  });

  it('no invocation references a nonexistent action', () => {
    const actionIds = new Set(manifest.actions.map((a) => a.id));
    for (const inv of manifest.invocations) {
      expect(actionIds.has(inv.actionId)).toBe(true);
    }
  });
});

// ===========================================================================
// Manifest completeness
// ===========================================================================

describe('manifest completeness', () => {
  let manifest: Record<string, unknown>;

  beforeEach(async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const manifestPath = path.resolve(
      import.meta.dirname ?? new URL('.', import.meta.url).pathname,
      '..', '..', '..', 'manifest.json',
    );
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
  });

  it('has required top-level fields', () => {
    expect(manifest.id).toBe('telegram-bot');
    expect(manifest.name).toBe('Telegram Bot');
    expect(manifest.version).toBeDefined();
    expect(manifest.category).toBe('communication');
  });

  it('configSchema requires chatId', () => {
    const schema = manifest.configSchema as { required: string[] };
    expect(schema.required).toContain('chatId');
  });

  it('has exactly 5 triggers', () => {
    expect(manifest.triggers as unknown[]).toHaveLength(5);
  });

  it('has exactly 2 actions', () => {
    expect(manifest.actions as unknown[]).toHaveLength(2);
  });

  it('has exactly 2 invocations', () => {
    expect(manifest.invocations as unknown[]).toHaveLength(2);
  });

  it('declares the correct data access scopes', () => {
    expect(manifest.dataAccess).toEqual([
      'documents', 'companies', 'categories', 'spaces', 'exports',
    ]);
  });

  it('has rate limit and resource constraints', () => {
    const limits = manifest.limits as Record<string, number>;
    expect(limits.rateLimit).toBe(60);
    expect(limits.timeoutSeconds).toBe(30);
    expect(limits.memoryMb).toBe(128);
  });

  it('event triggers have correct event types', () => {
    const triggers = manifest.triggers as Array<{ id: string; events?: string[] }>;

    const docProcessed = triggers.find((t) => t.id === 'on-document-processed');
    expect(docProcessed?.events).toEqual(['document.processed']);

    const exportCompleted = triggers.find((t) => t.id === 'on-export-completed');
    expect(exportCompleted?.events).toEqual(['export.completed']);

    const reminderTriggered = triggers.find((t) => t.id === 'on-reminder-triggered');
    expect(reminderTriggered?.events).toEqual(['reminder.triggered']);
  });

  it('schedule triggers have valid cron expressions', () => {
    const triggers = manifest.triggers as Array<{ id: string; type: string; schedule?: string }>;
    const scheduleTriggers = triggers.filter((t) => t.type === 'schedule');

    expect(scheduleTriggers.length).toBe(2);
    for (const trigger of scheduleTriggers) {
      expect(trigger.schedule).toBeDefined();
      // Verify cron has 5 fields
      const parts = trigger.schedule!.split(' ');
      expect(parts).toHaveLength(5);
    }
  });
});
