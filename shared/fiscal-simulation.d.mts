export type SimulationScenario = "accepted" | "rejected" | "unknown_after_accept";
export type SimulationState = "simulated_accepted" | "simulated_rejected" | "simulated_unknown";
export const simulationScenarios: Readonly<Record<SimulationScenario,string>>;
export const simulationStates: Readonly<Record<SimulationState,string>>;
export type FiscalSimulation = {
  id:string;tenantId:string;reference:string;environment:"simulation";provider:"local_simulator";model:"NFS-e";officialAuthorization:false;
  state:SimulationState;version:number;scenario:SimulationScenario;
  source:{orderId:string;orderVersion:number;orderNumber:string;customerName:string;amountCents:number};
  createdBy:string;createdAt:string;updatedAt:string;
  events:{version:number;kind:"created"|"reconciled";actorId:string;actorName:string;at:string}[];
};
export type SimulationPage = {tenantId:string;items:FiscalSimulation[];total:number;limit:number;offset:number};
