# TP4 — Asincronismo e integración

Lista compartida en tiempo real para elegir productos de un regalo grupal. El servidor usa Node.js y TypeScript; participantes se conectan por WebSocket y una pantalla de solo lectura recibe el ranking por Server-Sent Events (SSE). El estado vive en memoria y se pierde al reiniciar el proceso.

## Requisitos y ejecución

Se necesita Node.js LTS (18 o posterior) y npm.

```bash
npm install
npm run dev
```

Abrí [http://localhost:3000](http://localhost:3000) en una o más pestañas. La pantalla del ranking está en [http://localhost:3000/pantalla.html](http://localhost:3000/pantalla.html). Para compilar y ejecutar la versión compilada:

```bash
npm run build
npm run start:prod
```

Variables configurables: `PORT` (3000), `CATALOG_URL` (`https://dummyjson.com/products/{id}`) y `CATALOG_TIMEOUT_MS` (4000). El marcador `{id}` se reemplaza por el identificador del producto.

### Simular catálogo lento

DummyJSON admite `?delay=3000` en cada URL de producto. Configurá una URL con el marcador `{id}`:

```bash
CATALOG_URL='https://dummyjson.com/products/{id}?delay=3000' npm run dev
```

En PowerShell: `$env:CATALOG_URL='https://dummyjson.com/products/{id}?delay=3000'; npm run dev`.

## Decisiones

- Los nombres se recortan en los extremos y deben tener entre 1 y 30 caracteres. Pueden repetirse; cada conexión tiene un UUID independiente.
- Cada propuesta acepta de 1 a 10 IDs enteros positivos. Los IDs repetidos en la misma propuesta se consultan una sola vez.
- Si un producto ya existe en la lista, la segunda propuesta falla con `ya estaba en la lista`. El producto no se reemplaza ni duplica.
- Solo quien propuso un producto puede quitarlo. Esta regla se valida en el servidor.
- Cada consulta individual al catálogo vence a los 4000 ms por defecto. Es suficiente para permitir una demora moderada de red y acota cuánto espera la persona que propone; `CATALOG_TIMEOUT_MS` permite ajustarlo. Las consultas de un lote usan `Promise.all`, en paralelo. El timeout de cada producto es individual.
- La interfaz del participante recibe el resultado de su propuesta directamente; los demás solo reciben el estado público de los productos agregados.
- Si falla o tarda el catálogo, cada ID fallido recibe su motivo privado (inexistente, tiempo agotado o catálogo no disponible); los productos válidos del lote se agregan igual. Mientras se espera la respuesta externa, el servidor procesa mensajes de otras conexiones y el ranking sigue disponible.

## Contrato de comunicación

Todos los mensajes WebSocket son objetos JSON con `type`. Se conectan a `/ws` usando el WebSocket estándar del navegador. El primer mensaje debe ser `join`.

| Dirección | Tipo | Campos | Cuándo se envía |
|---|---|---|---|
| Participante → servidor | `join` | `name: string` | Al entrar. El nombre se valida y no se cambia en esa conexión. |
| Participante → servidor | `propose` | `productIds: number[]` | Para proponer de 1 a 10 productos del catálogo. |
| Participante → servidor | `vote` | `productId: number` | Para alternar el voto propio sobre un producto. |
| Participante → servidor | `remove` | `productId: number` | Para quitar un producto propio. |
| Servidor → participante | `joined` | `participantId: string`, `state: PublicState` | Al aceptar el ingreso; incluye el estado completo inicial. |
| Servidor → participante | `state` | `state: PublicState` | Después de un ingreso, desconexión o cambio en la lista. Es una instantánea completa. |
| Servidor → participante que propuso | `proposalResult` | `added: number[]`, `failures: {id: number, reason: string}[]` | Al terminar la consulta de todos los IDs de una propuesta. |
| Servidor → emisor | `error` | `message: string` | Si el JSON, tipo, campos, rango o acción no son válidos. No se difunde. |

`PublicState` contiene `participants: {id, name}[]` y `products: {id, title, price, thumbnail, proposerId, votes, addedAt}[]`. `votes` contiene IDs de participantes y `addedAt` es un timestamp numérico usado para desempatar. El servidor valida todos los mensajes; el tamaño máximo de un mensaje es 16 KiB.

La pantalla abre `GET /events` con `EventSource`. Cada evento llamado `state` tiene como `data` el mismo `PublicState` serializado como JSON. El servidor emite una instantánea inicial y otra al cambiar el estado. No hay mensajes desde la pantalla.

## WebSocket y SSE

Los participantes necesitan enviar acciones (proponer, votar y quitar) y recibir cambios, por eso WebSocket ofrece comunicación bidireccional en una conexión persistente. La pantalla solo recibe novedades; SSE mantiene un canal unidireccional simple y el navegador reconecta automáticamente mediante `EventSource`. Con polling, la pantalla consultaría repetidamente aunque nada cambie, agregaría latencia entre consultas y requeriría decidir el intervalo de actualización.

## Evidencia para la entrega

Para la demostración, abrí dos o tres pestañas de participantes y una de pantalla. Registrá una propuesta parcial (por ejemplo IDs `1, 2, 999999`), una consulta lenta configurando el catálogo, un mensaje inválido desde la consola de un participante (`window.socket.send('{"type":"desconocido"}')`) y el cierre de una pestaña. El ranking y la cantidad de participantes se actualizan sin recargar.

El endpoint `GET /health` responde `{"status":"ok"}`.
