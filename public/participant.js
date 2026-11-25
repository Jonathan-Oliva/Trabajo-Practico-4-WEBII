const login = document.querySelector("#login");
const app = document.querySelector("#app");
const people = document.querySelector("#people");
const products = document.querySelector("#products");
const connection = document.querySelector("#connection");
const feedback = document.querySelector("#feedback");
const socket = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`);
window.socket = socket;
let myId = "";
let state = { participants: [], products: [] };

socket.addEventListener("open", () => { connection.textContent = "Conectado"; });
socket.addEventListener("close", () => { connection.textContent = "Desconectado · recargá para volver"; });
socket.addEventListener("message", ({ data }) => {
  let message;
  try { message = JSON.parse(data); } catch { return; }
  if (message.type === "joined") { myId = message.participantId; login.hidden = true; app.hidden = false; render(message.state); }
  if (message.type === "state") render(message.state);
  if (message.type === "error") {
    feedback.textContent = message.message;
    document.querySelector("#propose-button").disabled = false;
    document.querySelector("#propose-button").textContent = "Consultar catálogo";
  }
  if (message.type === "proposalResult") {
    const added = message.added.length ? `Agregados: ${message.added.join(", ")}.` : "No se agregó ningún producto.";
    const failed = message.failures.map((item) => `ID ${item.id}: ${item.reason}`).join("\n");
    feedback.textContent = [added, failed].filter(Boolean).join("\n");
    document.querySelector("#propose-button").disabled = false;
    document.querySelector("#propose-button").textContent = "Consultar catálogo";
  }
});

document.querySelector("#join-form").addEventListener("submit", (event) => {
  event.preventDefault();
  socket.send(JSON.stringify({ type: "join", name: document.querySelector("#name").value }));
});
document.querySelector("#proposal-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const ids = document.querySelector("#ids").value.split(",").map((id) => Number(id.trim()));
  const button = document.querySelector("#propose-button");
  button.disabled = true; button.textContent = "Consultando…"; feedback.textContent = "";
  socket.send(JSON.stringify({ type: "propose", productIds: ids }));
});

function render(next) {
  state = next;
  people.textContent = state.participants.length ? state.participants.map((p) => p.name).join(", ") : "Todavía no hay nadie conectado.";
  document.querySelector("#count").textContent = `${state.products.length} productos`;
  products.replaceChildren();
  if (!state.products.length) { products.innerHTML = '<div class="empty">La lista está vacía. ¡Propongan algo!</div>'; return; }
  for (const product of state.products) {
    const card = document.createElement("article"); card.className = "product";
    const image = document.createElement("img"); image.src = product.thumbnail || ""; image.alt = ""; image.loading = "lazy";
    const content = document.createElement("div"); content.className = "product-content";
    const title = document.createElement("h3"); title.textContent = product.title;
    const price = document.createElement("p"); price.className = "price"; price.textContent = `$${product.price.toFixed(2)}`;
    const proposer = state.participants.find((p) => p.id === product.proposerId)?.name ?? "participante";
    const meta = document.createElement("p"); meta.className = "product-meta"; meta.textContent = `Propuesto por ${proposer} · ${product.votes.length} votos`;
    const actions = document.createElement("div"); actions.className = "product-actions";
    const vote = document.createElement("button"); vote.textContent = product.votes.includes(myId) ? "Quitar mi voto" : "Votar"; vote.addEventListener("click", () => socket.send(JSON.stringify({ type: "vote", productId: product.id })));
    actions.append(vote);
    if (product.proposerId === myId) { const remove = document.createElement("button"); remove.className = "remove"; remove.textContent = "Quitar"; remove.addEventListener("click", () => socket.send(JSON.stringify({ type: "remove", productId: product.id }))); actions.append(remove); }
    content.append(title, price, meta, actions); card.append(image, content); products.append(card);
  }
}
