import { NfseNationalTransport, NfseNationalTransportError, type Credentials, type Options } from "./nfse-national-transport.js";
export { NfseNationalTransportError as NfseNationalReadError } from "./nfse-national-transport.js";

// Compatibility facade: remains read-only, with no submission method.
export class NfseNationalReadClient {
  #transport: NfseNationalTransport;
  #closed = false;
  constructor(credentials: Credentials, options: Options = {}) { this.#transport = new NfseNationalTransport(credentials, options); }
  async getMunicipalAgreement(code: string) {
    if (this.#closed) throw new NfseNationalTransportError("OFFICIAL_CLIENT_CLOSED");
    if (typeof code !== "string" || !/^\d{7}$/.test(code)) throw new NfseNationalTransportError("INVALID_MUNICIPALITY");
    return (await this.#transport.exchange("GET", "/parametros_municipais/" + code + "/convenio")).payload;
  }
  close() { this.#closed = true; this.#transport.close(); }
}
