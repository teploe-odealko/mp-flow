# Security policy

## Как сообщить об уязвимости

Не создавайте публичный issue с секретами, токенами, дампами базы или рабочим exploit.

Для приватного сообщения используйте GitHub Security Advisories в репозитории или напишите владельцам проекта. В сообщении укажите:

- затронутую версию/commit;
- минимальные шаги воспроизведения;
- ожидаемый impact;
- есть ли риск раскрытия персональных данных, marketplace credentials или финансовых данных.

## Поддерживаемая версия

Пока поддерживается только `main`. Исправления безопасности делаются в `main` и выкатываются в production после проверки.

## Production-требования

- `AUTH_REQUIRED=true`.
- Подтверждение email включено.
- `ACCOUNTING_ENCRYPTION_KEY` длинный, случайный и сохранен вне репозитория.
- `DATABASE_URL` указывает на durable PostgreSQL с backup.
- `/metrics` защищен `METRICS_TOKEN`.
- Sentry/GlitchTip и логи не получают cookies, Authorization headers и marketplace API keys.
- Публичная регистрация включается только осознанно.
