"use client";

import Link from "@/components/demo-link";
import { useState } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  CircleHelp,
  Download,
  Handshake,
  Layers3,
  Mail,
  Plus,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { useDemo, uid } from "@/lib/demo-store";
import {
  Badge,
  Field,
  FormActions,
  Modal,
  PageHeader,
  Panel,
} from "@/components/ui";

export function SettingsPage() {
  const { state, reset, notify, storageAvailable } = useDemo();
  const [confirm, setConfirm] = useState(false);
  const downloadOriginal = () => {
    try {
      const raw = window.localStorage.getItem("sistem:prototype:v1");
      if (raw === null) {
        notify("Nenhum arquivo local original foi encontrado.");
        return;
      }
      const url = URL.createObjectURL(
        new Blob([raw], { type: "application/json;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "sistem-original-local.json";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      notify("Cópia original exportada, sem alterar os dados locais.");
    } catch {
      notify(
        "Não foi possível ler o arquivo local. Verifique as permissões do navegador.",
      );
    }
  };
  const download = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "sistem-dados-demonstracao.json";
    anchor.click();
    URL.revokeObjectURL(url);
    notify("Arquivo de demonstração exportado.");
  };
  return (
    <>
      <PageHeader
        eyebrow="SUA EMPRESA NA PLATAFORMA"
        title="Configurações"
        description="Conheça os limites desta etapa e gerencie os dados de demonstração."
      />
      <div className="settings-grid">
        <Panel title="Equipe e acessos conectados">
          <div className="detail-card-content">
            <p className="body-copy">Entre com sua conta individual para administrar funcionários e permissões do ambiente conectado. Os dados desta demonstração continuam independentes.</p>
            <Link className="button button-primary" href="/acessos/">
              <ShieldCheck size={16} /> Gerenciar equipe e acessos
            </Link>
            <Link className="button button-secondary" href="/operacao/">Abrir operação conectada</Link>
          </div>
        </Panel>
        {!storageAvailable && (
          <Panel
            title="Recuperar dados locais"
            subtitle="A gravação está bloqueada ou indisponível."
          >
            <div className="detail-card-content">
              <p className="body-copy">
                Exporte uma cópia exata do arquivo local antes de restaurar os
                exemplos. Se a recuperação falhou, seus dados originais foram
                mantidos; a exportação normal da demonstração contém somente o
                estado que pôde ser aberto.
              </p>
              <button
                className="button button-secondary"
                onClick={downloadOriginal}
              >
                <Download size={16} />
                Exportar arquivo local original
              </button>
            </div>
          </Panel>
        )}
        <Panel title="Empresa de demonstração">
          <div className="detail-card-content">
            <div className="equipment-heading">
              <span className="company-icon large">
                <Building2 size={28} />
              </span>
              <div>
                <h3>Eletrônica Central</h3>
                <p className="muted">Loja de eletrônicos e assistência de TI</p>
              </div>
            </div>
            <dl className="details-list">
              <div>
                <dt>Unidade</dt>
                <dd>Principal</dd>
              </div>
              <div>
                <dt>Ambiente</dt>
                <dd>
                  <Badge tone="info">Demonstração</Badge>
                </dd>
              </div>
              <div>
                <dt>Usuário</dt>
                <dd>André Martins</dd>
              </div>
              <div>
                <dt>Perfil</dt>
                <dd>Administrador demonstrativo</dd>
              </div>
            </dl>
            <Link
              className="button button-secondary"
              href="/fiscal/configuracao/"
            >
              Configurar dados fiscais demonstrativos
              <ArrowRight size={16} />
            </Link>
          </div>
        </Panel>
        <Panel title="O que este protótipo permite">
          <div className="feature-checks">
            {[
              "Cadastrar clientes e produtos",
              "Percorrer as etapas da ordem de serviço",
              "Testar reserva e entrega de produtos sem série",
              "Registrar recebimentos manuais de OS",
              "Conferir XML e criar cadastros",
            ].map((item) => (
              <div key={item}>
                <Check size={18} />
                {item}
              </div>
            ))}
          </div>
        </Panel>
        <Panel
          title="Dados neste navegador"
          subtitle="Use apenas informações fictícias."
        >
          <div className="detail-card-content">
            <p className="body-copy">
              Os registros ficam no armazenamento local deste navegador. Não são
              compartilhados entre computadores e podem ser apagados pelo
              navegador.
            </p>
            <div className="settings-actions">
              <button className="button button-secondary" onClick={download}>
                <Download size={16} />
                Exportar demonstração
              </button>
              <button
                className="button button-danger"
                onClick={() => setConfirm(true)}
              >
                <RotateCcw size={16} />
                Restaurar exemplos
              </button>
            </div>
          </div>
        </Panel>
        <Panel title="Próximas integrações">
          <div className="detail-card-content">
            <p className="body-copy">
              Esta demonstração usa exemplos locais. O sistema principal já tem
              login real, permissões e dados compartilhados por empresa.
              Emissão fiscal e assinatura continuam pendentes.
            </p>
            <Link className="text-link" href="/entrar/">
              Acessar o sistema real <ArrowRight size={15} />
            </Link>
          </div>
        </Panel>
      </div>
      {confirm && (
        <Modal
          title="Restaurar os dados de exemplo?"
          description="Seus cadastros e alterações locais serão substituídos pelos exemplos iniciais."
          onClose={() => setConfirm(false)}
        >
          <div className="form-actions">
            <button
              className="button button-secondary"
              onClick={() => setConfirm(false)}
            >
              Manter alterações
            </button>
            <button
              className="button button-danger"
              onClick={() => {
                reset();
                setConfirm(false);
              }}
            >
              Restaurar exemplos
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

interface Partner {
  id: string;
  name: string;
  specialty: string;
  contact: string;
}
export function PartnersPage() {
  const { notify } = useDemo();
  const [partners, setPartners] = useState<Partner[]>([
    {
      id: "partner1",
      name: "Circuito Lab",
      specialty: "Reparo de placas e microsoldagem",
      contact: "circuito@example.com",
    },
    {
      id: "partner2",
      name: "Rede Certa TI",
      specialty: "Redes e infraestrutura",
      contact: "rede@example.com",
    },
  ]);
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        eyebrow="PARCERIAS QUE SOMAM"
        title="Empresas parceiras"
        description="Contatos de empresas independentes, sem acesso aos dados da sua loja."
        action={
          <button
            className="button button-primary"
            onClick={() => setCreating(true)}
          >
            <Plus size={18} />
            Novo parceiro
          </button>
        }
      />
      <div className="partner-grid">
        {partners.map((p) => (
          <section className="panel partner-card" key={p.id}>
            <span className="partner-icon">
              <Handshake size={29} />
            </span>
            <Badge tone="neutral">Empresa independente</Badge>
            <h2>{p.name}</h2>
            <p>{p.specialty}</p>
            <span className="partner-contact">
              <Mail size={16} />
              {p.contact}
            </span>
          </section>
        ))}
      </div>
      <div className="notice notice-info">
        Os parceiros adicionados nesta tela ficam somente enquanto ela estiver
        aberta. Encaminhamento de equipamentos, repasses e acesso de parceiro
        serão implementados em outra etapa.
      </div>
      {creating && (
        <Modal
          title="Novo parceiro"
          description="Cadastrar não concede acesso à plataforma."
          onClose={() => setCreating(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setPartners((list) => [
                ...list,
                {
                  id: uid(),
                  name: String(f.get("name")).trim(),
                  specialty: String(f.get("specialty")).trim(),
                  contact: String(f.get("contact")).trim(),
                },
              ]);
              setCreating(false);
              notify("Parceiro adicionado nesta tela de demonstração.");
            }}
          >
            <Field label="Nome da empresa *">
              <input required name="name" maxLength={100} />
            </Field>
            <Field label="Especialidade *">
              <input required name="specialty" maxLength={120} />
            </Field>
            <Field label="E-mail de contato">
              <input type="email" name="contact" maxLength={120} />
            </Field>
            <FormActions
              onClose={() => setCreating(false)}
              label="Adicionar parceiro"
            />
          </form>
        </Modal>
      )}
    </>
  );
}

export function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-story">
        <Link className="brand brand-light" href="/">
          <span className="brand-mark">
            <Layers3 size={25} />
          </span>
          <span>sistem.</span>
        </Link>
        <div className="login-copy">
          <span className="welcome-kicker">GESTÃO E ASSISTÊNCIA</span>
          <h1>
            Mais controle.
            <br />
            Mais espaço
            <br />
            para crescer<span>.</span>
          </h1>
          <p>
            Da primeira venda ao último teste.
            <br />
            Seu negócio inteiro, conectado.
          </p>
          <div className="login-features">
            <span>
              <Check size={17} />
              Vendas e estoque integrados
            </span>
            <span>
              <Check size={17} />
              Assistência do início ao fim
            </span>
            <span>
              <Check size={17} />
              Decisões com mais clareza
            </span>
          </div>
        </div>
        <small>Uma nova forma de cuidar da sua operação.</small>
      </section>
      <section className="login-form-panel">
        <div className="login-form-content">
          <Badge tone="info">Protótipo navegável</Badge>
          <h2>Bom ter você por aqui.</h2>
          <p>Entre na demonstração e conheça seu espaço de trabalho.</p>
          <form action="/">
            <Field label="E-mail de demonstração">
              <input
                type="email"
                name="email"
                defaultValue="andre@example.com"
                required
                autoComplete="off"
              />
            </Field>
            <div className="login-demo-note">
              <ShieldCheck size={20} />
              <p>
                Este acesso é demonstrativo. Não use sua senha real; nenhuma
                autenticação será realizada.
              </p>
            </div>
            <button
              className="button button-primary login-submit"
              type="submit"
            >
              Explorar a plataforma <ArrowRight size={17} />
            </button>
          </form>
          <p className="login-footer">Eletrônica Central · Unidade principal</p>
        </div>
      </section>
    </main>
  );
}
