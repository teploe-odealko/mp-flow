import { MedusaService } from "@medusajs/utils";
import FinanceTransaction from "./models/finance-transaction";

class FinanceModuleService extends MedusaService({
  FinanceTransaction,
}) {
  /**
   * Calculate P&L for a given date range.
   */
  async calculatePnl(from: Date, to: Date, filters?: Record<string, any>) {
    const transactions = await this.listFinanceTransactions({
      transaction_date: { $gte: from, $lte: to },
      ...filters,
    });

    const income = transactions
      .filter((t) => t.direction === "income")
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const expense = transactions
      .filter((t) => t.direction === "expense")
      .reduce((sum, t) => sum + Number(t.amount), 0);

    // Group by type
    const byType: Record<string, number> = {};
    for (const t of transactions) {
      const sign = t.direction === "income" ? 1 : -1;
      byType[t.type] = (byType[t.type] || 0) + sign * Number(t.amount);
    }

    return {
      income,
      expense,
      profit: income - expense,
      margin: income > 0 ? ((income - expense) / income) * 100 : 0,
      by_type: byType,
      transaction_count: transactions.length,
    };
  }
}

export default FinanceModuleService;
