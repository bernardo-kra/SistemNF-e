"use client";

import { useEffect, useState } from "react";
import { CircleAlert, Download, ShieldCheck } from "lucide-react";
import {
  Badge,
  EmptyState,
  Field,
  FormError,
  PageHeader,
  Panel,
} from "@/components/ui";
import {
  diagnosticCatalog,
  exportDiagnostics,
  filterDiagnostics,
  MAX_DIAGNOSTIC_EVENTS,
  moduleLabels,
  operationLabels,
  type DiagnosticEvent,
  type DiagnosticFilters,
  type DiagnosticLevel,
  type DiagnosticModule,
} from "@/lib/diagnostics/engine";
import {
  getBrowserRecorder,
  type DiagnosticSnapshot,
} from "@/lib/diagnostics/store";

function occurrenceDate(at: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(at));
}

export function DiagnosticsPage() {
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot | null>(null);
  const [filters, setFilters] = useState<DiagnosticFilters>({});
  const [loadError, setLoadError] = useState("");
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    try {
      const recorder = getBrowserRecorder();
      const refresh = () => setSnapshot(recorder.getSnapshot());
      const unsubscribe = recorder.subscribe(refresh);
      refresh();
      return unsubscribe;
    } catch {
      setLoadError(
        "Não foi possível abrir o diagnóstico local. Recarregue a página para tentar novamente.",
      );
    }
  }, []);

  const updateFilter = (update: Partial<DiagnosticFilters>) => {
    setFilters((current) => ({ ...current, ...update }));
    setExportError("");
  };
  let events: DiagnosticEvent[] = [];
  let filterError = "";
  try {
    events = filterDiagnostics(snapshot?.events || [], filters);
  } catch (error) {
    filterError =
      error instanceof Error
        ? error.message
        : "Confira as datas e tente novamente.";
  }

  const download = () => {
    if (!snapshot || filterError) return;
    try {
      const result = exportDiagnostics(
        snapshot.events,
        filters,
        new Date().toISOString(),
      );
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(result, null, 2)], {
          type: "application/json;charset=utf-8",
        }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "sistem-diagnostico-local.json";
      try {
        anchor.click();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      setExportError("");
    } catch {
      setExportError(
        "Não foi possível exportar o diagnóstico. Os registros foram preservados; tente novamente.",
      );
    }
  };

  return (
    <div className="diagnostic-page">
      <PageHeader
        eyebrow="SUPORTE DA LOJA"
        title="Diagnóstico"
        description="Consulte ocorrências deste navegador e exporte um pacote para investigar um problema."
        action={
          <button
            type="button"
            className="button button-primary"
            onClick={download}
            disabled={!snapshot || Boolean(filterError || loadError)}
          >
            <Download size={16} aria-hidden="true" />
            Exportar diagnóstico
          </button>
        }
      />

      <section className="diagnostic-context" aria-label="Contexto local do diagnóstico">
        <div>
          <span className="diagnostic-caption">Empresa demonstrativa</span>
          <strong>Eletrônica Central</strong>
          <p>Este recorte identifica a instalação local, sem empresa autenticada.</p>
        </div>
        <div>
          <span className="diagnostic-caption">Instalação neste navegador</span>
          <code className="diagnostic-installation">
            {snapshot?.installationId || "Carregando identificação…"}
          </code>
          <p>Use este identificador para relacionar o pacote de suporte à loja.</p>
        </div>
      </section>

      {snapshot?.persistence === "memory" && (
        <div className="notice notice-warning" role="status">
          <CircleAlert size={19} aria-hidden="true" />
          <div>
            <strong>O diagnóstico está somente em memória.</strong>
            <p>
              O navegador não permitiu salvar o histórico. Exporte as ocorrências
              antes de recarregar ou fechar esta página.
            </p>
          </div>
        </div>
      )}

      <div className="notice notice-info">
        <ShieldCheck size={19} aria-hidden="true" />
        <div>
          <strong>Pacote técnico local para suporte</strong>
          <p>
            Nenhuma ocorrência é enviada automaticamente. O pacote contém
            códigos controlados, sem dados de consumidores, formulários ou erro
            bruto. Mantemos até {MAX_DIAGNOSTIC_EVENTS} ocorrências recentes;
            este arquivo é separado do backup dos dados da loja.
          </p>
        </div>
      </div>

      <Panel title="Filtrar ocorrências" subtitle="O período usa o horário de São Paulo e inclui os dois dias informados.">
        <div className="diagnostic-filters">
          <Field label="De">
            <input
              type="date"
              value={filters.from || ""}
              onChange={(event) => updateFilter({ from: event.target.value || undefined })}
            />
          </Field>
          <Field label="Até">
            <input
              type="date"
              value={filters.to || ""}
              onChange={(event) => updateFilter({ to: event.target.value || undefined })}
            />
          </Field>
          <Field label="Nível">
            <select
              value={filters.level || ""}
              onChange={(event) => updateFilter({ level: (event.target.value || undefined) as DiagnosticLevel | undefined })}
            >
              <option value="">Todos os níveis</option>
              <option value="warning">Atenção</option>
              <option value="error">Erro</option>
            </select>
          </Field>
          <Field label="Módulo">
            <select
              value={filters.module || ""}
              onChange={(event) => updateFilter({ module: (event.target.value || undefined) as DiagnosticModule | undefined })}
            >
              <option value="">Todos os módulos</option>
              {(Object.entries(moduleLabels) as [DiagnosticModule, string][]).map(([value, label]) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
          </Field>
          <Field label="Código ou ID" className="diagnostic-query">
            <input
              type="search"
              value={filters.query || ""}
              onChange={(event) => updateFilter({ query: event.target.value })}
              placeholder="Código da ocorrência ou identificador"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        </div>
      </Panel>

      <FormError message={loadError || filterError || exportError} />

      <Panel
        title="Ocorrências locais"
        subtitle={snapshot?.persistence === "local" ? "Histórico salvo somente neste navegador." : "Ocorrências da instalação local."}
      >
        {!snapshot && !loadError ? (
          <p className="diagnostic-loading" role="status">Carregando ocorrências…</p>
        ) : !filterError && !loadError && events.length ? (
          <div
            className="diagnostic-table-scroll"
            role="region"
            aria-label="Ocorrências de diagnóstico"
            tabIndex={0}
          >
            <table>
              <caption className="sr-only">Ocorrências correspondentes aos filtros de diagnóstico</caption>
              <thead>
                <tr>
                  <th scope="col">Instante · São Paulo</th>
                  <th scope="col">Nível</th>
                  <th scope="col">Ocorrência</th>
                  <th scope="col">Módulo e ação</th>
                  <th scope="col">ID para suporte</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td><time dateTime={event.at}>{occurrenceDate(event.at)}</time></td>
                    <td><Badge tone={event.level === "error" ? "danger" : "warning"}>{event.level === "error" ? "Erro" : "Atenção"}</Badge></td>
                    <td>
                      <strong className="diagnostic-event-title">{diagnosticCatalog[event.code].title}</strong>
                      <code className="diagnostic-code">{event.code}</code>
                      <p className="diagnostic-description">{diagnosticCatalog[event.code].description}</p>
                    </td>
                    <td>
                      <strong className="diagnostic-event-title">{moduleLabels[event.module]}</strong>
                      <span className="diagnostic-description">{operationLabels[event.operation]}</span>
                      <code className="diagnostic-code">{event.route}</code>
                    </td>
                    <td><code className="diagnostic-id">{event.id}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !filterError && !loadError ? (
          <EmptyState
            title="Nenhuma ocorrência nesta seleção"
            text="Operações rejeitadas e falhas técnicas aparecem automaticamente. Altere os filtros para consultar outro período."
          />
        ) : null}
        <div className="diagnostic-footer" aria-live="polite">
          <span>{filterError || loadError ? "Corrija o filtro ou a recuperação para consultar." : `${events.length} ocorrência${events.length === 1 ? "" : "s"} na seleção`}</span>
          <span>Exportação JSON dos mesmos registros</span>
        </div>
      </Panel>
    </div>
  );
}
