export interface TelegramBotConfig {
  chatId: string;
  documentProcessed?: boolean;
  exportCompleted?: boolean;
  paymentReminders?: boolean;
  weeklySummary?: boolean;
  spendingAlerts?: boolean;
  spendingAlertThreshold?: number;
}
