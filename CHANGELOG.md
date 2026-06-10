# Changelog

## 0.1.0

- Исправлен двойной учёт операционных расходов категорий со счётом 91.02 в P&L: чистая прибыль, нераспределённая прибыль и капитал у затронутых данных вырастут на сумму таких расходов.
- Первый clean-room релиз MPFlow из рабочего контура управленческого учета.
- Проект поднят в корень репозитория без старых экспериментальных подпроектов.
- Добавлены production Dockerfile, compose-конфиги, healthchecks, Prometheus metrics, Grafana dashboards, Loki logs и Sentry-compatible error tracking.
- Добавлены open-source файлы: README, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, issue templates и CI.
