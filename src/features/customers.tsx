"use client";

import { useEffect, useState } from "react";
import {
  Plus,
  Pencil,
  UsersRound,
  Mail,
  Building2,
  UserRound,
} from "lucide-react";
import { useDemo, uid } from "@/lib/demo-store";
import { matches, type Customer } from "@/lib/domain";
import { AddressFields, readAddress } from "@/components/fiscal-fields";
import {
  Avatar,
  Badge,
  EmptyState,
  Field,
  FormActions,
  Modal,
  FormError,
  PageHeader,
  PaginationInfo,
  SearchField,
} from "@/components/ui";

export function CustomersPage() {
  const { state, saveCustomer } = useDemo();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Customer | null>(null);
  const openNew = () =>
    setEditing({
      id: uid(),
      name: "",
      email: "",
      phone: "",
      type: "Pessoa física",
    });
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setQuery(params.get("q") || "");
    if (params.has("novo")) openNew();
  }, []);
  const filtered = state.customers.filter(
    (c) =>
      matches(`${c.name} ${c.email} ${c.phone}`, query) &&
      (!type || c.type === type),
  );
  return (
    <>
      <PageHeader
        eyebrow="RELACIONAMENTOS QUE CONTINUAM"
        title="Clientes"
        description="Cada atendimento começa com uma conexão."
        action={
          <button className="button button-primary" onClick={openNew}>
            <Plus size={18} />
            Novo cliente
          </button>
        }
      />
      <div className="summary-strip">
        <div>
          <span className="summary-icon blue">
            <UsersRound size={20} />
          </span>
          <span>
            <small>Total de clientes</small>
            <strong>{state.customers.length}</strong>
          </span>
        </div>
        <div>
          <span className="summary-icon purple">
            <UserRound size={20} />
          </span>
          <span>
            <small>Pessoas físicas</small>
            <strong>
              {state.customers.filter((c) => c.type === "Pessoa física").length}
            </strong>
          </span>
        </div>
        <div>
          <span className="summary-icon green">
            <Building2 size={20} />
          </span>
          <span>
            <small>Empresas atendidas</small>
            <strong>
              {state.customers.filter((c) => c.type === "Empresa").length}
            </strong>
          </span>
        </div>
      </div>
      <section className="panel">
        <div className="list-toolbar">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Buscar por nome, e-mail ou telefone…"
          />
          <label className="sr-only" htmlFor="customer-type">
            Tipo de cliente
          </label>
          <select
            id="customer-type"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">Todos os clientes</option>
            <option>Pessoa física</option>
            <option>Empresa</option>
          </select>
        </div>
        {filtered.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>CLIENTE</th>
                  <th>CONTATO</th>
                  <th>TIPO</th>
                  <th>ORDENS DE SERVIÇO</th>
                  <th>
                    <span className="sr-only">Editar</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div className="person-cell">
                        <Avatar name={c.name} />
                        <span>
                          <strong>{c.name}</strong>
                          <small>Cliente cadastrado</small>
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="stack-cell">
                        <span>{c.email || "Sem e-mail informado"}</span>
                        <small>{c.phone || "Sem telefone informado"}</small>
                      </div>
                    </td>
                    <td>
                      <Badge tone={c.type === "Empresa" ? "info" : "neutral"}>
                        {c.type}
                      </Badge>
                    </td>
                    <td>
                      {state.orders.filter((o) => o.customerId === c.id).length}{" "}
                      atendimentos
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Editar ${c.name}`}
                        onClick={() => setEditing(c)}
                      >
                        <Pencil size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState />
        )}
        <PaginationInfo count={filtered.length} noun="clientes" />
      </section>
      {editing && (
        <Modal
          title={
            state.customers.some((c) => c.id === editing.id)
              ? "Editar cliente"
              : "Novo cliente"
          }
          description="Comece com as informações necessárias para o atendimento."
          onClose={() => setEditing(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                saveCustomer({
                  ...editing,
                  id: editing.id,
                  name: String(f.get("name")).trim(),
                  email: String(f.get("email")).trim(),
                  phone: String(f.get("phone")).trim(),
                  type: String(f.get("type")) as Customer["type"],
                  document: String(f.get("document") || "").trim(),
                  fiscalAddress: readAddress(f),
                });
                setEditing(null);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <div className="form-grid">
              <Field label="Nome / razão social *" className="full">
                <input
                  name="name"
                  required
                  maxLength={100}
                  defaultValue={editing.name}
                />
              </Field>
              <Field label="Tipo de cliente">
                <select name="type" defaultValue={editing.type}>
                  <option>Pessoa física</option>
                  <option>Empresa</option>
                </select>
              </Field>
              <Field label="Telefone">
                <input
                  name="phone"
                  type="tel"
                  maxLength={25}
                  defaultValue={editing.phone}
                />
              </Field>
              <Field label="E-mail" className="full">
                <input
                  name="email"
                  type="email"
                  maxLength={120}
                  defaultValue={editing.email}
                />
              </Field>
            </div>
            <details className="fiscal-form-details">
              <summary>
                Dados fiscais e endereço · opcionais no cadastro
              </summary>
              <p>
                A preparação fiscal aponta quando estes dados forem necessários
                para a simulação. Não consultamos situação cadastral.
              </p>
              <div className="form-grid">
                <Field label="CPF / CNPJ" className="full">
                  <input
                    name="document"
                    defaultValue={editing.document || ""}
                    maxLength={18}
                    placeholder="CNPJ também aceita letras"
                    autoCapitalize="characters"
                  />
                </Field>
                <AddressFields address={editing.fiscalAddress} />
              </div>
            </details>
            <div className="form-note">
              <Mail size={16} />
              Nenhuma mensagem será enviada por este protótipo.
            </div>
            <FormError message={error} />
            <FormActions
              onClose={() => setEditing(null)}
              label="Salvar cliente"
            />
          </form>
        </Modal>
      )}
    </>
  );
}
