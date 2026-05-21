import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange(page: number): void;
  onPageSizeChange(size: number): void;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(page, 1), totalPages);
  const from = total === 0 ? 0 : (clampedPage - 1) * pageSize + 1;
  const to = Math.min(total, clampedPage * pageSize);

  return (
    <div className="flex flex-col gap-3 border-t border-[var(--color-border)] px-4 py-3 md:flex-row md:items-center md:justify-between">
      <div className="text-sm text-[var(--color-muted-foreground)]">
        {total === 0 ? "Нет записей" : `Показаны ${from}-${to} из ${total}`}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-[var(--color-muted-foreground)]">На странице</span>
        <Select
          value={String(pageSize)}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          className="w-24"
        >
          {PAGE_SIZE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
        <Button variant="secondary" size="icon" onClick={() => onPageChange(clampedPage - 1)} disabled={clampedPage <= 1} aria-label="Предыдущая страница">
          <ChevronLeft size={16} />
        </Button>
        <div className="min-w-20 text-center text-sm font-medium">
          {clampedPage} / {totalPages}
        </div>
        <Button variant="secondary" size="icon" onClick={() => onPageChange(clampedPage + 1)} disabled={clampedPage >= totalPages} aria-label="Следующая страница">
          <ChevronRight size={16} />
        </Button>
      </div>
    </div>
  );
}
