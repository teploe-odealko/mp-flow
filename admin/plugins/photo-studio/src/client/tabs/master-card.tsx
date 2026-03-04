import { useState, useRef, useCallback } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiGet, apiPost, apiDelete } from "../../../../../src/client/lib/api"
import type { MasterCardTabProps } from "../../../../../src/client/pages/catalog/tab-types"

export const tabLabel = "Фото"
export const tabOrder = 20

type FrameStatus = "concept" | "svg_draft" | "svg_approved" | "generating" | "generated" | "failed"

interface PhotoFrame {
  index: number
  concept: string
  svg_content?: string
  svg_feedback?: string
  status: FrameStatus
  source_images?: string[]
  generated_file_id?: string
  generation_prompt?: string
  generation_feedback?: string
  attempts: number
}

interface PhotoStyleConfig {
  color_scheme?: string
  accent_colors?: string[]
  typography?: string
  layout_style?: string
  mood?: string
  notes?: string
}

interface PhotoProject {
  id: string
  status: string
  research?: any
  frames: PhotoFrame[]
  source_images: string[]
  style_config?: PhotoStyleConfig | null
  total_frames: number
  approved_frames: number
  generated_frames: number
  error?: string
  created_at: string
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Черновик",
  planned: "Спланировано",
  svg_review: "SVG-превью",
  generating: "Генерация",
  completed: "Готово",
}

const FRAME_STATUS_LABELS: Record<FrameStatus, string> = {
  concept: "Концепт",
  svg_draft: "SVG",
  svg_approved: "Одобрен",
  generating: "Генерация...",
  generated: "Готово",
  failed: "Ошибка",
}

const FRAME_STATUS_COLORS: Record<FrameStatus, string> = {
  concept: "text-text-secondary",
  svg_draft: "text-accent",
  svg_approved: "text-inflow",
  generating: "text-accent",
  generated: "text-inflow",
  failed: "text-outflow",
}

// SVG iframe srcDoc with script that strips fixed dimensions for responsive scaling
function svgSrcDoc(svgContent: string): string {
  return `<!DOCTYPE html><html><head><style>body{margin:0;display:flex;align-items:center;justify-content:center;background:#1a1a1a;width:100vw;height:100vh;overflow:hidden}svg{width:100%;height:100%}</style></head><body>${svgContent}<script>document.querySelectorAll('svg').forEach(function(s){var w=s.getAttribute('width'),h=s.getAttribute('height');if(w&&h&&!s.getAttribute('viewBox')){s.setAttribute('viewBox','0 0 '+parseInt(w)+' '+parseInt(h))}s.removeAttribute('width');s.removeAttribute('height')})</script></body></html>`
}

export default function PhotoStudioTab({ productId, onRefresh }: MasterCardTabProps) {
  const queryClient = useQueryClient()
  const [feedbackIndex, setFeedbackIndex] = useState<number | null>(null)
  const [feedbackText, setFeedbackText] = useState("")
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["photo-studio", productId],
    queryFn: () => apiGet<{ projects: PhotoProject[] }>(`/api/photo-studio?master_card_id=${productId}`),
    refetchInterval: (query) => {
      const projects = query.state.data?.projects
      if (projects?.some((p) => p.status === "generating" || p.status === "svg_review")) return 5000
      return false
    },
  })

  const createMutation = useMutation({
    mutationFn: () => apiPost("/api/photo-studio", { master_card_id: productId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["photo-studio", productId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (projectId: string) => apiDelete(`/api/photo-studio/${projectId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["photo-studio", productId] })
    },
  })

  const approveMutation = useMutation({
    mutationFn: ({ projectId, index }: { projectId: string; index: number }) =>
      apiPost(`/api/photo-studio/${projectId}/frames/${index}/approve`, {}),
    onSuccess: () => refetch(),
  })

  const feedbackMutation = useMutation({
    mutationFn: ({ projectId, index, feedback }: { projectId: string; index: number; feedback: string }) =>
      apiPost(`/api/photo-studio/${projectId}/frames/${index}/feedback`, { feedback }),
    onSuccess: () => {
      setFeedbackIndex(null)
      setFeedbackText("")
      refetch()
    },
  })

  const setFrameSourcesMutation = useMutation({
    mutationFn: ({ projectId, index, fileIds }: { projectId: string; index: number; fileIds: string[] }) =>
      apiPost(`/api/photo-studio/${projectId}/frames/${index}/source-images`, { file_ids: fileIds }),
    onSuccess: () => refetch(),
  })

  if (isLoading) return <p className="text-text-secondary text-sm">Загрузка...</p>

  const projects = data?.projects || []
  const project = projects[0]

  // No project yet
  if (!project) {
    return (
      <div className="text-center py-8">
        <p className="text-text-secondary text-sm mb-4">Нет проекта фото-студии для этого товара</p>
        <button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="px-4 py-2 bg-accent text-white rounded text-sm hover:bg-accent-dark disabled:opacity-50"
        >
          {createMutation.isPending ? "Создаю..." : "Создать проект"}
        </button>
        <p className="text-text-muted text-xs mt-3">
          Проект будет создан в статусе &laquo;Черновик&raquo;. Подключите MCP-агента для запуска пайплайна.
        </p>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <span className={`text-xs px-2 py-0.5 rounded ${
          project.status === "completed" ? "bg-inflow/20 text-inflow" :
          project.status === "generating" ? "bg-accent/20 text-accent" :
          "bg-bg-surface text-text-secondary"
        }`}>
          {STATUS_LABELS[project.status] || project.status}
        </span>
        <div className="flex-1" />
        <span className="text-xs text-text-muted">
          {project.approved_frames}/{project.total_frames} одобрено
          {project.generated_frames > 0 && ` · ${project.generated_frames}/${project.total_frames} сгенерировано`}
        </span>
        <button
          onClick={() => { if (confirm("Удалить проект?")) deleteMutation.mutate(project.id) }}
          className="text-xs text-text-muted hover:text-outflow"
        >
          Удалить
        </button>
      </div>

      {/* Progress bar */}
      {project.total_frames > 0 && (
        <div className="h-1.5 bg-bg-surface rounded-full mb-4 overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all"
            style={{ width: `${(project.generated_frames / project.total_frames) * 100}%` }}
          />
        </div>
      )}

      {/* Research summary */}
      {project.research && (
        <div className="mb-4 border border-bg-border rounded p-3">
          <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Ресерч</div>
          {project.research.buyer_pain_points?.length > 0 && (
            <div className="mb-2">
              <span className="text-xs text-text-muted">Боли покупателей: </span>
              <span className="text-xs text-text-primary">{project.research.buyer_pain_points.join(" · ")}</span>
            </div>
          )}
          {project.research.key_selling_points?.length > 0 && (
            <div className="mb-2">
              <span className="text-xs text-text-muted">Преимущества: </span>
              <span className="text-xs text-text-primary">{project.research.key_selling_points.join(" · ")}</span>
            </div>
          )}
          {project.research.competitor_insights?.length > 0 && (
            <div>
              <span className="text-xs text-text-muted">Конкуренты: </span>
              <span className="text-xs text-text-primary">{project.research.competitor_insights.join(" · ")}</span>
            </div>
          )}
        </div>
      )}

      {/* Source images */}
      <SourceImagesSection projectId={project.id} sourceImages={project.source_images || []} onRefresh={refetch} />

      {/* Style config */}
      <StyleConfigSection projectId={project.id} config={project.style_config} onRefresh={refetch} />

      {project.error && (
        <div className="mb-4 bg-outflow/10 border border-outflow/30 rounded p-3 text-sm text-outflow">
          {project.error}
        </div>
      )}

      {/* Frames gallery */}
      {project.frames.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
            Фреймы ({project.frames.length})
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {project.frames.map((frame) => (
              <div
                key={frame.index}
                className={`border rounded overflow-hidden cursor-pointer transition-colors ${
                  selectedFrame === frame.index ? "border-accent" : "border-bg-border hover:border-accent/50"
                }`}
                onClick={() => setSelectedFrame(selectedFrame === frame.index ? null : frame.index)}
              >
                {/* SVG preview / generated image */}
                <div className="aspect-[3/4] bg-bg-deep relative flex items-center justify-center">
                  {frame.generated_file_id ? (
                    <GeneratedImage fileId={frame.generated_file_id} />
                  ) : frame.svg_content ? (
                    <iframe
                      srcDoc={svgSrcDoc(frame.svg_content)}
                      sandbox="allow-same-origin allow-scripts"
                      className="w-full h-full border-0 pointer-events-none"
                      title={`Frame ${frame.index}`}
                    />
                  ) : (
                    <span className="text-text-muted text-xs text-center px-2">{frame.concept}</span>
                  )}

                  {/* Status badge */}
                  <span className={`absolute top-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-bg-deep/80 ${FRAME_STATUS_COLORS[frame.status]}`}>
                    {FRAME_STATUS_LABELS[frame.status]}
                  </span>

                  {/* Source images count */}
                  {(frame.source_images?.length ?? 0) > 0 && (
                    <span className="absolute bottom-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-bg-deep/80 text-text-secondary">
                      {frame.source_images!.length} фото
                    </span>
                  )}

                  {/* Feedback indicator */}
                  {frame.svg_feedback && (
                    <span className="absolute top-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-outflow/20 text-outflow">
                      Фидбек
                    </span>
                  )}
                </div>

                {/* Footer */}
                <div className="p-2 bg-bg-surface">
                  <div className="text-[11px] text-text-secondary truncate">{frame.concept}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Selected frame detail */}
          {selectedFrame !== null && project.frames[selectedFrame] && (
            <FrameDetail
              frame={project.frames[selectedFrame]}
              projectId={project.id}
              projectSourceImages={project.source_images || []}
              onApprove={() => approveMutation.mutate({ projectId: project.id, index: selectedFrame })}
              onFeedback={() => setFeedbackIndex(selectedFrame)}
              onSetSources={(fileIds) => setFrameSourcesMutation.mutate({ projectId: project.id, index: selectedFrame, fileIds })}
              isApproving={approveMutation.isPending}
            />
          )}

          {/* Feedback modal */}
          {feedbackIndex !== null && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setFeedbackIndex(null)}>
              <div className="bg-bg-surface rounded-lg p-4 w-96 max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-sm font-semibold mb-3">Фидбек для фрейма {feedbackIndex + 1}</h3>
                <textarea
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  placeholder="Опишите что нужно изменить..."
                  className="w-full px-3 py-2 bg-bg-deep border border-bg-border rounded text-sm text-text-primary resize-none h-24 mb-3"
                />
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setFeedbackIndex(null)}
                    className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary"
                  >
                    Отмена
                  </button>
                  <button
                    onClick={() => feedbackMutation.mutate({ projectId: project.id, index: feedbackIndex, feedback: feedbackText })}
                    disabled={!feedbackText.trim() || feedbackMutation.isPending}
                    className="px-3 py-1.5 bg-accent text-white rounded text-sm hover:bg-accent-dark disabled:opacity-50"
                  >
                    Отправить
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {project.frames.length === 0 && project.status === "draft" && (
        <div className="text-center py-6 text-text-muted text-sm">
          Проект создан. Подключите MCP-агента для запуска ресерча и генерации фреймов.
        </div>
      )}
    </div>
  )
}

// ── Source Images Section ──

function SourceImagesSection({ projectId, sourceImages, onRefresh }: {
  projectId: string
  sourceImages: string[]
  onRefresh: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const removeMutation = useMutation({
    mutationFn: (fileId: string) => apiDelete(`/api/photo-studio/${projectId}/source-images/${fileId}`),
    onSuccess: () => onRefresh(),
  })

  const [uploadError, setUploadError] = useState<string | null>(null)

  const handleUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setUploadError(null)
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData()
        formData.append("file", file)
        formData.append("metadata", JSON.stringify({ source: "photo-studio", project_id: projectId }))
        const uploadRes = await fetch("/api/files/upload", {
          method: "POST",
          credentials: "include",
          body: formData,
        })
        if (!uploadRes.ok) {
          const err = await uploadRes.json().catch(() => null)
          throw new Error(err?.error || `Upload failed (${uploadRes.status})`)
        }
        const { file: uploaded } = await uploadRes.json()
        await apiPost(`/api/photo-studio/${projectId}/source-images`, { file_id: uploaded.id })
      }
      onRefresh()
    } catch (e: any) {
      setUploadError(e.message || "Upload failed")
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }, [projectId, onRefresh])

  return (
    <div className="mb-4 border border-bg-border rounded p-3">
      <div className="flex items-center gap-2 mb-2">
        <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
          Исходные фото
        </div>
        <span className="text-xs text-text-muted">{sourceImages.length}</span>
        <div className="flex-1" />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => handleUpload(e.target.files)}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="text-xs px-2 py-1 bg-accent/10 text-accent rounded hover:bg-accent/20 disabled:opacity-50"
        >
          {uploading ? "Загрузка..." : "Загрузить"}
        </button>
      </div>
      {uploadError && (
        <div className="text-xs text-red-400 mb-2">{uploadError}</div>
      )}
      {sourceImages.length > 0 ? (
        <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
          {sourceImages.map((fileId) => (
            <SourceImageThumb
              key={fileId}
              fileId={fileId}
              onRemove={() => removeMutation.mutate(fileId)}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-text-muted">Загрузите фото товара для использования в кадрах</p>
      )}
    </div>
  )
}

function SourceImageThumb({ fileId, onRemove }: { fileId: string; onRemove: () => void }) {
  const { data } = useQuery({
    queryKey: ["file-url", fileId],
    queryFn: () => apiGet<{ url: string }>(`/api/files/${fileId}/url`),
    staleTime: 50 * 60 * 1000,
  })

  return (
    <div className="relative group aspect-square bg-bg-deep rounded overflow-hidden">
      {data?.url ? (
        <img src={data.url} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-text-muted text-[10px]">...</div>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove() }}
        className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-outflow/80 text-white text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
      >
        x
      </button>
    </div>
  )
}

// ── Style Config Section ──

function StyleConfigSection({ projectId, config, onRefresh }: {
  projectId: string
  config?: PhotoStyleConfig | null
  onRefresh: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [form, setForm] = useState<PhotoStyleConfig>(config || {})
  const [dirty, setDirty] = useState(false)

  const saveMutation = useMutation({
    mutationFn: (data: PhotoStyleConfig) => apiPost(`/api/photo-studio/${projectId}/style-config`, data),
    onSuccess: () => {
      setDirty(false)
      onRefresh()
    },
  })

  const update = (key: keyof PhotoStyleConfig, value: any) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  const hasConfig = config && Object.values(config).some((v) => v !== undefined && v !== null && v !== "")

  return (
    <div className="mb-4 border border-bg-border rounded p-3">
      <div
        className="flex items-center gap-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Стиль</div>
        {hasConfig && <span className="text-[10px] text-inflow">настроен</span>}
        <div className="flex-1" />
        <span className="text-xs text-text-muted">{expanded ? "▲" : "▼"}</span>
      </div>
      {expanded && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] text-text-muted">Цветовая схема</span>
              <select
                value={form.color_scheme || ""}
                onChange={(e) => update("color_scheme", e.target.value || undefined)}
                className="w-full mt-0.5 px-2 py-1 bg-bg-deep border border-bg-border rounded text-xs text-text-primary"
              >
                <option value="">—</option>
                <option value="светлая">Светлая</option>
                <option value="тёмная">Тёмная</option>
                <option value="яркая">Яркая</option>
                <option value="пастельная">Пастельная</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] text-text-muted">Настроение</span>
              <select
                value={form.mood || ""}
                onChange={(e) => update("mood", e.target.value || undefined)}
                className="w-full mt-0.5 px-2 py-1 bg-bg-deep border border-bg-border rounded text-xs text-text-primary"
              >
                <option value="">—</option>
                <option value="весёлый">Весёлый</option>
                <option value="премиальный">Премиальный</option>
                <option value="детский">Детский</option>
                <option value="минималистичный">Минималистичный</option>
                <option value="энергичный">Энергичный</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] text-text-muted">Типографика</span>
              <select
                value={form.typography || ""}
                onChange={(e) => update("typography", e.target.value || undefined)}
                className="w-full mt-0.5 px-2 py-1 bg-bg-deep border border-bg-border rounded text-xs text-text-primary"
              >
                <option value="">—</option>
                <option value="крупный жирный">Крупный жирный</option>
                <option value="минималистичный">Минималистичный</option>
                <option value="рукописный">Рукописный</option>
                <option value="без текста">Без текста</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] text-text-muted">Компоновка</span>
              <select
                value={form.layout_style || ""}
                onChange={(e) => update("layout_style", e.target.value || undefined)}
                className="w-full mt-0.5 px-2 py-1 bg-bg-deep border border-bg-border rounded text-xs text-text-primary"
              >
                <option value="">—</option>
                <option value="полный кадр">Полный кадр</option>
                <option value="с рамками">С рамками</option>
                <option value="коллаж">Коллаж</option>
                <option value="инфографика">Инфографика</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-[11px] text-text-muted">Акцентные цвета (HEX через запятую)</span>
            <input
              type="text"
              value={(form.accent_colors || []).join(", ")}
              onChange={(e) => update("accent_colors", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
              placeholder="#FF6B35, #004E89"
              className="w-full mt-0.5 px-2 py-1 bg-bg-deep border border-bg-border rounded text-xs text-text-primary"
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-text-muted">Заметки</span>
            <textarea
              value={form.notes || ""}
              onChange={(e) => update("notes", e.target.value || undefined)}
              placeholder="Дополнительные пожелания по стилю..."
              className="w-full mt-0.5 px-2 py-1 bg-bg-deep border border-bg-border rounded text-xs text-text-primary resize-none h-16"
            />
          </label>
          {dirty && (
            <div className="flex justify-end">
              <button
                onClick={() => saveMutation.mutate(form)}
                disabled={saveMutation.isPending}
                className="px-3 py-1 bg-accent text-white rounded text-xs hover:bg-accent-dark disabled:opacity-50"
              >
                {saveMutation.isPending ? "Сохраняю..." : "Сохранить стиль"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Frame Detail ──

function FrameDetail({ frame, projectId, projectSourceImages, onApprove, onFeedback, onSetSources, isApproving }: {
  frame: PhotoFrame
  projectId: string
  projectSourceImages: string[]
  onApprove: () => void
  onFeedback: () => void
  onSetSources: (fileIds: string[]) => void
  isApproving: boolean
}) {
  const frameSources = frame.source_images || []

  const toggleSource = (fileId: string) => {
    const next = frameSources.includes(fileId)
      ? frameSources.filter((id) => id !== fileId)
      : [...frameSources, fileId]
    onSetSources(next)
  }

  return (
    <div className="mt-4 border border-bg-border rounded p-4">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-sm font-semibold">Фрейм {frame.index + 1}</span>
        <span className={`text-xs ${FRAME_STATUS_COLORS[frame.status]}`}>
          {FRAME_STATUS_LABELS[frame.status]}
        </span>
        <div className="flex-1" />
        {(frame.status === "svg_draft" || frame.status === "concept") && (
          <>
            <button
              onClick={onApprove}
              disabled={isApproving || !frame.svg_content}
              className="px-3 py-1 bg-inflow text-white rounded text-xs hover:bg-inflow/80 disabled:opacity-50"
            >
              Одобрить
            </button>
            <button
              onClick={onFeedback}
              className="px-3 py-1 border border-bg-border text-text-secondary rounded text-xs hover:text-text-primary"
            >
              Фидбек
            </button>
          </>
        )}
      </div>

      <div className="text-xs text-text-secondary mb-2">{frame.concept}</div>

      {/* Frame source images picker */}
      {projectSourceImages.length > 0 && (
        <div className="mb-3">
          <div className="text-[11px] text-text-muted mb-1">
            Фото для кадра ({frameSources.length}/{projectSourceImages.length})
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {projectSourceImages.map((fileId) => (
              <SourceImagePickerThumb
                key={fileId}
                fileId={fileId}
                selected={frameSources.includes(fileId)}
                onToggle={() => toggleSource(fileId)}
              />
            ))}
          </div>
        </div>
      )}

      {frame.svg_feedback && (
        <div className="bg-outflow/10 border border-outflow/20 rounded p-2 text-xs text-outflow mb-2">
          Фидбек: {frame.svg_feedback}
        </div>
      )}

      {frame.generation_feedback && (
        <div className="bg-accent/10 border border-accent/20 rounded p-2 text-xs text-accent mb-2">
          Запрос перегенерации: {frame.generation_feedback}
        </div>
      )}

      {frame.attempts > 0 && (
        <div className="text-[11px] text-text-muted">Попыток генерации: {frame.attempts}</div>
      )}
    </div>
  )
}

function SourceImagePickerThumb({ fileId, selected, onToggle }: {
  fileId: string
  selected: boolean
  onToggle: () => void
}) {
  const { data } = useQuery({
    queryKey: ["file-url", fileId],
    queryFn: () => apiGet<{ url: string }>(`/api/files/${fileId}/url`),
    staleTime: 50 * 60 * 1000,
  })

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle() }}
      className={`w-10 h-10 rounded overflow-hidden border-2 transition-colors ${
        selected ? "border-accent" : "border-transparent opacity-50 hover:opacity-80"
      }`}
    >
      {data?.url ? (
        <img src={data.url} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-bg-deep" />
      )}
    </button>
  )
}

// ── Generated Image ──

function GeneratedImage({ fileId }: { fileId: string }) {
  const { data } = useQuery({
    queryKey: ["file-url", fileId],
    queryFn: () => apiGet<{ url: string }>(`/api/files/${fileId}/url`),
    staleTime: 50 * 60 * 1000, // 50 min (URL expires in 1h)
  })

  if (!data?.url) return <div className="text-text-muted text-xs">Загрузка...</div>

  return <img src={data.url} alt="Generated" className="w-full h-full object-cover" />
}
