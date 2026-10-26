.PHONY: up down logs migrate test

up:
	cp -n .env.example .env || true
	docker compose up --build

down:
	docker compose down

logs:
	docker compose logs -f

migrate:
	docker compose exec backend python manage.py migrate

test:
	docker compose exec backend python manage.py test
