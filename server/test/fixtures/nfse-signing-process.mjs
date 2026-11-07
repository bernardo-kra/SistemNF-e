// Generic lifecycle fixture only. Never receives real credentials.
import { writeSync } from "node:fs";

process.once("message", () => {
  const mode = process.argv[2];
  const lifecycleResult = {
    ok: true,
    result: {
      id: "DPS" + "1".repeat(42), state: "signed_offline", profile: "experimental-rsa-sha256-c14n-v1",
      environment: "production-restricted", structurallyValid: true, cryptographicSignatureValid: true,
      readyForSubmission: false, officialProfileConfirmed: false, trustChainVerified: false, revocationChecked: false,
      xml: "<DPS/>", verifiedInfDpsXml: "<infDPS/>", certificateFingerprint256: "a".repeat(64), pendingChecks: [],
    },
  }; // Deliberately only an IPC lifecycle fixture; not a cryptographic verification.
  if (mode === "success-hang" || mode === "success-crash" || mode === "duplicate") {
    process.send(lifecycleResult, () => {
      if (mode === "success-crash") process.exit(7);
      if (mode === "duplicate") process.send(lifecycleResult);
      setInterval(() => {}, 1000);
    });
    return;
  }
  if (mode === "busy") {
    writeSync(4, "ready");
    while (true) { /* Deliberately block the child, never the parent. */ }
  }
  if (mode === "disconnect") {
    process.disconnect();
    setInterval(() => {}, 1000);
    return;
  }
  if (mode === "crash") process.exit(7);
  if (mode === "malformed") {
    process.send({ ok: true, result: { readyForSubmission: true } });
    return;
  }
  if (mode === "private-error") {
    process.send({ ok: false, code: "GENERIC_PRIVATE_PASSWORD" });
    return;
  }
  process.send({ ok: false }, () => process.disconnect());
});
