# Docker test images

From the repository root, with Docker Desktop (or Docker Engine with Buildx) running and Docker Hub login configured with `docker login`:

```sh
make docker-push
```

This builds the current working directory for AMD64 and ARM64, pushes `chiasottis/bookorbit:test` and `chiasottis/bookorbit:test-<git-revision>`, and inspects the published image. The revision tag is also baked into `APP_VERSION`. Tracked uncommitted changes add a `-dirty` suffix; untracked files can be included by Docker but do not affect that suffix. Use `VERSION` to label a specific local experiment.

Override the repository, tag, architectures, or version as needed:

```sh
make docker-push PLATFORMS=linux/amd64
make docker-push IMAGE=yourname/bookorbit TAG=nas VERSION=nas-experiment-1
```

Run `make docker-inspect` to check the published tag again, or `make -n docker-push` to preview the commands without building or pushing. Builders must support the requested platforms, using native nodes or emulation.

On the NAS, set `APP_IMAGE=chiasottis/bookorbit:test` in the deployment `.env`, then run:

```sh
docker compose pull app
docker compose up -d app
```

Docker selects the AMD64 image automatically on an AMD64 NAS.
