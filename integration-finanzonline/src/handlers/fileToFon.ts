import type { FiledResult, FinanzOnlineConfig, FonContext } from '../types';
import { buildU30Xml, buildZmXml, getFonCredentials, parsePeriod, submitToFon } from './shared';

interface FileToFonOptions {
  /** BMF "art" of the declaration: U30 for the UVA, U13 for the ZM. */
  art: 'U30' | 'U13';
  /** Form type as the host knows it, used for the double-filing guard. */
  formType: 'u30' | 'zm';
  /** Human label for messages. */
  label: string;
  period: string;
  confirmToken: string;
  figuresHash?: string;
}

/**
 * Files a declaration with FinanzOnline for real, wrapped in the host filing bridge.
 *
 * The order matters and is the whole point of the two-step bridge:
 *
 * 1. `beginExternal` runs first. The host verifies that this period was approved for
 *    these figures and has not been filed already, then opens the audit record. If it
 *    rejects, nothing is transmitted.
 * 2. The transmission runs here, in the sandbox, because the SOAP client is bundled
 *    with this plugin.
 * 3. `completeExternal` records the outcome, success or failure, so an accepted send is
 *    never left without a receipt on file.
 */
export async function fileToFon(
  context: FonContext,
  options: FileToFonOptions
): Promise<FiledResult> {
  const period = parsePeriod(options.period);

  if (!context.filing) {
    return {
      success: false,
      period: period.canonical,
      mode: 'production',
      error: 'Filing is not enabled for this integration.',
    };
  }
  if (!options.confirmToken) {
    return {
      success: false,
      period: period.canonical,
      mode: 'production',
      error: 'Filing requires an approval. Approve the figures before filing.',
    };
  }

  // Build before opening the filing: a build failure should not leave an orphaned record.
  const xml =
    options.art === 'U30'
      ? await buildU30Xml(context, period)
      : await buildZmXml(context, period);
  const creds = await getFonCredentials(context);

  const opened = await context.filing.beginExternal({
    formType: options.formType,
    period: period.canonical,
    testMode: false,
    confirmToken: options.confirmToken,
    figuresHash: options.figuresHash,
  });

  let result;
  try {
    result = await submitToFon(creds, options.art, xml, true);
  } catch (error) {
    // The transmission threw, so we do not know whether it landed. Record the failure and
    // let a human decide; the host's double-filing guard stops a blind retry.
    const message = error instanceof Error ? error.message : String(error);
    await context.filing.completeExternal({
      filingId: opened.filingId,
      success: false,
      errors: [message],
      serverResponse: message,
    });
    throw error;
  }

  const errors = (result.errors ?? []).map((e) => `${e.code}: ${e.text}`);
  await context.filing.completeExternal({
    filingId: opened.filingId,
    success: result.success,
    transferTicket: result.messageRefId,
    errors,
    serverResponse: result.message,
  });

  if (!result.success) {
    context.logger.warn(`${options.label} submission not accepted`, {
      rc: result.rc,
      status: result.status,
    });
    return {
      success: false,
      period: period.canonical,
      mode: 'production',
      filingId: opened.filingId,
      errors,
      message: result.message,
      error: errors.length > 0 ? errors.join('; ') : result.message,
    };
  }

  return {
    success: true,
    period: period.canonical,
    mode: 'production',
    filingId: opened.filingId,
    messageRefId: result.messageRefId,
    message: `${options.label} for ${period.canonical} was filed with FinanzOnline.`,
  };
}

/** Re-exported so handler modules can annotate their config generic. */
export type { FinanzOnlineConfig };
