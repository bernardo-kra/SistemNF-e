import type {
  CompanyFiscalProfile,
  FiscalAddress,
  ProductFiscalProfile,
  ServiceFiscalProfile,
} from "./types";

export const emptyAddress: FiscalAddress = {
  street: "",
  number: "",
  district: "",
  city: "",
  state: "",
  zipCode: "",
  municipalityCode: "",
};
export const defaultCompanyFiscal: CompanyFiscalProfile = {
  environment: "simulation",
  legalName: "Eletrônica Central · demonstração",
  cnpj: "",
  stateRegistration: "",
  municipalRegistration: "",
  regime: "unknown",
  address: { ...emptyAddress },
};
export const emptyProductFiscal: ProductFiscalProfile = {
  origin: "",
  cfop: "",
  taxSituation: "",
  cest: "",
  ibsCbsClass: "",
};
export const defaultServiceFiscal: ServiceFiscalProfile = {
  description: "Manutenção de equipamentos de TI",
  serviceCode: "",
  municipalCode: "",
  ibsCbsClass: "",
};
export const states = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
];
export const regimeLabels = {
  unknown: "A confirmar",
  mei: "MEI",
  simples: "Simples Nacional",
  presumido: "Lucro presumido",
  real: "Lucro real",
};
export const fiscalStatusLabels = {
  draft: "Rascunho",
  queued: "Na fila",
  processing: "Processando",
  authorized: "Autorizada · simulação",
  rejected: "Rejeitada · simulação",
  unknown: "Resultado desconhecido",
  cancellation_pending: "Cancelamento pendente",
  cancelled: "Cancelada · simulação",
} as const;
