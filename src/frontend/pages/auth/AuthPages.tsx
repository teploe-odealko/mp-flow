import { FormEvent, ReactNode, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, LogIn, Mail, Send, ShieldCheck } from "lucide-react";
import { ApiError, apiGet, apiPost } from "@/api";
import { Button } from "@/components/ui/button";

interface AuthUser {
  id: string;
  email: string;
  name: string;
  roleCode: "owner" | "accountant" | "operator" | "viewer";
}

interface AuthSession {
  user: AuthUser | null;
}

interface AuthSetup {
  signUpOpen: boolean;
  signUpMode?: "owner" | "user";
  bootstrapEmailsConfigured: boolean;
  bootstrapEmailRequired?: boolean;
  emailDeliveryMode: "smtp" | "log" | "missing";
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const sessionQuery = useSessionQuery();

  if (sessionQuery.isLoading) {
    return <AuthLoading />;
  }
  if (!sessionQuery.data?.user) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setupQuery = useSetupQuery();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const next = sanitizeNext(params.get("next"));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      await apiPost("/api/auth/login", { email, password }, { notifyOnError: false });
      await queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
      navigate(next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthFrame title="Вход" lead="MPFlow">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Email" type="email" value={email} autoComplete="email" onChange={setEmail} />
        <Field label="Пароль" type="password" value={password} autoComplete="current-password" onChange={setPassword} />
        {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
        <Button className="w-full" type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <LogIn />}
          Войти
        </Button>
      </form>
      {setupQuery.data?.signUpOpen ? (
        <p className="mt-5 text-sm text-[var(--color-muted-foreground)]">
          Нет аккаунта?{" "}
          <Link className="font-medium text-[var(--color-primary)] hover:underline" to="/signup">
            Зарегистрироваться
          </Link>
        </p>
      ) : null}
    </AuthFrame>
  );
}

export function SignupPage() {
  const setupQuery = useSetupQuery();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const response = await apiPost<{ email: string }>("/api/auth/signup", { email, password }, { notifyOnError: false });
      setSentTo(response.email);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  if (setupQuery.isLoading) return <AuthLoading />;
  if (setupQuery.data && !setupQuery.data.signUpOpen) {
    return <Navigate to="/login" replace />;
  }

  const ownerSignup = setupQuery.data?.signUpMode === "owner";

  return (
    <AuthFrame title={ownerSignup ? "Первый доступ" : "Регистрация"} lead={ownerSignup ? "Создайте владельца продового контура" : "Создайте аккаунт MPFlow"}>
      {sentTo ? (
        <div className="space-y-4">
          <div className="flex gap-3 rounded-[var(--radius-md)] border border-[var(--color-success)] bg-[var(--color-success-soft)] p-4 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--color-success)]" />
            <div>
              <div className="font-medium">Письмо отправлено на {sentTo}</div>
              <div className="mt-1 text-[var(--color-muted-foreground)]">Откройте ссылку из письма, затем войдите с этим паролем.</div>
            </div>
          </div>
          <Button asChild variant="secondary" className="w-full">
            <Link to="/login">Перейти ко входу</Link>
          </Button>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          <Field label="Email" type="email" value={email} autoComplete="email" onChange={setEmail} />
          <Field label="Пароль" type="password" value={password} autoComplete="new-password" onChange={setPassword} />
          {setupQuery.data?.bootstrapEmailRequired ? (
            <p className="text-xs text-[var(--color-muted-foreground)]">Регистрация ограничена email из списка первого доступа.</p>
          ) : null}
          {setupQuery.data?.emailDeliveryMode === "missing" ? (
            <p className="text-sm text-[var(--color-danger)]">SMTP для писем не настроен. Регистрация в проде не завершится.</p>
          ) : null}
          {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
          <Button className="w-full" type="submit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Send />}
            {ownerSignup ? "Создать владельца" : "Создать аккаунт"}
          </Button>
        </form>
      )}
    </AuthFrame>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const verifyQuery = useQuery({
    queryKey: ["auth", "verify", token],
    enabled: token.length > 0,
    retry: false,
    queryFn: () => apiPost<{ email: string; verified: boolean }>("/api/auth/verify-email", { token }, { notifyOnError: false })
  });

  const content = useMemo(() => {
    if (!token) {
      return { tone: "danger", title: "Ссылка неполная", message: "В письме должна быть ссылка с токеном подтверждения." };
    }
    if (verifyQuery.isLoading) {
      return { tone: "muted", title: "Подтверждаем email", message: "Проверяем ссылку подтверждения." };
    }
    if (verifyQuery.isError) {
      return { tone: "danger", title: "Не удалось подтвердить email", message: errorMessage(verifyQuery.error) };
    }
    return { tone: "success", title: "Email подтвержден", message: "Теперь можно войти в MPFlow." };
  }, [token, verifyQuery.error, verifyQuery.isError, verifyQuery.isLoading]);

  return (
    <AuthFrame title={content.title} lead="Подтверждение email">
      <div className="space-y-4">
        <div className={statusClass(content.tone)}>
          {content.tone === "success" ? <ShieldCheck className="mt-0.5 size-4 shrink-0" /> : <Mail className="mt-0.5 size-4 shrink-0" />}
          <p>{content.message}</p>
        </div>
        <Button asChild className="w-full">
          <Link to="/login">Войти</Link>
        </Button>
      </div>
    </AuthFrame>
  );
}

function useSessionQuery() {
  return useQuery({
    queryKey: ["auth", "session"],
    retry: false,
    queryFn: () => apiGet<AuthSession>("/api/auth/session", { notifyOnError: false })
  });
}

function useSetupQuery() {
  return useQuery({
    queryKey: ["auth", "setup"],
    retry: false,
    queryFn: () => apiGet<AuthSetup>("/api/auth/setup", { notifyOnError: false })
  });
}

function AuthFrame({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-[var(--color-background)] grid place-items-center px-4 py-10">
      <section className="w-full max-w-[420px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-6 shadow-[var(--shadow-md)]">
        <div className="mb-6">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-primary)]">{lead}</div>
          <h1 className="mt-2 text-2xl font-semibold text-[var(--color-foreground)]">{title}</h1>
        </div>
        {children}
      </section>
    </main>
  );
}

function AuthLoading() {
  return (
    <main className="min-h-screen grid place-items-center bg-[var(--color-background)] text-sm text-[var(--color-muted-foreground)]">
      <span className="inline-flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" />
        Загрузка…
      </span>
    </main>
  );
}

function Field(props: {
  label: string;
  type?: string;
  value: string;
  autoComplete?: string;
  onChange(value: string): void;
}) {
  return (
    <label className="block space-y-1.5 text-sm font-medium">
      <span>{props.label}</span>
      <input
        className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-card)] px-3 text-sm font-normal outline-none transition focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-ring)]"
        type={props.type ?? "text"}
        value={props.value}
        autoComplete={props.autoComplete}
        required={props.type !== undefined || props.label !== "Имя"}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

function sanitizeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Неизвестная ошибка";
}

function statusClass(tone: string) {
  const base = "flex gap-3 rounded-[var(--radius-md)] border p-4 text-sm";
  if (tone === "success") return `${base} border-[var(--color-success)] bg-[var(--color-success-soft)] text-[var(--color-success)]`;
  if (tone === "danger") return `${base} border-[var(--color-danger)] bg-[var(--color-danger-soft)] text-[var(--color-danger)]`;
  return `${base} border-[var(--color-border)] bg-[var(--color-muted)] text-[var(--color-muted-foreground)]`;
}
