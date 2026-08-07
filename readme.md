# Bitcoin PSBT Builder

Browser-based unsigned Bitcoin PSBT builder, raw transaction decoder, and public descriptor address derivation tool.

## Descriptor addresses

Open the `Descriptor Addresses` tab and enter a public ranged descriptor containing
`/<0;1>/*`. Branch `0` is used for receiving addresses and branch `1` for change
addresses. Choose a start index and derive up to 100 address pairs at a time.

All descriptor validation and address derivation happens entirely inside the
browser. The descriptor and keys are never sent to an external service or stored
by the application. Derived addresses are sent to the selected network's public
Blockstream Esplora API for balance lookup, and only addresses with a positive
available balance are displayed. Use a public watch-only descriptor; extended
private keys and WIF private keys are rejected. A displayed address can be copied
or added directly to the PSBT Builder as an output.

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
