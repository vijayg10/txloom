import type { SimulationSpec } from "@txloom/spec";
import { upiWorkedExample } from "./upi.js";
import { cardPresentWorkedExample } from "./card-present.js";
import { mobileMoneyWorkedExample } from "./mobile-money.js";
import { marketplaceWorkedExample } from "./marketplace.js";

export {
  upiWorkedExample,
  cardPresentWorkedExample,
  mobileMoneyWorkedExample,
  marketplaceWorkedExample,
};

export const WORKED_EXAMPLES: readonly {
  template_slug: string;
  name: string;
  spec: SimulationSpec;
}[] = [
  {
    template_slug: "upi-instant-payments",
    name: "UPI-style instant payments",
    spec: upiWorkedExample,
  },
  {
    template_slug: "card-present-retail",
    name: "Card-present retail",
    spec: cardPresentWorkedExample,
  },
  { template_slug: "mobile-money", name: "Mobile money", spec: mobileMoneyWorkedExample },
  {
    template_slug: "marketplace-payouts",
    name: "Marketplace payouts",
    spec: marketplaceWorkedExample,
  },
];
