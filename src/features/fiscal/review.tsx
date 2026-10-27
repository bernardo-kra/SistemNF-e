"use client";

import Link from "@/components/demo-link";
import { useState } from "react";
import { ArrowLeft, Pencil, Save, Wrench } from "lucide-react";
import { useDemo } from "@/lib/demo-store";
import { productIssues, serviceIssues } from "@/lib/fiscal/engine";
import type { Product } from "@/lib/domain";
import {
  Badge,
  Field,
  FormActions,
  FormError,
  Modal,
  PageHeader,
  Panel,
} from "@/components/ui";

export function FiscalReviewPage() {
  const { state, saveProduct, saveServiceFiscal } = useDemo();
  const [editing, setEditing] = useState<Product | null>(null);
  const [error, setError] = useState("");
  const service = state.serviceFiscal;
  const pendingServices = serviceIssues(service);
  return (
    <>
      <Link className="back-link" href="/fiscal/">
        <ArrowLeft size={16} />
        Voltar para documentos fiscais
      </Link>
      <PageHeader
        eyebrow="CADASTRO ANTES DA EMISSÃO"
        title="Revisão fiscal de cadastros"
        description="Confira dados declarados para o fluxo simulado. Não há consulta de classificação tributária."
      />
      <div className="notice notice-info">
        Os códigos são informados por você. Formato válido não confirma NCM,
        CFOP, CST/CSOSN, CEST ou tributação corretos. Não há cálculo de impostos
        nesta etapa.
      </div>
      <Panel
        title="Produtos e perfil da operação de saída"
        subtitle="Não copiamos automaticamente o tratamento tributário da nota de compra."
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>PRODUTO</th>
                <th>NCM</th>
                <th>CFOP DECLARADO</th>
                <th>PREENCHIMENTO</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {state.products.map((product) => {
                const pending = productIssues(product);
                return (
                  <tr key={product.id}>
                    <td>
                      <div className="stack-cell">
                        <strong>{product.name}</strong>
                        <small>{product.sku}</small>
                      </div>
                    </td>
                    <td>{product.ncm || "Não informado"}</td>
                    <td>{product.fiscal?.cfop || "Não informado"}</td>
                    <td>
                      <Badge tone={pending.length ? "warning" : "success"}>
                        {pending.length
                          ? `${pending.length} pendências`
                          : "Completo · a validar"}
                      </Badge>
                    </td>
                    <td>
                      <button
                        className="button button-secondary button-small"
                        aria-label={`Revisar fiscal de ${product.sku}`}
                        onClick={() => {
                          setEditing(product);
                          setError("");
                        }}
                      >
                        <Pencil size={14} />
                        Revisar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="fiscal-service-panel">
        <Panel
          title="Perfil de serviço da demonstração"
          subtitle="Um perfil simplificado para testar o fluxo. O catálogo de serviços por atividade será ampliado."
        >
          <form
            className="fiscal-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              saveServiceFiscal({
                description: String(form.get("description") || "").trim(),
                serviceCode: String(form.get("serviceCode") || "").trim(),
                municipalCode: String(form.get("municipalCode") || "").trim(),
                ibsCbsClass: String(form.get("ibsCbsClass") || "").trim(),
              });
            }}
          >
            <div className="form-grid">
              <Field label="Descrição fiscal do serviço" className="full">
                <input
                  name="description"
                  maxLength={160}
                  defaultValue={service.description}
                />
              </Field>
              <Field label="Código do serviço (a revisar)">
                <input
                  name="serviceCode"
                  maxLength={30}
                  defaultValue={service.serviceCode}
                  placeholder="Conforme atividade e padrão aplicável"
                />
              </Field>
              <Field label="Código municipal (se aplicável)">
                <input
                  name="municipalCode"
                  maxLength={30}
                  defaultValue={service.municipalCode}
                />
              </Field>
              <Field label="Classificação IBS/CBS (se informada)">
                <input
                  name="ibsCbsClass"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  defaultValue={service.ibsCbsClass}
                  placeholder="6 dígitos · não validada"
                />
              </Field>
              <div className="form-note">
                <Wrench size={16} />A OS separa mão de obra e peças na
                preparação fiscal.
              </div>
            </div>
            <div className="form-actions">
              <Badge tone={pendingServices.length ? "warning" : "success"}>
                {pendingServices.length
                  ? `${pendingServices.length} pendências`
                  : "Preenchido · a validar"}
              </Badge>
              <button type="submit" className="button button-primary">
                <Save size={16} />
                Salvar perfil de serviço
              </button>
            </div>
          </form>
        </Panel>
      </div>
      {editing && (
        <Modal
          title={`Revisão fiscal · ${editing.sku}`}
          description={editing.name}
          onClose={() => setEditing(null)}
          wide
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              try {
                saveProduct({
                  ...editing,
                  ncm: String(form.get("ncm") || "").trim(),
                  fiscal: {
                    origin: String(form.get("origin") || ""),
                    cfop: String(form.get("cfop") || "").trim(),
                    taxSituation: String(form.get("taxSituation") || "").trim(),
                    cest: String(form.get("cest") || "").trim(),
                    ibsCbsClass: String(form.get("ibsCbsClass") || "").trim(),
                  },
                });
                setEditing(null);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <div className="notice notice-warning">
              Perfil simplificado de uma operação. Não substitui a
              parametrização por regime, destinatário, UF e vigência.
            </div>
            <div className="form-grid">
              <Field label="NCM">
                <input
                  name="ncm"
                  maxLength={8}
                  pattern="[0-9]{8}"
                  defaultValue={editing.ncm}
                />
              </Field>
              <Field label="Código de origem">
                <select
                  name="origin"
                  defaultValue={editing.fiscal?.origin || ""}
                >
                  <option value="">A confirmar</option>
                  {Array.from({ length: 9 }, (_, i) => (
                    <option value={i} key={i}>
                      {i} · código declarado
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="CFOP da saída">
                <input
                  name="cfop"
                  maxLength={4}
                  pattern="[0-9]{4}"
                  defaultValue={editing.fiscal?.cfop || ""}
                />
              </Field>
              <Field label="CST / CSOSN declarado">
                <input
                  name="taxSituation"
                  maxLength={3}
                  pattern="[0-9]{2,3}"
                  defaultValue={editing.fiscal?.taxSituation || ""}
                />
              </Field>
              <Field label="CEST (se aplicável)">
                <input
                  name="cest"
                  maxLength={7}
                  pattern="[0-9]{7}"
                  defaultValue={editing.fiscal?.cest || ""}
                />
              </Field>
              <Field label="Classificação IBS/CBS (se informada)">
                <input
                  name="ibsCbsClass"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  defaultValue={editing.fiscal?.ibsCbsClass || ""}
                />
              </Field>
            </div>
            <FormError message={error} />
            <FormActions
              onClose={() => setEditing(null)}
              label="Salvar dados declarados"
            />
          </form>
        </Modal>
      )}
    </>
  );
}
