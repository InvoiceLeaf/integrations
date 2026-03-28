export interface MessengerBotConfig {
  chatId: string;
  documentProcessed?: boolean;
  exportCompleted?: boolean;
  paymentReminders?: boolean;
  weeklySummary?: boolean;
  spendingAlerts?: boolean;
  spendingAlertThreshold?: number;
}
