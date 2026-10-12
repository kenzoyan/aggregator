// Public, verified pilot identities. No personal holdings or local account routes.
export const nordeaEuropeanIndexSource = {
  isin: "FI4000010558",
  name: "Nordea Eurooppa Indeksi Select B",
  currency: "EUR",
  shareClass: "B (Accumulation)",
  identityUrl: "https://www.nordeafunds.com/fi/rahastot/nordea-eurooppa-indeksi-select-b",
} as const;

export const danskeEuropeanEquitySource = {
  isin: "FI0008802988",
  name: "Eurooppa Osake K",
  currency: "EUR",
  shareClass: "K (Accumulation)",
  identityUrl: "https://www.danskeinvest.fi/w/show_funds.product?p_nFund=2443&p_nFundgroup=59&p_nId=1432",
  route: { fund: "2443", fundGroup: "59", siteId: "1432" },
} as const;
