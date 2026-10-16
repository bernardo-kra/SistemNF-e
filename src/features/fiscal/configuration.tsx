"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  CircleAlert,
  Save,
  ShieldCheck,
} from "lucide-react";
import { useDemo } from "@/lib/demo-store";
import { companyIssues } from "@/lib/fiscal/engine";
import { regimeLabels } from "@/lib/fiscal/defaults";
import type { TaxRegime } from "@/lib/fiscal/types";
import { AddressFields, readAddress } from "@/components/fiscal-fields";
import { Badge, Field, FormError, PageHeader, Panel } from "@/components/ui";

export function FiscalConfigurationPage() {
  const { state, saveFiscalProfile } = useDemo();
  const [error, setError] = useState("");
  const profile = state.fiscalProfile;
  const issues = companyIssues(profile);
  return (
    <>
      <Link className="back-link" href="/fiscal/">
        <ArrowLeft size={16} />
        Voltar para documentos fiscais
      </Link>
      <PageHeader
        eyebrow="BASE DA OPERAÇÃO FISCAL"
        title="Configuração fiscal"
        description="Dados do emitente para preparar a demonstração. Use informações fictícias."
      />
      <div className="notice notice-warning">
        <ShieldCheck size={19} />
        <div>
          <strong>Ambiente exclusivamente simulado</strong>
          <p>
            Salvar estes dados não habilita emissão. Não informe certificados,
            senhas ou tokens reais.
          </p>
        </div>
      </div>
      <div className="fiscal-setup-grid">
        <Panel
          title="Empresa emissora"
          subtitle="É possível salvar um preenchimento parcial e completá-lo depois."
        >
          <form
            className="fiscal-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              try {
                saveFiscalProfile({
                  environment: "simulation",
                  legalName: String(form.get("legalName") || "").trim(),
                  cnpj: String(form.get("cnpj") || "").trim(),
                  stateRegistration: String(
                    form.get("stateRegistration") || "",
                  ).trim(),
                  municipalRegistration: String(
                    form.get("municipalRegistration") || "",
                  ).trim(),
                  regime: String(form.get("regime")) as TaxRegime,
                  address: readAddress(form),
                });
                setError("");
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <div className="form-grid">
              <Field label="Razão social" className="full">
                <input
                  name="legalName"
                  defaultValue={profile.legalName}
                  maxLength={120}
                />
              </Field>
              <Field label="CNPJ do emitente">
                <input
                  name="cnpj"
                  defaultValue={profile.cnpj}
                  maxLength={18}
                  placeholder="Numérico ou alfanumérico"
                  autoCapitalize="characters"
                />
              </Field>
              <Field label="Regime tributário">
                <select name="regime" defaultValue={profile.regime}>
                  {Object.entries(regimeLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Inscrição estadual / condição declarada">
                <input
                  name="stateRegistration"
                  defaultValue={profile.stateRegistration}
                  maxLength={30}
                  placeholder="Conferir com o responsável fiscal"
                />
              </Field>
              <Field label="Inscrição municipal">
                <input
                  name="municipalRegistration"
                  defaultValue={profile.municipalRegistration}
                  maxLength={30}
                />
              </Field>
              <div className="form-section-title full">
                <Building2 size={17} />
                Endereço do estabelecimento
              </div>
              <AddressFields address={profile.address} />
            </div>
            <FormError message={error} />
            <div className="form-actions">
              <button className="button button-primary" type="submit">
                <Save size={16} />
                Salvar configuração
              </button>
            </div>
          </form>
        </Panel>
        <div className="detail-aside">
          <Panel title="Conferência de preenchimento">
            <div className="detail-card-content">
              <Badge tone={issues.length ? "warning" : "success"}>
                {issues.length
                  ? `${issues.length} pendências locais`
                  : "Preenchimento completo"}
              </Badge>
              <ul className="fiscal-checklist">
                {issues.length ? (
                  issues.map((item) => (
                    <li key={item.code}>
                      <CircleAlert size={15} />
                      <span>{item.label}</span>
                    </li>
                  ))
                ) : (
                  <li>
                    <CheckCircle2 size={17} />
                    <span>
                      Os campos exigidos por esta demonstração foram
                      preenchidos. A validação fiscal de produção continua
                      pendente.
                    </span>
                  </li>
                )}
              </ul>
            </div>
          </Panel>
          <Panel title="Integração de produção">
            <div className="integration-checklist">
              {[
                "Município/UF e operação piloto confirmados",
                "Enquadramentos revisados pelo responsável fiscal",
                "Credenciamento e certificado/credenciais",
                "Provedor e homologação fiscal",
                "Cálculo de tributos e leiautes vigentes",
              ].map((label) => (
                <div key={label}>
                  <Badge tone="neutral">Pendente</Badge>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
