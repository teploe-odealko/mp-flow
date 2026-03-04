import { definePlugin } from "../../src/server/core/plugin-loader.js"

export default definePlugin({
  name: "mpflow-plugin-photo-studio",
  label: "Фото-студия",
  description: "AI-пайплайн генерации продуктовых фото для карточек маркетплейсов: ресерч → SVG-превью → генерация изображений.",
})
