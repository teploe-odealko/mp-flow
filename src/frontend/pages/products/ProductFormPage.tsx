import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useAppState } from "@/lib/use-app-state";
import { apiPatch, apiPost } from "@/api";
import { ProductThumb } from "@/components/product-thumb";
import { Badge } from "@/components/ui/badge";

export function ProductFormPage() {
  const { id } = useParams();
  const { state } = useAppState();
  const existing = id ? (state.products ?? []).find((p: any) => p.id === id) : null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [sku, setSku] = useState(existing?.sku ?? `SKU-${Math.floor(Math.random() * 1e6)}`);
  const [name, setName] = useState(existing?.name ?? "");
  const [unit, setUnit] = useState(existing?.unit ?? "шт");
  const [barcode, setBarcode] = useState(existing?.barcode ?? "");
  const [imageUrl, setImageUrl] = useState(existing?.imageUrl ?? "");
  const [category, setCategory] = useState(existing?.category ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [weight, setWeight] = useState(existing?.weightGrams ?? "");
  const [length, setLength] = useState(existing?.lengthMm ?? "");
  const [width, setWidth] = useState(existing?.widthMm ?? "");
  const [height, setHeight] = useState(existing?.heightMm ?? "");
  const [brand, setBrand] = useState(existing?.brand ?? "");
  const [manufacturerArticle, setManufacturerArticle] = useState(existing?.manufacturerArticle ?? "");
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [openAfterSave, setOpenAfterSave] = useState(true);

  const nameError = !name.trim() ? "Укажите название товара" : "";
  const skuError = !sku.trim() ? "Укажите внутренний SKU" : "";
  const dimensionError = [weight, length, width, height].some((value) => Number(value) < 0) ? "Размеры и вес не могут быть отрицательными" : "";
  const imageUrlError = imageUrl && !isValidImageUrl(imageUrl) ? "Укажите корректный URL изображения" : "";

  const save = useMutation({
    mutationFn: () => {
      const body: any = {
        sku, name, unit,
        imageUrl: imageUrl || undefined,
        barcode: barcode || undefined,
        category: category || undefined,
        description: description || undefined,
        weightGrams: weight ? Number(weight) : undefined,
        lengthMm: length ? Number(length) : undefined,
        widthMm: width ? Number(width) : undefined,
        heightMm: height ? Number(height) : undefined,
        brand: brand || undefined,
        manufacturerArticle: manufacturerArticle || undefined,
        comment: comment || undefined
      };
      return existing ? apiPatch(`/api/products/${existing.id}`, body) : apiPost("/api/products", body);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries();
      const targetId = data?.id ?? existing?.id ?? "";
      navigate(openAfterSave ? `/products/${targetId}` : "/products");
    }
  });

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: "Товары", to: "/products" }, { label: existing ? "Редактирование" : "Новый товар" }]}
        title={existing ? `Редактирование · ${existing.name}` : "Новый товар"}
        subtitle={existing ? "Учёт ведётся по внутреннему SKU. Бренд и фото — необязательны." : "Сохранение карточки не меняет деньги, склад и себестоимость"}
        actions={
          <Button variant="ghost" asChild>
            <Link to="/products"><ArrowLeft size={14} /> К списку</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Основное</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Внутренний SKU" required error={skuError || undefined}>
              <Input value={sku} onChange={(e) => setSku(e.target.value)} invalid={Boolean(skuError)} />
            </Field>
            <Field label="Единица измерения" required>
              <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
                <option value="шт">шт</option>
                <option value="м">м</option>
                <option value="кг">кг</option>
                <option value="л">л</option>
              </Select>
            </Field>
            <div className="md:col-span-2">
              <Field label="Название" required error={nameError || undefined}>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Чехол MagSafe прозрачный" invalid={Boolean(nameError)} />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Главное фото" hint="URL изображения или локальный asset reference" error={imageUrlError || undefined}>
                <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..." invalid={Boolean(imageUrlError)} />
              </Field>
            </div>
            <Field label="Категория">
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Аксессуары" />
            </Field>
            <Field label="Штрихкод">
              <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
            </Field>
            <Field label="Бренд">
              <Input value={brand} onChange={(e) => setBrand(e.target.value)} />
            </Field>
            <div className="md:col-span-2">
              <Field label="Описание">
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
            </div>
            <Field label="Вес, г" error={dimensionError || undefined}>
              <Input value={weight} onChange={(e) => setWeight(e.target.value)} type="number" min={0} />
            </Field>
            <Field label="Артикул производителя">
              <Input value={manufacturerArticle} onChange={(e) => setManufacturerArticle(e.target.value)} />
            </Field>
            <Field label="Длина, мм">
              <Input value={length} onChange={(e) => setLength(e.target.value)} type="number" min={0} />
            </Field>
            <Field label="Ширина, мм">
              <Input value={width} onChange={(e) => setWidth(e.target.value)} type="number" min={0} />
            </Field>
            <Field label="Высота, мм">
              <Input value={height} onChange={(e) => setHeight(e.target.value)} type="number" min={0} />
            </Field>
            <div className="md:col-span-2">
              <Field label="Комментарий">
                <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
              </Field>
            </div>
          </CardContent>
        </Card>

        <aside className="flex flex-col gap-4">
          <Card>
            <CardHeader><CardTitle>Будет создано</CardTitle></CardHeader>
            <CardContent className="text-sm flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <ProductThumb product={{ ...existing, imageUrl, name, sku }} size={72} />
                <div className="min-w-0">
                  <div className="font-semibold">{name || "Новый товар"}</div>
                  <div className="text-xs text-[var(--color-muted-foreground)] font-mono">{sku || "SKU"}</div>
                  <Badge tone="neutral" size="sm" className="mt-2">{existing ? existing.status === "active" ? "Активен" : "Архив" : "Активен"}</Badge>
                </div>
              </div>
              <Row label="Запись в product" />
              <Row label="Без проводок" muted />
              <Row label="Без остатков" muted />
              <Row label={`Единица: ${unit}`} muted />
              <Row label={`Вес: ${weight || "—"} г`} muted />
            </CardContent>
          </Card>
          <div className="flex flex-col gap-2">
            <Button
              size="lg"
              onClick={() => {
                setOpenAfterSave(true);
                save.mutate();
              }}
              disabled={save.isPending || Boolean(nameError || skuError || dimensionError || imageUrlError)}
            >
              <Save size={14} /> {existing ? "Сохранить изменения" : "Сохранить и открыть"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setOpenAfterSave(false);
                save.mutate();
              }}
              disabled={save.isPending || Boolean(nameError || skuError || dimensionError || imageUrlError)}
            >
              {existing ? "Сохранить" : "Сохранить"}
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, muted }: { label: string; muted?: boolean }) {
  return <div className={muted ? "text-[var(--color-muted-foreground)]" : ""}>· {label}</div>;
}

function isValidImageUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
