import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type {
  InboundSyncResult,
  SevdeskInboundSyncState,
  SevdeskIntegrationConfig,
  SyncFailure,
} from '../types.js';
import type { SevdeskInvoice } from '../sevdesk/client.js';
import { SevdeskApiError, SevdeskClient } from '../sevdesk/client.js';
import { resolveSevdeskApiKey } from './auth.js';
import { ENTITY_INVOICE, SYSTEM } from './syncInvoices.js';

const INBOUND_SYNC_STATE_KEY = 'sevdesk:lastInboundSyncAt';
const DEFAULT_INBOUND_LOOKBACK_HOURS = 24;
const DEFAULT_INBOUND_PAGE_SIZE = 50;
const DEFAULT_INBOUND_MAX_INVOICES_PER_RUN = 100;
const MAX_REPORTED_FAILURES = 25;

export const pullInvoicesFromSevdesk: IntegrationHandler<
  unknown,
  InboundSyncResult,
  SevdeskIntegrationConfig
> = async (
  _input,
  context: IntegrationContext<SevdeskIntegrationConfig>
): Promise<InboundSyncResult> => {
  const startedAt = new Date().toISOString();
  const failures: SyncFailure[] = [];
  const resultBase: Omit<
    InboundSyncResult,
    'success' | 'message' | 'error' | 'checkpointUpdated'
  > = {
    startedAt,
    completedAt: startedAt,
    fromDate: startedAt,
    processed: 0,
    imported: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    failures,
  };

  if (context.config.enableInboundSync === false) {
    return {
      ...resultBase,
      completedAt: new Date().toISOString(),
      success: true,
      checkpointUpdated: false,
      message: 'Inbound sevDesk sync is disabled in config.',
    };
  }

  const lookbackHours = toBoundedInt(
    context.config.inboundInitialSyncLookbackHours,
    DEFAULT_INBOUND_LOOKBACK_HOURS,
    1,
    24 * 30
  );
  const pageSize = toBoundedInt(
    context.config.inboundPageSize,
    DEFAULT_INBOUND_PAGE_SIZE,
    1,
    200
  );
  const maxInvoicesPerRun = toBoundedInt(
    context.config.inboundMaxInvoicesPerRun,
    DEFAULT_INBOUND_MAX_INVOICES_PER_RUN,
    1,
    1000
  );

  const fallbackFromDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

  try {
    let fromDate = fallbackFromDate;
    try {
      const inboundState = await context.state.get<SevdeskInboundSyncState>(INBOUND_SYNC_STATE_KEY);
      fromDate = inboundState?.lastInboundSyncAt ?? fallbackFromDate;
    } catch (stateError) {
      context.logger.warn('Could not read sevDesk inbound checkpoint. Using fallback lookback window.', {
        key: INBOUND_SYNC_STATE_KEY,
        error: toErrorMessage(stateError),
      });
    }
    resultBase.fromDate = fromDate;

    const apiKey = await resolveSevdeskApiKey(context);
    const client = new SevdeskClient(apiKey, context.config.baseUrl);

    let offset = 0;
    let hasMore = true;
    const updateAfterUnix = Math.floor(new Date(fromDate).getTime() / 1000);

    while (hasMore && resultBase.processed < maxInvoicesPerRun) {
      const invoices = await client.listInvoices({
        limit: Math.min(pageSize, maxInvoicesPerRun - resultBase.processed),
        offset,
        updateAfter: Number.isFinite(updateAfterUnix) ? updateAfterUnix : undefined,
      });

      if (invoices.length === 0) {
        hasMore = false;
        continue;
      }

      for (const invoice of invoices) {
        if (resultBase.processed >= maxInvoicesPerRun) {
          break;
        }
        resultBase.processed += 1;

        const invoiceId = trimToUndefined(invoice.id);
        if (!invoiceId) {
          resultBase.skipped += 1;
          continue;
        }

        const updateIso = trimToUndefined(invoice.update) ?? trimToUndefined(invoice.create);
        if (updateIso) {
          const updateMs = Date.parse(updateIso);
          const fromMs = Date.parse(fromDate);
          if (Number.isFinite(updateMs) && Number.isFinite(fromMs) && updateMs <= fromMs) {
            resultBase.skipped += 1;
            continue;
          }
        }

        try {
          const result = await importOrUpdateInvoice(context, client, invoice);
          if (result === 'imported') {
            resultBase.imported += 1;
          } else if (result === 'updated') {
            resultBase.updated += 1;
          } else {
            resultBase.skipped += 1;
          }
        } catch (error) {
          resultBase.failed += 1;
          const message = toErrorMessage(error);
          if (failures.length < MAX_REPORTED_FAILURES) {
            failures.push({
              documentId: invoiceId,
              error: message,
            });
          }
          context.logger.error('Failed to pull sevDesk invoice', {
            invoiceId,
            error: message,
          });
        }
      }

      hasMore = invoices.length >= pageSize;
      offset += invoices.length;
    }

    const completedAt = new Date().toISOString();
    let checkpointUpdated = false;
    if (resultBase.failed === 0) {
      try {
        await context.state.set<SevdeskInboundSyncState>(INBOUND_SYNC_STATE_KEY, {
          lastInboundSyncAt: completedAt,
        });
        checkpointUpdated = true;
      } catch (stateError) {
        context.logger.warn('Could not persist sevDesk inbound checkpoint.', {
          key: INBOUND_SYNC_STATE_KEY,
          error: toErrorMessage(stateError),
        });
      }
    }

    return {
      ...resultBase,
      completedAt,
      success: resultBase.failed === 0,
      checkpointUpdated,
      message:
        resultBase.failed === 0
          ? `Pulled ${resultBase.imported} new sevDesk invoice(s) into InvoiceLeaf.`
          : `Pulled sevDesk invoices with ${resultBase.failed} failure(s).`,
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = toErrorMessage(error);
    context.logger.error('sevDesk inbound sync failed', { error: message });
    return {
      ...resultBase,
      completedAt,
      success: false,
      error: message,
      checkpointUpdated: false,
    };
  }
};

async function importOrUpdateInvoice(
  context: IntegrationContext<SevdeskIntegrationConfig>,
  client: SevdeskClient,
  invoice: SevdeskInvoice
): Promise<'imported' | 'updated' | 'skipped'> {
  const invoiceId = invoice.id;
  const existing = await context.mappings.findByExternal({
    system: SYSTEM,
    entity: ENTITY_INVOICE,
    externalId: invoiceId,
  });

  const status = normalizeInvoiceStatus(invoice.status);
  if (existing?.localId) {
    await context.data.patchDocumentIntegrationMeta({
      documentId: existing.localId,
      system: SYSTEM,
      externalId: invoiceId,
      status: status === '1000' ? 'deleted' : 'synced',
      lastSyncedAt: new Date().toISOString(),
      metadata: {
        sevdeskInvoiceId: invoiceId,
        invoiceNumber: trimToUndefined(invoice.invoiceNumber) ?? null,
        sevdeskStatus: status ?? null,
        sevdeskUpdatedAt: trimToUndefined(invoice.update) ?? null,
      },
    });

    await context.mappings.upsert({
      system: SYSTEM,
      entity: ENTITY_INVOICE,
      localId: existing.localId,
      externalId: invoiceId,
      metadata: {
        ...(existing.metadata ?? {}),
        direction: 'inbound',
        invoiceNumber: trimToUndefined(invoice.invoiceNumber) ?? null,
        status: status ?? null,
        updatedAt: trimToUndefined(invoice.update) ?? null,
      },
    });
    return 'updated';
  }

  if (status === '1000') {
    return 'skipped';
  }

  const pdf = await client.getInvoicePdf(invoiceId);
  const contentBase64 = toBase64Content(pdf.content, pdf.base64encoded ?? true);
  if (!contentBase64) {
    throw new Error(`sevDesk invoice ${invoiceId} did not return a PDF content payload.`);
  }

  const fileName =
    trimToUndefined(pdf.filename) ??
    `${trimToUndefined(invoice.invoiceNumber) ?? `sevdesk-${invoiceId}`}.pdf`;
  const mimeType = trimToUndefined(pdf.mimeType) ?? 'application/pdf';

  const importResult = await context.data.importDocument({
    fileName,
    contentType: mimeType,
    contentBase64,
    source: 'sevdesk',
    description: `Imported from sevDesk invoice ${trimToUndefined(invoice.invoiceNumber) ?? invoiceId}`,
    externalRef: `sevdesk:invoice:${invoiceId}`,
    metadata: {
      sevdeskInvoiceId: invoiceId,
      invoiceNumber: trimToUndefined(invoice.invoiceNumber) ?? null,
      sevdeskStatus: status ?? null,
      sevdeskUpdatedAt: trimToUndefined(invoice.update) ?? null,
      importedBy: 'integration-sevdesk',
    },
  });

  await context.mappings.upsert({
    system: SYSTEM,
    entity: ENTITY_INVOICE,
    localId: importResult.documentId,
    externalId: invoiceId,
    metadata: {
      direction: 'inbound',
      invoiceNumber: trimToUndefined(invoice.invoiceNumber) ?? null,
      status: status ?? null,
      duplicate: importResult.duplicate,
    },
  });

  await context.data.patchDocumentIntegrationMeta({
    documentId: importResult.documentId,
    system: SYSTEM,
    externalId: invoiceId,
    status: 'synced',
    lastSyncedAt: new Date().toISOString(),
    metadata: {
      sevdeskInvoiceId: invoiceId,
      invoiceNumber: trimToUndefined(invoice.invoiceNumber) ?? null,
      sevdeskStatus: status ?? null,
      direction: 'inbound',
      duplicate: importResult.duplicate,
    },
  });
  return 'imported';
}

function toBase64Content(content: string | undefined, alreadyBase64: boolean): string | undefined {
  const value = trimToUndefined(content);
  if (!value) {
    return undefined;
  }
  if (alreadyBase64) {
    return value;
  }
  return Buffer.from(value, 'binary').toString('base64');
}

function normalizeInvoiceStatus(status: string | number | undefined): string | undefined {
  if (typeof status === 'string') {
    const trimmed = status.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof status === 'number' && Number.isFinite(status)) {
    return String(Math.trunc(status));
  }
  return undefined;
}

function toBoundedInt(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.floor(value as number);
  if (rounded < min) {
    return min;
  }
  if (rounded > max) {
    return max;
  }
  return rounded;
}

function trimToUndefined(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof SevdeskApiError) {
    const body = error.responseBody ? ` ${error.responseBody}` : '';
    return `sevDesk API ${error.status}:${body}`.trim();
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
