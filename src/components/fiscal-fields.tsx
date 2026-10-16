"use client";

import { Field } from "./ui";
import { emptyAddress, states } from "@/lib/fiscal/defaults";
import type { FiscalAddress } from "@/lib/fiscal/types";

export function readAddress(form: FormData, prefix = "address"): FiscalAddress {
  return Object.fromEntries(
    Object.keys(emptyAddress).map((key) => [
      key,
      String(form.get(`${prefix}.${key}`) || "").trim(),
    ]),
  ) as unknown as FiscalAddress;
}

export function AddressFields({
  address = emptyAddress,
  prefix = "address",
}: {
  address?: FiscalAddress;
  prefix?: string;
}) {
  return (
    <>
      <Field label="Logradouro" className="full">
        <input
          name={`${prefix}.street`}
          defaultValue={address.street}
          maxLength={120}
          placeholder="Rua, avenida…"
        />
      </Field>
      <Field label="Número">
        <input
          name={`${prefix}.number`}
          defaultValue={address.number}
          maxLength={20}
        />
      </Field>
      <Field label="Bairro">
        <input
          name={`${prefix}.district`}
          defaultValue={address.district}
          maxLength={80}
        />
      </Field>
      <Field label="Município">
        <input
          name={`${prefix}.city`}
          defaultValue={address.city}
          maxLength={80}
        />
      </Field>
      <Field label="UF">
        <select name={`${prefix}.state`} defaultValue={address.state}>
          <option value="">Selecionar UF</option>
          {states.map((uf) => (
            <option key={uf}>{uf}</option>
          ))}
        </select>
      </Field>
      <Field label="CEP">
        <input
          name={`${prefix}.zipCode`}
          defaultValue={address.zipCode}
          maxLength={9}
          inputMode="numeric"
          placeholder="Somente números"
        />
      </Field>
      <Field label="Código IBGE do município">
        <input
          name={`${prefix}.municipalityCode`}
          defaultValue={address.municipalityCode}
          maxLength={7}
          inputMode="numeric"
          placeholder="7 dígitos"
        />
      </Field>
    </>
  );
}
