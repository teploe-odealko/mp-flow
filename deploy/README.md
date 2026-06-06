# Production deploy MPFlow

Этот каталог содержит пример production-контура для одного сервера с Docker Compose.

Что входит:

- `mpflow` — приложение и API;
- `caddy` — HTTPS reverse proxy;
- `postgres` должен быть внешним managed/PostgreSQL сервисом и передается через `DATABASE_URL`;
- `glitchtip` — Sentry-compatible сбор ошибок;
- `prometheus`, `grafana`, `loki`, `promtail`, `blackbox-exporter`, `node-exporter`, `cadvisor` — базовая наблюдаемость;
- `systemd` timer для автодеплоя из `origin/main`.

Секреты не хранятся в репозитории. На сервере ожидаются:

- `/opt/mpflow/prod-secrets.env` — compose-level секреты;
- `/opt/mpflow/env/mpflow.env` — переменные приложения;
- `/opt/mpflow/env/mpflow-metrics-token` — bearer-token для scrape `/metrics`.

Полезные команды на сервере:

```bash
systemctl status mpflow-auto-deploy-main.timer
journalctl -u mpflow-auto-deploy-main.service -n 100 --no-pager
tail -n 100 /var/log/mpflow-deploy.log
/usr/local/bin/mpflow-auto-deploy-main
/usr/local/bin/mpflow-deploy-production "$(git -C /opt/mpflow/repo rev-parse origin/main)"
```

Минимальные production-переменные и порядок развертывания описаны в разделе «Production» в [`README.md`](../README.md).
