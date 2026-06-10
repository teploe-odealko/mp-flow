import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Статический guard против демо-дефолтов в формах (см. ревью 2026-06-10):
// формы денег, закупок, склада и продаж не должны стартовать с предзаполненных
// сумм, количеств и названий контрагентов — подсказки живут в placeholder.

const PAGES_DIR = join(__dirname, "..", "..", "src", "frontend", "pages");

const FORBIDDEN_LITERALS = [
  "Shenzhen Good Supply",
  "Стартовый капитал",
  "Аренда склада за июнь",
  "Доставка до Москвы",
  "Закупка партии аксессуаров",
  "Оплата товара поставщику",
  "Вывод средств владельцем"
];

function collectPageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return collectPageFiles(fullPath);
    return entry.name.endsWith(".tsx") ? [fullPath] : [];
  });
}

function violations(pattern: RegExp): string[] {
  return collectPageFiles(PAGES_DIR).flatMap((file) => {
    const content = readFileSync(file, "utf8");
    const matches = content.match(pattern);
    return matches ? [`${file}: ${matches.join(", ")}`] : [];
  });
}

describe("no demo defaults in page forms", () => {
  it("does not seed useState with known demo literals", () => {
    const escaped = FORBIDDEN_LITERALS.map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(`useState\\(\\s*"(?:${escaped.join("|")})"`, "g");
    expect(violations(pattern)).toEqual([]);
  });

  it("does not seed useState with multi-digit numeric strings", () => {
    expect(violations(/useState\(\s*"\d{2,}(?:\.\d+)?"\s*\)/g)).toEqual([]);
  });

  it("does not seed line arrays with demo quantities or prices", () => {
    expect(violations(/qtyOrdered:\s*\d|supplierUnitPrice:\s*\d*[1-9]|priceRub:\s*"\d{2,}|unitCostRub:\s*"\d|qty:\s*"\d{2,}/g)).toEqual([]);
  });
});
