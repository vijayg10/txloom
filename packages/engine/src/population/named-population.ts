import type { Consumer } from "./consumer-archetypes.js";
import type { Merchant } from "./merchants.js";

export interface NamedConsumer extends Consumer {
  name: string;
}

export interface NamedMerchant extends Merchant {
  name: string;
}
