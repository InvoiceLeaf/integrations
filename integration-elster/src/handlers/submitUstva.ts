import type { IntegrationHandler } from '@invoiceleaf/integration-sdk';
import { toErrorMessage, trimToUndefined } from '@invoiceleaf/integration-sdk';
import type {
  ElsterIntegrationConfig,
  FilingStatusEntry,
  SubmitUstvaInput,
  SubmitUstvaResult,
} from '../types.js';
import {
  buildUstvaXml,
  certHandle,
  computeUstvaKennzahlen,
  getFilingClient,
  listDocumentsInWindow,
  parsePeriod,
} from './shared.js';
import { FILING_INDEX_KEY, filingStateKey } from './filingStatus.js';

/**
 * Submit the USt-VA to the Finanzamt via ERiC. IRREVERSIBLE.
 *
 * This handler is `internal: true` in the manifest, so it is blocked from the AI
 * ChatService. It is only invoked by an explicit, human-confirmed UI action that
 * supplies a one-time `confirmToken`.
 *
 * Flow: rebuild XML -> validate -> submit via the verified-only filing capability
 * -> record the filing in installation state for {@link filingStatus}.
 */
export const submitUstva: IntegrationHandler<
  SubmitUstvaInput,
  SubmitUstvaResult,
  ElsterIntegrationConfig
> = async (input, context): Promise<SubmitUstvaResult> => {
  const period = parsePeriod(input.period);
  const testMode = input.testMode ?? true;

  // Human-confirmation gate. The actual single-use validation of the token is
  // enforced host-side; here we only ensure one was supplied.
  // TODO(confirm): verify/consume `confirmToken` host-side (it must be minted by
  //   the UI confirmation step and single-use) before honoring the submission.
  if (!trimToUndefined(input.confirmToken)) {
    return {
      success: false,
      period: period.canonical,
      testMode,
      error: 'A confirmation token is required to submit. No submission was made.',
    };
  }

  try {
    const documents = await listDocumentsInWindow(context, period.startMs, period.endMs);
    const { kennzahlen } = computeUstvaKennzahlen(documents);

    // TODO(xml): buildUstvaXml emits a placeholder document — NOT submittable until
    //   a schema-valid builder lands. Submission against the real Finanzamt must
    //   not be enabled before then.
    const xml = buildUstvaXml({
      period: period.canonical,
      steuernummer: context.config.steuernummer,
      finanzamt: context.config.finanzamt,
      kennzahlen,
    });

    const filing = getFilingClient(context);

    const validation = await filing.validate({ xml, formType: 'ustva', period: period.canonical });
    if (!validation.ok) {
      return {
        success: false,
        period: period.canonical,
        testMode,
        error: `Validation failed with ${validation.errors.length} issue(s); submission aborted.`,
      };
    }

    const result = await filing.submit({
      xml,
      formType: 'ustva',
      period: period.canonical,
      certHandle: certHandle(context),
      testMode,
    });

    await recordFiling(context, {
      formType: 'ustva',
      period: period.canonical,
      state: testMode ? 'SUBMITTED_TEST' : 'SUBMITTED',
      mode: testMode ? 'test' : 'production',
      transferTicket: result.transferTicket,
      submittedAt: new Date().toISOString(),
    });

    return {
      success: true,
      period: period.canonical,
      testMode,
      transferTicket: result.transferTicket,
      receiptRef: result.receiptRef,
      serverResponse: result.serverResponse,
      message: testMode
        ? `USt-VA submitted in TEST mode. Transfer ticket: ${result.transferTicket}.`
        : `USt-VA submitted to the Finanzamt. Transfer ticket: ${result.transferTicket}.`,
    };
  } catch (error) {
    context.logger.error('USt-VA submission failed', {
      period: period.canonical,
      error: toErrorMessage(error),
    });
    return {
      success: false,
      period: period.canonical,
      testMode,
      error: toErrorMessage(error),
    };
  }
};

/**
 * Persist a filing record into installation state and maintain the index list.
 *
 * TODO(taxfiling): replace state-backed history with the Layer 2 `TaxFiling`
 *   entity once the host-side filing endpoints exist.
 */
async function recordFiling(
  context: IntegrationHandlerContext,
  entry: FilingStatusEntry
): Promise<void> {
  const key = filingStateKey(entry.formType, entry.period);
  try {
    await context.state.set<FilingStatusEntry>(key, entry);
    const index = (await context.state.get<string[]>(FILING_INDEX_KEY)) ?? [];
    if (!index.includes(key)) {
      index.push(key);
      await context.state.set<string[]>(FILING_INDEX_KEY, index);
    }
  } catch (stateError) {
    context.logger.warn('Could not persist filing record to state', {
      key,
      error: toErrorMessage(stateError),
    });
  }
}

/** Local alias for the state/logger surface used by {@link recordFiling}. */
type IntegrationHandlerContext = Parameters<typeof submitUstva>[1];
