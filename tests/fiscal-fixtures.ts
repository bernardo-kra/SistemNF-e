import { seed } from "../src/lib/seed";
import type { DemoState } from "../src/lib/domain";

// Dados de teste para conferir estrutura. Códigos e enquadramentos não são orientação tributária.
export const testAddress = {
  street: "Rua da Demonstração",
  number: "100",
  district: "Centro",
  city: "São Paulo",
  state: "SP",
  zipCode: "01001000",
  municipalityCode: "3550308",
};
export function fiscalFixture(): DemoState {
  const state = structuredClone(seed);
  state.fiscalProfile = {
    environment: "simulation",
    legalName: "Emitente fictício QA",
    cnpj: "12ABC34501DE35",
    stateRegistration: "DEMONSTRACAO",
    municipalRegistration: "DEMO",
    regime: "presumido",
    address: { ...testAddress },
  };
  state.customers = state.customers.map((customer) => ({
    ...customer,
    document: customer.type === "Empresa" ? "11222333000181" : "12345678909",
    fiscalAddress: { ...testAddress },
  }));
  state.products = state.products.map((product) => ({
    ...product,
    fiscal: {
      origin: "0",
      cfop: "5102",
      taxSituation: "00",
      cest: "",
      ibsCbsClass: "",
    },
  }));
  state.serviceFiscal = {
    description: "Serviço fictício QA",
    serviceCode: "CODIGO-DEMO",
    municipalCode: "",
    ibsCbsClass: "",
  };
  return state;
}
