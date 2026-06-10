import { describe, expect, it } from "vitest";
import { AccountingApp } from "../../src/core/accounting-app";
import { DomainError, resetIds } from "../../src/core/utils";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function localIso(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthStartIso(monthsFromNow: number) {
  const now = new Date();
  return localIso(new Date(now.getFullYear(), now.getMonth() + monthsFromNow, 1));
}

function nextDayIso(date: string) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

async function bootstrapApp(accountingStartDate: string) {
  resetIds();
  const app = new AccountingApp();
  await app.bootstrap({ displayName: "Тест", accountingStartDate, confirmHistoricalStart: true });
  return app;
}

describe("accounting periods horizon", () => {
  it("accepts a document beyond the initial 24-month horizon and creates the period lazily", async () => {
    const app = await bootstrapApp("2024-07-01");
    const initialLastEnd = app.state.periods.map((period) => period.endsOn).sort().at(-1);
    expect(initialLastEnd).toBe("2026-06-30");

    await app.createManualDocument({ accountingDate: "2026-07-15", title: "Документ за горизонтом" });

    const period = app.state.periods.find((candidate) => candidate.startsOn === "2026-07-01");
    expect(period).toBeDefined();
    expect(period?.endsOn).toBe("2026-07-31");
    expect(period?.status).toBe("open");
  });

  it("fills intermediate months without gaps", async () => {
    const app = await bootstrapApp("2024-07-01");

    await app.createManualDocument({ accountingDate: "2026-11-20", title: "Документ через 5 месяцев за горизонтом" });

    const periods = [...app.state.periods].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
    expect(periods.at(-1)?.endsOn).toBe("2026-11-30");
    for (let index = 1; index < periods.length; index += 1) {
      expect(periods[index].startsOn).toBe(nextDayIso(periods[index - 1].endsOn));
    }
    const starts = periods.map((period) => period.startsOn);
    expect(new Set(starts).size).toBe(starts.length);
  });

  it("is idempotent: two documents in the same future month create exactly one period", async () => {
    const app = await bootstrapApp("2024-07-01");

    await app.createManualDocument({ accountingDate: "2026-09-05", title: "Первый документ" });
    await app.createManualDocument({ accountingDate: "2026-09-25", title: "Второй документ" });

    const septemberPeriods = app.state.periods.filter((period) => period.startsOn === "2026-09-01");
    expect(septemberPeriods).toHaveLength(1);
  });

  it("rejects dates beyond today + 1 year and accepts the boundary", async () => {
    const now = new Date();
    const app = await bootstrapApp(localIso(now));
    const maxFutureIso = `${now.getFullYear() + 1}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const tooFarIso = `${now.getFullYear() + 2}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    await expect(
      app.createManualDocument({ accountingDate: tooFarIso, title: "Опечатка в годе" })
    ).rejects.toMatchObject({ code: "accounting_date_too_far" });
    await expect(
      app.createManualDocument({ accountingDate: tooFarIso, title: "Опечатка в годе" })
    ).rejects.toBeInstanceOf(DomainError);

    await expect(
      app.createManualDocument({ accountingDate: maxFutureIso, title: "Ровно через год" })
    ).resolves.toBeDefined();
  });

  it("still rejects dates before the accounting start", async () => {
    const app = await bootstrapApp("2024-07-01");

    await expect(
      app.createManualDocument({ accountingDate: "2024-06-30", title: "До старта учета" })
    ).rejects.toMatchObject({ code: "before_accounting_start" });
  });

  it("plays well with backward extension: history and lazy front edge are both covered", async () => {
    const start = monthStartIso(-25);
    const app = await bootstrapApp(start);
    const todayIso = localIso(new Date());
    const currentMonthStart = monthStartIso(0);

    // Лениво дорастить периоды вперёд до текущего месяца (стартовые 24 месяца его не покрывают).
    expect(app.state.periods.some((period) => period.startsOn === currentMonthStart)).toBe(false);
    await app.createManualDocument({ accountingDate: todayIso, title: "Документ текущего месяца" });
    expect(app.state.periods.some((period) => period.startsOn === currentMonthStart)).toBe(true);

    const idsBefore = new Map(app.state.periods.map((period) => [period.startsOn, period.id]));
    const backfillStart = monthStartIso(-49);
    await app.extendAccountingStartDateBackward(backfillStart);

    const periods = [...app.state.periods].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
    expect(periods[0].startsOn).toBe(backfillStart);
    expect(periods.some((period) => period.startsOn === currentMonthStart)).toBe(true);
    for (const [startsOn, periodId] of idsBefore) {
      expect(periods.find((period) => period.startsOn === startsOn)?.id).toBe(periodId);
    }
  });
});
