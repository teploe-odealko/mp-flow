import { defineRouteConfig } from "@medusajs/admin-sdk"
import { DocumentText } from "@medusajs/icons"
import { Container, Heading, Text, Button, Input, Label } from "@medusajs/ui"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

type Note = {
  id: string
  title: string
  content: string | null
  is_active: boolean
}

const NotesPage = () => {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")

  const { data, isLoading } = useQuery({
    queryKey: ["notes"],
    queryFn: () =>
      fetch("/admin/notes", { credentials: "include" })
        .then((r) => r.json()),
  })

  const createMutation = useMutation({
    mutationFn: (body: { title: string; content?: string }) =>
      fetch("/admin/notes", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes"] })
      setTitle("")
      setContent("")
    },
  })

  const notes: Note[] = data?.items ?? []

  return (
    <Container>
      <Heading level="h1">Notes</Heading>
      <Text className="mb-4">Test plugin — заметки</Text>

      <div className="flex gap-2 mb-4">
        <div className="flex-1">
          <Label>Заголовок</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Название заметки"
          />
        </div>
        <div className="flex-1">
          <Label>Содержание</Label>
          <Input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Текст"
          />
        </div>
        <Button
          className="self-end"
          onClick={() => createMutation.mutate({ title, content: content || undefined })}
          disabled={!title}
        >
          Добавить
        </Button>
      </div>

      {isLoading ? (
        <Text>Загрузка...</Text>
      ) : notes.length === 0 ? (
        <Text>Нет заметок</Text>
      ) : (
        <div className="space-y-2">
          {notes.map((note) => (
            <div key={note.id} className="border rounded p-3">
              <Text className="font-medium">{note.title}</Text>
              {note.content && <Text className="text-ui-fg-subtle">{note.content}</Text>}
            </div>
          ))}
        </div>
      )}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Notes",
  icon: DocumentText,
})

export default NotesPage
