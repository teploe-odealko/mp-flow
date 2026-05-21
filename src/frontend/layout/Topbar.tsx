import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, ChevronDown, HelpCircle, Landmark, LogOut, Search } from "lucide-react";
import { apiGet, apiPost } from "@/api";
import { Button } from "@/components/ui/button";

interface Props {
  state: any;
}

export function Topbar({ state }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    retry: false,
    queryFn: () => apiGet<{ user: { email: string; name: string } | null }>("/api/auth/session", { notifyOnError: false })
  });
  const user = sessionQuery.data?.user;
  const initials = user?.name?.slice(0, 2).toUpperCase() ?? user?.email?.slice(0, 2).toUpperCase() ?? "ИИ";

  async function logout() {
    await apiPost("/api/auth/logout", {}, { notifyOnError: false });
    await queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
    navigate("/login", { replace: true });
  }

  return (
    <header className="topbar h-14 sticky top-0 z-30 bg-[var(--color-card)]/85 backdrop-blur border-b border-[var(--color-border)] flex items-center gap-3 px-5">
      <div className="flex-1 max-w-xl relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
        <input
          aria-label="Глобальный поиск"
          placeholder="Поиск товаров, документов, поставщиков…"
          className="w-full h-9 pl-9 pr-3 rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-muted)]/40 text-sm placeholder:text-[var(--color-muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:bg-[var(--color-card)]"
        />
      </div>

      <div className="flex items-center gap-2">
        <Link
          to="/settings"
          className="h-9 px-3 rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-card)] flex items-center gap-2 text-sm hover:bg-[var(--color-muted)] transition-colors"
        >
          <Landmark size={14} className="text-[var(--color-muted-foreground)]" />
          <span className="font-medium">{state.organization?.displayName ?? "Не настроена"}</span>
          <ChevronDown size={13} className="text-[var(--color-muted-foreground)]" />
        </Link>

        <Button variant="ghost" size="icon" asChild>
          <Link to={state.organization ? "/setup/existing-store?from=setup&mode=current_stock_start" : "/setup"} aria-label="Помощь">
            <HelpCircle />
          </Link>
        </Button>
        <Button variant="ghost" size="icon" asChild>
          <Link to="/controls/audit" aria-label="Аудит действий">
            <Bell />
          </Link>
        </Button>
        <div
          className="h-9 px-2.5 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-card)] flex items-center gap-2 text-xs font-semibold hover:bg-[var(--color-muted)] transition-colors"
          title={user?.email}
        >
          <span className="size-6 rounded-full bg-[var(--color-primary)] text-white grid place-items-center text-[10px]">
            {initials}
          </span>
        </div>
        <Button variant="ghost" size="icon" onClick={logout} aria-label="Выйти">
          <LogOut />
        </Button>
      </div>
    </header>
  );
}
