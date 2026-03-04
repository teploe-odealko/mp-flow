import { useState } from "react"
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

interface PhotoProject {
  id: string
  status: string
  research?: any
  frames: PhotoFrame[]
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
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
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
                      srcDoc={`<!DOCTYPE html><html><head><style>body{margin:0;display:flex;align-items:center;justify-content:center;background:#1a1a1a;overflow:hidden}svg{max-width:100%;max-height:100%}</style></head><body>${frame.svg_content}</body></html>`}
                      sandbox="allow-same-origin"
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
              onApprove={() => approveMutation.mutate({ projectId: project.id, index: selectedFrame })}
              onFeedback={() => setFeedbackIndex(selectedFrame)}
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

function FrameDetail({ frame, projectId, onApprove, onFeedback, isApproving }: {
  frame: PhotoFrame
  projectId: string
  onApprove: () => void
  onFeedback: () => void
  isApproving: boolean
}) {
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

function GeneratedImage({ fileId }: { fileId: string }) {
  const { data } = useQuery({
    queryKey: ["file-url", fileId],
    queryFn: () => apiGet<{ url: string }>(`/api/files/${fileId}/url`),
    staleTime: 50 * 60 * 1000, // 50 min (URL expires in 1h)
  })

  if (!data?.url) return <div className="text-text-muted text-xs">Загрузка...</div>

  return <img src={data.url} alt="Generated" className="w-full h-full object-cover" />
}
