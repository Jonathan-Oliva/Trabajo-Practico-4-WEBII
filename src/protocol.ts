export interface Product {
  id: number;
  title: string;
  price: number;
  thumbnail: string;
}

export interface Participant {
  id: string;
  name: string;
}

export interface ListedProduct extends Product {
  proposerId: string;
  votes: string[];
  addedAt: number;
}

export interface PublicState {
  participants: Participant[];
  products: ListedProduct[];
}

// Participante -> servidor. `join` debe ser el primer mensaje de la conexión.
export type ClientMessage =
  | { type: "join"; name: string }
  | { type: "propose"; productIds: number[] }
  | { type: "vote"; productId: number }
  | { type: "remove"; productId: number };

// Servidor -> participante. `state` es una instantánea completa y `error` es privado.
export type ServerMessage =
  | { type: "joined"; participantId: string; state: PublicState }
  | { type: "state"; state: PublicState }
  | { type: "proposalResult"; added: number[]; failures: { id: number; reason: string }[] }
  | { type: "error"; message: string };

// SSE -> pantalla: evento `state` con PublicState serializado como JSON.
