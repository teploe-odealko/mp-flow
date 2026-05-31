import { createHash } from "node:crypto";

/**
 * Серверный playbook фотостудии — «инструкция для агента пользователя».
 * Источник истины живёт на сервере и отдаётся через MCP (get_brief + resource),
 * поэтому правила меняются на сервере и сразу действуют для всех агентов —
 * без переустановки skill. version выводится из содержимого: правка текста
 * автоматически меняет версию.
 */

export interface CardStudioPlaybook {
  version: string;
  title: string;
  markdown: string;
}

export interface CardStudioGenerationRequirements {
  referenceRequired: boolean;
  competitorResearchRequired: boolean;
  factGroundingRequired: boolean;
  visualDiversityRequired: boolean;
  referencePolicy: string[];
  researchPolicy: string[];
  factPolicy: string[];
  visualDiversityPolicy: string[];
  compositionPatterns: string[];
  planFields: string[];
}

const GENERATION_REQUIREMENTS: CardStudioGenerationRequirements = {
  referenceRequired: true,
  competitorResearchRequired: true,
  factGroundingRequired: true,
  visualDiversityRequired: true,
  referencePolicy: [
    "Перед генерацией каждого финального слайда агент обязан использовать исходное фото товара как visual reference/edit target. Инструмент генерации обязан это поддерживать.",
    "Запрещено загружать финальный слайд, если форма, цвет, пропорции или видимые детали товара заметно отличаются от исходного фото."
  ],
  researchPolicy: [
    "Перед планом слайдов агент изучает карточки конкурентов, сильные визуальные приемы категории и отзывы/вопросы покупателей, если у него есть доступ к веб-поиску или другим источникам.",
    "Конкурентные карточки и отзывы используются для поиска ожиданий, возражений, сценариев и удачных форматов подачи, но не как доказательство характеристик нашего товара.",
    "В плане нужно зафиксировать, что именно найдено у конкурентов/в отзывах и какие проблемы покупателей закрывает серия слайдов."
  ],
  factPolicy: [
    "Нельзя придумывать материалы, размеры, вес, совместимые диагонали, нагрузку, комплектацию, гарантию, сертификаты, скидки или обещания результата.",
    "Каждое утверждение на слайде должно опираться на один из источников: видимые детали исходного фото, данные товара в брифе, привязанная карточка/поля MPFlow, прямое указание пользователя или надежный внешний источник именно по такому же товару.",
    "Если факт очевиден по фото, его можно использовать как видимое свойство; если есть сомнение, занеси его в unknowns или claimsToAvoid."
  ],
  visualDiversityPolicy: [
    "Единый стиль не означает один и тот же фон, ракурс и раскладку. Палитра, свет, типографика и иконки должны быть общими, а композиция каждого слайда — разной.",
    "Запрещено генерировать серию как ленивый копипаст: одинаковый фон, одинаковая позиция товара и только замененный заголовок.",
    "Для каждого слайда в плане укажи compositionPattern и sceneDirection. Не повторяй один compositionPattern два раза подряд, кроме осознанных пар comparison/before-after.",
    "В каждом промпте явно опиши, чем композиция этого слайда отличается от остальных: масштаб товара, ракурс, тип сцены, инфографическая сетка, глубина/контекст или фокус на детали."
  ],
  compositionPatterns: [
    "hero_studio",
    "benefit_bento",
    "desk_lifestyle",
    "macro_detail",
    "usage_steps",
    "device_split",
    "comparison",
    "objection_trust"
  ],
  planFields: [
    "research.competitors",
    "research.reviewPainPoints",
    "research.factSources",
    "research.unknowns",
    "style.visualDna",
    "style.compositionSystem",
    "slides[].evidence",
    "slides[].claimsToAvoid",
    "slides[].compositionPattern",
    "slides[].sceneDirection",
    "slides[].visualDifference"
  ]
};

const PLAYBOOK_MARKDOWN = `# Card Studio Playbook — фото карточки Ozon

Ты — арт-директор карточки товара. Из одного исходного фото собери серию из 8–12 продающих изображений в ЕДИНОМ стиле. Все решения принимаешь ты сам — ниже методика, а не жёсткий шаблон.

Парадигма: исходное фото — главный контракт. Качество исходника не важно — важны ДЕТАЛИ, которые на нём видны. Модель генерации — универсальный трансформер: точный промпт + обязательный референс → идеальная картинка. Но товар на выходе обязан быть идентичен референсу.

## Жёсткие правила
- Референс обязателен для каждого финального слайда. Инструмент генерации обязан поддерживать image reference / edit target — передавай исходное фото в каждый запрос.
- Не загружай в MPFlow слайд, где товар заметно отличается от исходника: другая форма, цвет, пропорции, количество отверстий/кнопок/деталей, другая конструкция, лишние элементы или потерянные видимые детали.
- Конкуренты и отзывы нужны, чтобы понять ожидания категории, сильные визуальные приёмы и боли покупателей. Они НЕ доказывают характеристики нашего товара.

## Шаг 1. Исследуй товар (НЕ пропускать)
Прежде чем что-то генерировать — изучи товар настолько глубоко, насколько можешь, своими инструментами (vision по исходнику, веб-поиск, карточки конкурентов и отзывы). Определи и зафиксируй:
- что это, тип, материалы, форма, цвета, видимые детали;
- целевую аудиторию и уместное настроение (премиум / тёплое-уютное / техно / детское …);
- 4–7 ключевых преимуществ и главное УТП;
- сценарии использования и неочевидные применения;
- частые возражения и вопросы покупателей — это золото для слайдов;
- как выглядят сильные карточки конкурентов в категории (свет, композиция, инфографика, что в топе);
- какие проблемы и сомнения повторяются в отзывах/вопросах покупателей, и какие из них можно честно закрыть нашим товаром.
Чем больше узнаешь — тем сильнее карточка. Вывод сохрани в план (поле research): competitors, reviewPainPoints, factSources, unknowns. Отдельно укажи, какие тезисы нельзя использовать без подтверждения.

## Шаг 2. Единый визуальный стиль (Style DNA)
Выбери ОДИН визуальный архетип и держи его на ВСЕЙ серии (примеры: Cinematic Studio, Moody Luxury, Clean Editorial, Lifestyle Soft Natural, Glass Bento Infographic). Важно: единый стиль — это общий визуальный язык, а не одинаковый фон и не один шаблон. Зафиксируй style constants и вставляй их в КАЖДЫЙ промпт:
- Палитра: 3–4 цвета, отталкивайся от товара/бренда (не дефолтный «индиго+серый» без причины).
- Типографика: выразительная пара — display-гротеск для заголовков + нейтральный для текста.
- Иконки: outlined ИЛИ filled — не смешивать.
- Фон: система, а не один фон. Например: чистый studio hero, desk lifestyle, крупный macro, bento-инфографика, split comparison — в одной палитре и свете.
- Свет и настроение: одно на всю серию.
- Визуальная подпись: один узнаваемый приём (мягкий градиент / лёгкий паттерн / геометрия) — повторяй везде.
Именно общие style constants превращают разрозненные кадры в серию. Специфику выбираешь ты под товар.

## Шаг 2.1. Разнообразие композиции (обязательно)
Не делай серию как один и тот же макет с заменённым заголовком. У каждого слайда должна быть своя визуальная роль и свой compositionPattern:
- hero_studio — крупный товар, главный УТП, минимум деталей вокруг;
- benefit_bento — 3–5 выгод в bento/карточках вокруг товара;
- desk_lifestyle — товар в реальном контексте стола/рабочей поверхности;
- macro_detail — крупный ракурс важной детали, материала, механизма или фактуры;
- usage_steps — сценарий использования или настройка, стрелки/шаги;
- device_split — разные устройства/сценарии в разделённой композиции;
- comparison — сравнение с альтернативой или закрытие возражения;
- objection_trust — аккуратное закрытие сомнений без неподтверждённых обещаний.

В плане для каждого слайда заполни: compositionPattern, sceneDirection и visualDifference. visualDifference — коротко, чем этот слайд отличается от соседних: другой ракурс, масштаб, фон, сетка, глубина сцены, тип инфографики или фокус на детали.

## Шаг 3. Последовательность слайдов
Составь осмысленную последовательность (8–12), ведущую покупателя от «вау» к «беру». Опирайся на таксономию маркетплейса (guidelines.slideTaxonomy) и адаптируй под товар и находки исследования. Для каждого слайда задай: тип, ОДНО сообщение, исходник-референс, тексты надписей дословно, evidence (какие факты подтверждают текст), claimsToAvoid, compositionPattern, sceneDirection и visualDifference. Не дублируй сообщения и не повторяй один layout между слайдами.

## Шаг 4. Промпт на каждый слайд (самое важное)
Цель — КРУТАЯ продающая картинка, а не пиксельный чертёж. Ты задаёшь идею, стиль, цвета словами, тексты дословно и общую композицию; модели оставляешь свободу в точных деталях.

Структура промпта:
1. Тип и формат: e-commerce product photo / infographic, 3:4 vertical portrait.
2. Товар: точное описание (что это, материал, цвет, форма, детали).
3. Композиция: словами — что слева/справа/по центру, примерные пропорции.
4. Фон и палитра: словами, без HEX.
5. Свет: soft diffused / studio rim / natural daylight…
6. Style constants: палитра/типографика/иконки описательно (из Шага 2) — единые на серию.
7. Composition pattern: укажи выбранный паттерн и чем он отличается от остальных слайдов серии.
8. Инфографика (если есть): заголовок и буллеты — ТОЧНЫЙ текст дословно + стиль иконок.
9. Safe-zones: оставь поля по краям пустыми (guidelines.safeZones), без видимых меток.
10. Reference + сохранение товара (см. ниже).
11. Fact grounding: перечисли, какие факты из брифа/фото/слов пользователя подтверждают текст слайда.

Гигиена промпта (обязательно):
- НЕ пиши в промпт: px, %, координаты, HEX-коды, названия шрифтов, слова «safe zone / margin / grid / layout» — это инструкции для размещения, а не текст на картинке.
- Добавляй явный запрет: "Do NOT render any technical annotations, measurements, guides, grids, safe-zone overlays, or font/color names as visible text."
- Композицию и отступы описывай словами; ASCII-схемы в промпт не вставляй.
- Добавляй явный запрет на шаблонность: "Do not reuse the same background, camera angle, product placement, or layout from the previous slides; keep the same style DNA but create a distinct composition."

Сохранение товара (критично — модель склонна перерисовывать):
- В каждый запрос генерации передавай исходное фото как референс/edit target. Текстового описания товара недостаточно.
- В каждый промпт с референсом добавляй: "Keep every product element EXACTLY as in the reference — do not redraw, restyle, distort or regenerate the product design; preserve exact shapes, proportions, colors and details. Only change background, lighting, context and add text/infographic."

Фактологическая дисциплина:
- Не заявляй точные размеры, вес, диагонали, максимальную нагрузку, материал, гарантию, комплектацию, сертификаты, скидку или «100% результат», если этого нет в брифе, на фото или в словах пользователя.
- Видимые свойства можно описывать аккуратно: форма, цвет, элементы конструкции, сценарий использования, если они реально следуют из фото/названия/данных товара.
- Выводы из конкурентов и отзывов превращай в закрытие возражений, а не в неподтвержденные обещания. Например: «передний упор удерживает устройство» допустимо, если упор виден на фото; «выдерживает 20 кг» недопустимо без данных.

Hero (слайд 1): товар — главный герой, занимает 60–80% кадра; крупный жирный заголовок с главным УТП; инфографика — дополнение ВОКРУГ товара, не поверх него.

Пример уровня детализации (адаптируй под свой товар и стиль):
"""
E-commerce infographic slide, 3:4 vertical portrait. PRODUCT: black matte over-ear headphones with silver hinges and cushioned earpads. COMPOSITION: product on the left at a 3/4 angle taking about half the width and most of the height; right column — bold headline on top, then four benefit rows evenly stacked. BACKGROUND: clean light neutral with a soft warm tint. LIGHTING: soft diffused studio light with a gentle rim. STYLE: deep charcoal + warm sand + one muted accent; bold geometric sans for titles, neutral sans for captions; outlined icons in soft circles. HEADLINE: "МАКСИМУМ КОМФОРТА". BENEFITS: "40 часов работы", "Активное шумоподавление", "Bluetooth 5.3", "Складная конструкция" — each with a matching outlined icon. Keep generous empty margins on all edges and keep the top strip, top-right and bottom-left corners and the bottom strip clear. Keep the product EXACTLY as in the reference; change only background, lighting and added graphics. Do NOT render any technical annotations, measurements, guides or font/color names as visible text.
"""

## Шаг 5. Как сохранять результат
- Сохрани план (research + style + slides) через card_studio_save_plan — он отобразится в интерфейсе пользователя и позволит продолжить работу.
- Каждый готовый слайд: card_studio_create_upload (role=generated, slideType из плана, contentType) → HTTP PUT байтов на выданный uploadUrl → card_studio_confirm_asset.
- Генерируй строго 3:4. Перед загрузкой проверь safe-zones и единство стиля серии.
- Пользователь сам одобрит слайды и нажмёт экспорт на Ozon.
`;

let cached: CardStudioPlaybook | undefined;

export function getCardStudioPlaybook(): CardStudioPlaybook {
  if (!cached) {
    const version = createHash("sha256").update(PLAYBOOK_MARKDOWN).digest("hex").slice(0, 12);
    cached = { version, title: "Card Studio Playbook — фото карточки Ozon", markdown: PLAYBOOK_MARKDOWN };
  }
  return cached;
}

export function getCardStudioGenerationRequirements(): CardStudioGenerationRequirements {
  return GENERATION_REQUIREMENTS;
}
