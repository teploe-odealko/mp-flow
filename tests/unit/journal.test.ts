import { describe, expect, it } from "vitest";
import { AccountingApp } from "../../src/core/accounting-app";
import { resetIds } from "../../src/core/utils";

describe("journal invariants", () => {
  it("keeps every posted journal entry balanced", async () => {
    resetIds();
    const app = new AccountingApp();
    await app.setupDemo();

    for (const entry of app.state.journalEntries) {
      const lines = app.state.journalLines.filter((line) => line.journalEntryId === entry.id);
      const debit = lines.reduce((sum, line) => sum + line.debit, 0);
      const credit = lines.reduce((sum, line) => sum + line.credit, 0);
      expect(debit).toBeCloseTo(credit, 2);
    }
  });

  it("seeds the full account set needed by the roadmap", async () => {
    resetIds();
    const app = new AccountingApp();
    app.bootstrap({ displayName: "Тест", accountingStartDate: "2026-06-01" });

    expect(app.state.chartAccounts.map((account) => account.code)).toEqual(
      expect.arrayContaining(["41.01", "41.02", "41.03", "51", "60.01", "60.02", "76.02", "76.ТП", "90.01", "90.02", "91.01", "91.02", "94", "26", "44"])
    );
  });
});
