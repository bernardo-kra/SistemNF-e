import { gzipSync } from "node:zlib";
import { validateSignedDpsStructure } from "./nfse-dps-validation.js";
import { NfseNationalTransport, NfseNationalTransportError, type Credentials, type Options } from "./nfse-national-transport.js";

/** Internal prototype, not wired to HTTP routes/custody. Envelope contract remains unconfirmed. */
export class NfseNationalTestClient {
  #transport: NfseNationalTransport;
  constructor(credentials: Credentials, options: Options = {}) { this.#transport = new NfseNationalTransport(credentials, options); }
  async submitDps(xml: string) {
    if (typeof xml !== "string" || !xml.trim() || Buffer.byteLength(xml) > 160 * 1024) throw new NfseNationalTransportError("INVALID_DPS_PAYLOAD");
    try { validateSignedDpsStructure(xml); }
    catch { throw new NfseNationalTransportError("INVALID_DPS_PAYLOAD"); }
    // Structural validation does not confirm signature, trust, fiscal rules or authorization.
    const payload = Buffer.from(JSON.stringify({ dpsXmlGZipB64: gzipSync(Buffer.from(xml)).toString("base64") }));
    return this.#transport.exchange("POST", "/nfse", payload);
  }
  async getDps(id: string) {
    if (typeof id !== "string" || !/^DPS\d{7}[12][A-Z0-9]{12}\d{22}$/.test(id)) throw new NfseNationalTransportError("INVALID_DPS_IDENTIFIER");
    return this.#transport.exchange("GET", "/dps/" + id);
  }
  async getNfse(key: string) {
    if (typeof key !== "string" || !/^\d{6}[A-Z0-9]{14}\d{30}$/.test(key)) throw new NfseNationalTransportError("INVALID_NFSE_KEY");
    return this.#transport.exchange("GET", "/nfse/" + key);
  }
  close() { this.#transport.close(); }
}
