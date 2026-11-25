import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage, ListedProduct, Participant, PublicState, ServerMessage } from "./protocol.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(here, "../public");
const port = Number(process.env.PORT ?? 3000);
const catalogUrlTemplate = process.env.CATALOG_URL ?? "https://dummyjson.com/products/{id}";
const catalogTimeoutMs = Number(process.env.CATALOG_TIMEOUT_MS ?? 4000);
const participants = new Map<string, { participant: Participant; socket: WebSocket }>();
const products = new Map<number, ListedProduct>();
const screens = new Set<import("node:http").ServerResponse>();

function publicState(): PublicState {
  return {
    participants: [...participants.values()].map(({ participant }) => participant),
    products: [...products.values()]
      .map((p) => ({ ...p, votes: [...p.votes] }))
      .sort((a, b) => b.votes.length - a.votes.length || a.addedAt - b.addedAt),
  };
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function publishState(): void {
  const state = publicState();
  const message: ServerMessage = { type: "state", state };
  for (const { socket } of participants.values()) send(socket, message);
  const data = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
  for (const response of screens) response.write(data);
}

function privateError(socket: WebSocket, message: string): void {
  send(socket, { type: "error", message });
}

function parseMessage(data: WebSocket.RawData): ClientMessage | null {
  let value: unknown;
  try { value = JSON.parse(data.toString()); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const m = value as Record<string, unknown>;
  if (m.type === "join" && typeof m.name === "string") return { type: "join", name: m.name };
  if (m.type === "propose" && Array.isArray(m.productIds) && m.productIds.every(Number.isInteger))
    return { type: "propose", productIds: m.productIds as number[] };
  if ((m.type === "vote" || m.type === "remove") && Number.isInteger(m.productId))
    return { type: m.type, productId: m.productId as number };
  return null;
}

async function fetchProduct(id: number): Promise<{ product?: Omit<ListedProduct, "proposerId" | "votes" | "addedAt">; reason?: string }> {
  try {
    const productUrl = catalogUrlTemplate.includes("{id}")
      ? catalogUrlTemplate.replaceAll("{id}", String(id))
      : `${catalogUrlTemplate.replace(/\/$/, "")}/${id}`;
    const response = await fetch(productUrl, { signal: AbortSignal.timeout(catalogTimeoutMs) });
    if (response.status === 404) return { reason: "inexistente" };
    if (!response.ok) return { reason: "catálogo no disponible" };
    const value = await response.json() as Record<string, unknown>;
    if (value.id !== id || typeof value.title !== "string" || typeof value.price !== "number")
      return { reason: "respuesta inválida del catálogo" };
    return { product: { id, title: value.title, price: value.price, thumbnail: typeof value.thumbnail === "string" ? value.thumbnail : "" } };
  } catch (error) {
    return { reason: error instanceof Error && error.name === "TimeoutError" ? "tiempo de espera agotado" : "catálogo no disponible" };
  }
}

async function handle(socket: WebSocket, raw: WebSocket.RawData): Promise<void> {
  const message = parseMessage(raw);
  const participantId = [...participants.entries()].find(([, v]) => v.socket === socket)?.[0];
  if (!message) { privateError(socket, "Mensaje inválido: revisá el tipo y los campos requeridos."); return; }
  if (!participantId) {
    if (message.type !== "join") { privateError(socket, "Primero tenés que ingresar con un nombre."); return; }
    const name = message.name.trim();
    if (!name || name.length > 30) { privateError(socket, "El nombre debe tener entre 1 y 30 caracteres."); return; }
    const participant = { id: randomUUID(), name };
    participants.set(participant.id, { participant, socket });
    send(socket, { type: "joined", participantId: participant.id, state: publicState() });
    publishState();
    return;
  }
  if (message.type === "join") { privateError(socket, "Esta conexión ya ingresó."); return; }
  if (message.type === "propose") {
    if (message.productIds.length < 1 || message.productIds.length > 10 || message.productIds.some((id) => id < 1)) {
      privateError(socket, "La propuesta debe incluir entre 1 y 10 ids positivos."); return;
    }
    const uniqueIds = [...new Set(message.productIds)];
    const results = await Promise.all(uniqueIds.map(async (id) => ({ id, ...(await fetchProduct(id)) })));
    const added: number[] = [];
    const failures: { id: number; reason: string }[] = [];
    // Al volver de las consultas async, esta sección síncrona aplica cada resultado de forma atómica.
    for (const result of results) {
      if (products.has(result.id)) failures.push({ id: result.id, reason: "ya estaba en la lista" });
      else if (result.product) {
        products.set(result.id, { ...result.product, proposerId: participantId, votes: [], addedAt: Date.now() });
        added.push(result.id);
      } else failures.push({ id: result.id, reason: result.reason ?? "catálogo no disponible" });
    }
    if (added.length) publishState();
    send(socket, { type: "proposalResult", added, failures });
    return;
  }
  if (message.type === "vote") {
    const product = products.get(message.productId);
    if (!product) { privateError(socket, "Ese producto ya no está en la lista."); return; }
    if (!product.votes.includes(participantId)) product.votes.push(participantId);
    else product.votes = product.votes.filter((id) => id !== participantId);
    publishState();
    return;
  }
  if (message.type === "remove") {
    const product = products.get(message.productId);
    if (!product) { privateError(socket, "Ese producto ya no está en la lista."); return; }
    if (product.proposerId !== participantId) { privateError(socket, "Solo quien propuso el producto puede quitarlo."); return; }
    products.delete(message.productId);
    publishState();
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (url.pathname === "/events") {
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "Access-Control-Allow-Origin": "*" });
    response.write(`event: state\ndata: ${JSON.stringify(publicState())}\n\n`);
    screens.add(response);
    request.on("close", () => screens.delete(response));
    return;
  }
  if (url.pathname === "/health") { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify({ status: "ok" })); return; }
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = normalize(join(publicDir, requested));
  if (!file.startsWith(publicDir)) { response.writeHead(403); response.end("Forbidden"); return; }
  try {
    const body = await readFile(file);
    const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
    response.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" }); response.end(body);
  } catch { response.writeHead(404); response.end("Not found"); }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
server.on("upgrade", (request, socket, head) => {
  if (new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).pathname !== "/ws") { socket.destroy(); return; }
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
});
wss.on("connection", (socket) => {
  socket.on("message", (data) => { void handle(socket, data).catch(() => privateError(socket, "No se pudo procesar el mensaje.")); });
  socket.on("close", () => {
    for (const [id, value] of participants) if (value.socket === socket) { participants.delete(id); publishState(); break; }
  });
});

server.listen(port, () => console.log(`TP4 disponible en http://localhost:${port}`));
