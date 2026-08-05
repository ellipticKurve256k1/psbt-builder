# Bitcoin PSBT Builder

Browser-based unsigned Bitcoin PSBT builder and raw transaction decoder.

## Run with Docker Compose

Build and start the production nginx container:

```sh
docker compose up --build -d
```

Open <http://localhost:8080>.

Check the container status and health:

```sh
docker compose ps
```

Follow the nginx logs:

```sh
docker compose logs -f psbt-builder
```

Stop and remove the container and Compose network:

```sh
docker compose down
```

## Local development

Install dependencies and start the Vite development server:

```sh
npm ci
npm run dev
```

## Tests

```sh
npm test
npm run test:coverage
```
