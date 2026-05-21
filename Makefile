.PHONY: install dev db down test build check clean

DB_PORT ?= 54322
API_PORT ?= 3004
WEB_PORT ?= 5174

install:
	npm ci

db:
	docker compose up -d postgres
	@until nc -z 127.0.0.1 $(DB_PORT); do sleep 1; done
	@echo "PostgreSQL ready on 127.0.0.1:$(DB_PORT)"

dev: db
	npm run dev

test:
	npm test

build:
	npm run build

check:
	@curl -s --max-time 5 http://127.0.0.1:$(API_PORT)/api/health/ready && echo
	@curl -I --max-time 5 http://127.0.0.1:$(WEB_PORT) | sed -n '1,5p'

down:
	docker compose down

clean:
	rm -rf dist coverage test-results playwright-report tmp
