# Docker entry points so the host needs no Node/pnpm, and a single `make clean`
# tears it all back down. Plain `node scripts/ultra11y.mjs …` still works directly
# (the engine is a zero-dependency bundle).
CI_IMAGE  := ultra11y-ci

.PHONY: help test typecheck build check scan audit clean

help:
	@echo "make test       - typecheck + tests in Docker (no host pnpm)"
	@echo "make build      - rebuild the bundle in Docker"
	@echo "make scan URL=… - dynamic axe-core scan on the local Playwright (URL or FILE=…)"
	@echo "make audit FILE=… - static audit in Docker"
	@echo "make clean      - remove the ultra11y Docker images/containers + generated output"

test:
	docker compose run --rm ci

typecheck:
	docker compose run --rm ci pnpm run typecheck

build:
	docker compose run --rm ci sh -c "pnpm run build && echo built"

scan:
	node scripts/ultra11y.mjs scan "$(or $(URL),$(FILE))" $(if $(MERGE),--merge $(MERGE),)

audit:
	docker compose run --rm -v "$(PWD):/work" ci node /app/scripts/ultra11y.mjs audit "$(FILE)"

# One-shot teardown — leaves the host spotless.
clean:
	-docker compose down --rmi local -v --remove-orphans
	-docker image rm -f $(CI_IMAGE) 2>/dev/null
	rm -rf audits *.tgz /tmp/ultra11y-* 2>/dev/null; true
	@echo "clean: images, containers and generated output removed."
