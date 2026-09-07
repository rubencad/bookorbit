.DEFAULT_GOAL := help

IMAGE ?= chiasottis/bookorbit
TAG ?= test
PLATFORMS ?= linux/amd64,linux/arm64
REVISION := $(shell git describe --always --abbrev=8 --dirty --exclude='*')
VERSION ?= $(TAG)-$(REVISION)

.PHONY: help docker-push docker-inspect

help:
	@printf '%s\n' \
	  'make docker-push     Build and push test images, then inspect the published tag' \
	  'make docker-inspect  Show the published image digest and architectures' \
	  '' \
	  'Overrides: IMAGE=chiasottis/bookorbit TAG=test PLATFORMS=linux/amd64 VERSION=test-custom'

docker-push:
	docker buildx build --platform "$(PLATFORMS)" \
	  --build-arg "APP_VERSION=$(VERSION)" \
	  --tag "$(IMAGE):$(TAG)" --tag "$(IMAGE):$(VERSION)" --push .
	$(MAKE) docker-inspect

docker-inspect:
	docker buildx imagetools inspect "$(IMAGE):$(TAG)"
