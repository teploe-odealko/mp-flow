import { cn } from "@/lib/cn";

function thumbSvg(product: any) {
  const sku = String(product?.sku ?? "").toLowerCase();
  const name = String(product?.name ?? "").toLowerCase();
  const isCable = sku.includes("cable") || name.includes("кабель");
  const isCase = sku.includes("case") || name.includes("чехол");
  const initial = String(product?.name ?? product?.sku ?? "?").trim().slice(0, 2).toUpperCase();
  if (isCable) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="12" fill="#eef2f7"/><path d="M22 62 C36 52 40 44 48 40 C58 35 66 39 74 28" fill="none" stroke="#1e293b" stroke-width="6" stroke-linecap="round"/><path d="M17 66 L29 78" stroke="#1e293b" stroke-width="6" stroke-linecap="round"/><rect x="12" y="69" width="18" height="10" rx="2" transform="rotate(45 12 69)" fill="#0f172a"/><rect x="68" y="18" width="16" height="22" rx="3" transform="rotate(45 68 18)" fill="#0f172a"/><path d="M55 52 L71 68" stroke="#0b67f7" stroke-width="4" stroke-linecap="round"/><rect x="70" y="67" width="13" height="11" rx="2" transform="rotate(45 70 67)" fill="#0b67f7"/></svg>`;
  }
  if (isCase) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="12" fill="#eef2f7"/><rect x="29" y="10" width="38" height="76" rx="10" fill="#0f172a"/><rect x="33" y="16" width="30" height="64" rx="7" fill="#1e293b"/><circle cx="39" cy="24" r="4" fill="#0b67f7"/><circle cx="52" cy="24" r="4" fill="#94a3b8"/><circle cx="39" cy="36" r="4" fill="#94a3b8"/><rect x="40" y="73" width="16" height="2" rx="1" fill="#475569"/></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="12" fill="#eef2f7"/><text x="50%" y="55%" text-anchor="middle" font-family="Inter, system-ui" font-size="32" font-weight="600" fill="#475569">${initial}</text></svg>`;
}

export function ProductThumb({ product, size = 36, className }: { product: any; size?: number; className?: string }) {
  const svg = thumbSvg(product);
  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  const src = typeof product?.imageUrl === "string" && product.imageUrl.trim().length > 0 ? product.imageUrl : url;
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt=""
      className={cn("rounded-[var(--radius-sm)] object-cover bg-[var(--color-muted)] shrink-0", className)}
      style={{ width: size, height: size }}
    />
  );
}

export function ProductCell({ product, size = 36 }: { product: any; size?: number }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <ProductThumb product={product} size={size} />
      <div className="min-w-0">
        <div className="font-medium text-sm truncate">{product?.name ?? "—"}</div>
        <div className="text-[11px] text-[var(--color-muted-foreground)] numeric">{product?.sku ?? ""}</div>
      </div>
    </div>
  );
}
