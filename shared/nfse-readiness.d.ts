export type NfseReadiness = {
  tenantId: string;
  environment: "production-restricted";
  readyForSubmission: false;
  setup: { profileComplete: boolean; certificateRegistered: boolean; certificateCurrentForIssuer: boolean; storageConfigured: boolean };
  technicalBlockers: string[];
};
