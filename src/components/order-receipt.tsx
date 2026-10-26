"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import JsBarcode from "jsbarcode";
import { Printer, X } from "lucide-react";
import { dateLabel, money, stages, sumOrder, type Customer, type ServiceOrder } from "@/lib/domain";
import { orderCode } from "@/lib/order-code";

export type OrderReceiptSnapshot = {
  order: ServiceOrder;
  customer?: Customer;
  company: string;
  at: string;
};

function maskedDocument(value?: string) {
  const compact = (value || "").replace(/[^A-Za-z0-9]/g, "");
  if (!compact) return "Não informado";
  return compact.length === 11
    ? `***.***.***-${compact.slice(-2)}`
    : `**.***.***/****-${compact.slice(-2)}`;
}

/** The paper is a snapshot; its stable code always resolves the current order. */
export function OrderReceipt({ snapshot, onClose }: {
  snapshot: OrderReceiptSnapshot;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const barcode = useRef<SVGSVGElement>(null);
  const titleId = useId();
  const [failure, setFailure] = useState("");
  const { order, customer } = snapshot;
  const code = orderCode(order);
  const print = () => {
    try { window.print(); }
    catch { setFailure("Não foi possível abrir a impressão. O comprovante continua disponível para tentar novamente."); }
  };

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const sheet = dialog.current;
    const svg = barcode.current;
    if (!sheet || !svg) return;
    let frame = 0;
    sheet.showModal();
    try {
      JsBarcode(svg, code, {
        format: "CODE128", width: 2, height: 76, margin: 18,
        displayValue: false, background: "#ffffff", lineColor: "#000000",
      });
      svg.setAttribute("viewBox", `0 0 ${svg.getAttribute("width")} ${svg.getAttribute("height")}`);
      // Wait for the generated SVG to be in the rendered paper before opening print.
      frame = window.requestAnimationFrame(print);
    } catch {
      setFailure("Não foi possível gerar o código. Feche o comprovante e tente imprimir novamente.");
    }
    return () => {
      window.cancelAnimationFrame(frame);
      if (sheet.open) sheet.close();
      queueMicrotask(() => { if (previous?.isConnected) previous.focus(); });
    };
  }, []);

  return createPortal(
    <div className="receipt-layer">
      <dialog ref={dialog} className="receipt-dialog" aria-labelledby={titleId}
        onCancel={(event) => { event.preventDefault(); onClose(); }}>
        <div className="receipt-toolbar">
          <button className="button button-secondary" onClick={print}>
            <Printer size={17} /> Imprimir comprovante
          </button>
          <button className="button button-secondary" onClick={onClose}>
            <X size={17} /> Fechar comprovante
          </button>
        </div>
        {failure && <p className="form-error" role="alert">{failure}</p>}
        <section className="receipt-paper" role="region" aria-label="Comprovante da ordem de serviço">
          <header className="receipt-heading">
            <div><strong>{snapshot.company || "Sistem"}</strong><p>Assistência técnica · demonstração local</p></div>
            <div><h2 id={titleId}>OS #{order.number}</h2><p>{stages[order.stage].label}</p></div>
          </header>
          <dl className="receipt-fields">
            <div><dt>Cliente</dt><dd>{customer?.name || "Cliente não localizado"}</dd></div>
            <div><dt>Contato</dt><dd>{customer?.phone || "Não informado"}</dd></div>
            <div><dt>CPF / CNPJ</dt><dd>{maskedDocument(customer?.document)}</dd></div>
            <div><dt>Recebido em</dt><dd>{dateLabel(order.created)}</dd></div>
            <div><dt>Equipamento / modelo</dt><dd>{order.equipment}</dd></div>
            <div><dt>Série / etiqueta</dt><dd>{order.serial || "Não informada"}</dd></div>
            <div><dt>Acessórios recebidos</dt><dd>{order.accessories || "Nenhum acessório informado"}</dd></div>
            <div><dt>Previsão</dt><dd>{order.due ? dateLabel(order.due) : "A definir"}</dd></div>
          </dl>
          <div className="receipt-section"><h3>Solicitação do cliente</h3><p>{order.issue}</p></div>
          {order.diagnosis && <div className="receipt-section"><h3>Diagnóstico / serviço proposto</h3><p>{order.diagnosis}</p></div>}
          <div className="receipt-section">
            <h3>{order.approved ? "Orçamento aprovado" : "Orçamento estimado · aprovação pendente"}</h3>
            <dl className="receipt-fields">
              <div><dt>Peças / materiais</dt><dd>{money(order.parts)}</dd></div>
              <div><dt>Serviços</dt><dd>{money(order.labor)}</dd></div>
              <div><dt>Total {order.approved ? "autorizado" : "estimado"}</dt><dd>{money(sumOrder(order))}</dd></div>
            </dl>
            {!order.approved && <p>Os valores são uma previsão. Esta folha não registra aprovação ou pagamento.</p>}
          </div>
          <div className="receipt-barcode">
            <svg ref={barcode} data-order-code={code} role="img" aria-label={`Código de barras da OS ${order.number}`} />
            <p>{code}</p>
            <strong>Apresente esta folha na retirada.</strong>
          </div>
          <footer className="receipt-footer">
            <p>A retirada depende da conferência do cliente ou pessoa autorizada, equipamento e acessórios.</p>
            <p>Dados registrados em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(snapshot.at))}. Uma nova leitura consulta a situação atual.</p>
            <p>Comprovante de atendimento. Não é documento fiscal nem comprovante de pagamento.</p>
          </footer>
        </section>
      </dialog>
    </div>, document.body,
  );
}
