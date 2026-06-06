import { defineConfig } from "vitest/config";

// Postgres-тесты (RUN_POSTGRES_TESTS=1) бьют в одну БД и пересоздают схему —
// гоняем их последовательно, чтобы файлы не клобберили друг друга. Быстрый набор
// (PG-файлы скипаются) остаётся параллельным.
const postgresMode = process.env.RUN_POSTGRES_TESTS === "1";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    fileParallelism: !postgresMode,
    coverage: {
      reporter: ["text", "html"]
    }
  }
});
