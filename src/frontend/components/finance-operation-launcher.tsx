import { ArrowDownCircle, ArrowUpCircle, Banknote, ReceiptText, Store, Truck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const OPTIONS = [
  {
    key: "operating-expense",
    title: "Расход компании",
    description: "Аренда, сервисы, офисные и прочие расходы периода.",
    to: "/finance/expenses/new",
    Icon: ReceiptText
  },
  {
    key: "procurement-cost",
    title: "Расход поставки",
    description: "Доставка, упаковка и другие затраты, которые входят в себестоимость.",
    to: "/money/procurement-costs/new",
    Icon: Truck
  },
  {
    key: "supplier-payment",
    title: "Оплата поставщику",
    description: "Аванс или оплата товара поставщику без изменения себестоимости в момент платежа.",
    to: "/money/supplier-payments/new",
    Icon: ArrowUpCircle
  },
  {
    key: "marketplace-payout",
    title: "Поступление от маркетплейса",
    description: "Поступление денег от маркетплейса со сверкой состава выплаты.",
    to: "/finance/payouts/new",
    Icon: Store
  },
  {
    key: "owner-contribution",
    title: "Пополнение владельцем",
    description: "Внести личные средства в бизнес.",
    to: "/money/owner-contributions/new",
    Icon: ArrowDownCircle
  },
  {
    key: "owner-withdrawal",
    title: "Вывод владельцу",
    description: "Изъятие денег владельцем из бизнеса.",
    to: "/money/owner-withdrawals/new",
    Icon: Banknote
  }
] as const;

export function FinanceOperationLauncher({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Новая операция</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {OPTIONS.map(({ key, title, description, to, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                onClose();
                navigate(to);
              }}
              className="flex min-h-[116px] flex-col items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 py-4 text-left transition-colors hover:bg-[var(--color-muted)]"
            >
              <span className="inline-flex size-9 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
                <Icon size={18} />
              </span>
              <div className="space-y-1">
                <div className="text-sm font-semibold">{title}</div>
                <div className="text-sm text-[var(--color-muted-foreground)]">{description}</div>
              </div>
            </button>
          ))}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Закрыть</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
