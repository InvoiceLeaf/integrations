/**
 * Slack Webhook Client
 *
 * Handles sending messages to Slack via Incoming Webhooks.
 */

import type { SlackMessage } from '../types.js';

/**
 * Error thrown when Slack API request fails.
 */
export class SlackApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody: string
  ) {
    super(message);
    this.name = 'SlackApiError';
  }
}

/**
 * Error thrown when webhook URL is invalid.
 */
export class SlackWebhookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlackWebhookValidationError';
  }
}

/**
 * Options for the Slack client.
 */
export interface SlackClientOptions {
  /** Request timeout in milliseconds (default: 10000) */
  timeout?: number;

  /** Number of retries for transient errors (default: 2) */
  retries?: number;

  /** Base delay between retries in milliseconds (default: 1000) */
  retryDelay?: number;
}

const DEFAULT_OPTIONS: Required<SlackClientOptions> = {
  timeout: 10000,
  retries: 2,
  retryDelay: 1000,
};

/**
 * Slack Incoming Webhook client.
 *
 * @example
 * ```typescript
 * const client = new SlackClient('https://hooks.slack.com/services/...');
 * await client.sendMessage({
 *   text: 'Hello from InvoiceLeaf!',
 *   blocks: [...]
 * });
 * ```
 */
export class SlackClient {
  private readonly webhookUrl: string;
  private readonly options: Required<SlackClientOptions>;

  constructor(webhookUrl: string, options: SlackClientOptions = {}) {
    this.validateWebhookUrl(webhookUrl);
    this.webhookUrl = webhookUrl;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Validates the webhook URL format.
   */
  private validateWebhookUrl(url: string): void {
    if (!url) {
      throw new SlackWebhookValidationError('Webhook URL is required');
    }

    // Slack webhook URLs follow this pattern
    const webhookPattern = /^https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[a-zA-Z0-9]+$/;

    if (!webhookPattern.test(url)) {
      throw new SlackWebhookValidationError(
        'Invalid Slack webhook URL format. Expected: https://hooks.slack.com/services/T.../B.../...'
      );
    }
  }

  /**
   * Sends a message to Slack.
   *
   * @param message - The message payload
   * @throws {SlackApiError} When Slack returns an error response
   */
  async sendMessage(message: SlackMessage): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.options.retries; attempt++) {
      try {
        await this.doSendMessage(message);
        return;
      } catch (error) {
        lastError = error as Error;

        // Don't retry on validation errors or client errors (4xx except 429)
        if (error instanceof SlackApiError) {
          if (error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429) {
            throw error;
          }
        }

        // Wait before retry (with exponential backoff)
        if (attempt < this.options.retries) {
          const delay = this.options.retryDelay * Math.pow(2, attempt);
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Performs the actual HTTP request to Slack.
   */
  private async doSendMessage(message: SlackMessage): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
        signal: controller.signal,
      });

      const responseText = await response.text();

      if (!response.ok) {
        throw new SlackApiError(
          `Slack API error: ${response.status} ${response.statusText}`,
          response.status,
          responseText
        );
      }

      // Slack webhooks return "ok" as plain text on success
      if (responseText !== 'ok') {
        // Some errors come back as 200 with error text
        throw new SlackApiError(
          `Slack API error: ${responseText}`,
          response.status,
          responseText
        );
      }
    } catch (error) {
      if (error instanceof SlackApiError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new SlackApiError(
          'Request timed out',
          0,
          'Timeout'
        );
      }

      throw new SlackApiError(
        `Network error: ${(error as Error).message}`,
        0,
        ''
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Utility sleep function.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
