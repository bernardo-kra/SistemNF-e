import type { SimulationOutcome } from "./types";

export interface FiscalSimulationAdapter {
  process(outcome: SimulationOutcome): Promise<SimulationOutcome>;
}

// Adaptador exclusivamente local. Não recebe credenciais e não chama serviços fiscais.
export const simulationAdapter: FiscalSimulationAdapter = {
  async process(outcome) {
    await new Promise((resolve) => setTimeout(resolve, 450));
    return outcome;
  },
};
