const products = document.querySelector("#products");
const people = document.querySelector("#people");
const count = document.querySelector("#count");
const events = new EventSource("/events");

events.addEventListener("state", ({ data }) => {
  const state = JSON.parse(data);
  count.textContent = String(state.participants.length);
  people.textContent = state.participants.length ? state.participants.map((p) => p.name).join(" · ") : "Esperando participantes…";
  products.replaceChildren();
  if (!state.products.length) { products.innerHTML = '<div class="empty">Esperando las primeras propuestas…</div>'; return; }
  for (const product of state.products) {
    const card = document.createElement("article"); card.className = "product";
    const image = document.createElement("img"); image.src = product.thumbnail || ""; image.alt = "";
    const content = document.createElement("div"); content.className = "product-content";
    const title = document.createElement("h3"); title.textContent = product.title;
    const price = document.createElement("p"); price.className = "price"; price.textContent = `$${product.price.toFixed(2)}`;
    const meta = document.createElement("p"); meta.className = "product-meta"; meta.textContent = `${product.votes.length} ${product.votes.length === 1 ? "voto" : "votos"}`;
    content.append(title, price, meta); card.append(image, content); products.append(card);
  }
});
