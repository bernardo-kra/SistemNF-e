"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Upload,
  FileCode2,
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  CheckCircle2,
  Package,
  RotateCcw,
} from "lucide-react";
import { useDemo, uid } from "@/lib/demo-store";
import { money, type Product } from "@/lib/domain";
import { Badge, FormError, PageHeader } from "@/components/ui";

interface Item {
  code: string;
  name: string;
  ncm: string;
  unit: string;
  quantity: number;
  cost: number;
  action: string;
  price: string;
}
interface ImportFile {
  key: string;
  supplier: string;
  number: string;
  items: Item[];
}
const example: ImportFile = {
  key: "DEMO-XML-COMPRA-001",
  supplier: "Distribuidora Exemplo de Informática",
  number: "Compra demonstrativa #001",
  items: [
    {
      code: "CAB-USB-C",
      name: "Cabo USB-C · 1 metro",
      ncm: "85444200",
      unit: "UN",
      quantity: 10,
      cost: 1590,
      price: "39.90",
      action: "new",
    },
    {
      code: "HUB-USB",
      name: "Hub USB 3.0 · 4 portas",
      ncm: "84718000",
      unit: "UN",
      quantity: 5,
      cost: 3490,
      price: "69.90",
      action: "new",
    },
    {
      code: "SSD-480",
      name: "SSD Kingston A400 · 480 GB",
      ncm: "85235190",
      unit: "UN",
      quantity: 3,
      cost: 18990,
      price: "289.90",
      action: "p1",
    },
  ],
};
function child(element: Element, tag: string) {
  return element.getElementsByTagNameNS("*", tag)[0]?.textContent?.trim() || "";
}
function parseFile(text: string): ImportFile {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("O arquivo contém declarações XML não permitidas.");
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.getElementsByTagName("parsererror").length)
    throw new Error(
      "Não foi possível ler este XML. Confira se o arquivo está completo.",
    );
  const info = document.getElementsByTagNameNS("*", "infNFe")[0];
  if (!info)
    throw new Error("Não encontramos os dados de uma NF-e neste arquivo.");
  const issuer = info.getElementsByTagNameNS("*", "emit")[0];
  const id = info.getAttribute("Id");
  if (!id) throw new Error("O XML não tem identificação do documento.");
  const products = Array.from(info.getElementsByTagNameNS("*", "det"));
  if (!products.length || products.length > 500)
    throw new Error("Envie um XML com 1 a 500 itens para a demonstração.");
  const items = products.map((line, index) => {
    const product = line.getElementsByTagNameNS("*", "prod")[0];
    if (!product) throw new Error(`O item ${index + 1} está incompleto.`);
    const name = child(product, "xProd");
    const quantity = Number(child(product, "qCom"));
    const unitValue = child(product, "vUnCom");
    const cost = Math.round(Number(unitValue) * 100);
    if (
      !name ||
      !unitValue ||
      !Number.isFinite(cost) ||
      cost < 0 ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    )
      throw new Error(
        `Revise descrição, quantidade e valor do item ${index + 1}.`,
      );
    return {
      code: child(product, "cProd") || `ITEM-${index + 1}`,
      name,
      ncm: child(product, "NCM"),
      unit: child(product, "uCom") || "UN",
      quantity,
      cost,
      action: "new",
      price: "",
    };
  });
  return {
    key: id,
    supplier: issuer ? child(issuer, "xNome") : "Fornecedor do XML",
    number: child(info, "nNF") || "Documento importado",
    items,
  };
}

export function XmlImportPage() {
  const { state, importProducts } = useDemo();
  const [file, setFile] = useState<ImportFile | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [createdCount, setCreatedCount] = useState(0);
  const created = file?.items.filter((i) => i.action === "new") || [];
  const updateItem = (index: number, patch: Partial<Item>) =>
    setFile((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item, i) =>
              i === index ? { ...item, ...patch } : item,
            ),
          }
        : null,
    );
  const validate = () => {
    if (!file) return false;
    if (
      created.some(
        (item) =>
          !item.price.trim() ||
          !Number.isFinite(Number(item.price)) ||
          Number(item.price) < 0,
      )
    ) {
      setError("Informe um preço de venda válido para cada produto novo.");
      return false;
    }
    const codes = created.map((item) => item.code.toLowerCase());
    if (
      new Set(codes).size !== codes.length ||
      created.some((item) =>
        state.products.some(
          (p) => p.sku.toLowerCase() === item.code.toLowerCase(),
        ),
      )
    ) {
      setError(
        "Há códigos repetidos. Vincule os itens aos produtos existentes ou revise os SKUs.",
      );
      return false;
    }
    setError("");
    return true;
  };
  const loadExample = () => {
    setFile(structuredClone(example));
    setError("");
    setStep(1);
  };
  return (
    <>
      <Link href="/produtos/" className="back-link">
        <ArrowLeft size={16} />
        Voltar para produtos
      </Link>
      <PageHeader
        eyebrow="MENOS DIGITAÇÃO, MAIS CONTROLE"
        title="Importar produtos"
        description="Aproveite os dados da nota de compra. Confira antes de cadastrar."
      />
      <ol className="stepper">
        {[
          "Escolher arquivo",
          "Conferir e vincular",
          "Revisar cadastro",
          "Concluído",
        ].map((label, i) => (
          <li
            key={label}
            className={`${i === step ? "current" : ""} ${i < step ? "done" : ""}`}
          >
            <span>{i < step ? <Check size={16} /> : i + 1}</span>
            <strong>{label}</strong>
          </li>
        ))}
      </ol>
      <div className="notice notice-info">
        <FileCode2 size={19} />
        <div>
          <strong>Leitura de XML para demonstração de cadastro</strong>
          <p>
            Não verifica assinatura, autorização ou destinatário da NF-e. Use
            arquivos fictícios. Estoque e financeiro não serão alterados.
          </p>
        </div>
      </div>
      {step === 0 ? (
        <section className="panel import-upload-panel">
          <div className="upload-zone">
            <span className="upload-icon">
              <Upload size={30} />
            </span>
            <h2>Comece pelo XML da nota de compra</h2>
            <p>
              Selecione um arquivo .xml ou experimente um exemplo.
              <br />
              Até 2 MB · leitura realizada neste navegador
            </p>
            <label
              className={`button button-primary file-button ${reading ? "is-loading" : ""}`}
            >
              <Upload size={17} />
              {reading ? "Lendo arquivo…" : "Selecionar arquivo XML"}
              <input
                type="file"
                accept=".xml,application/xml,text/xml"
                disabled={reading}
                onChange={async (e) => {
                  const selected = e.target.files?.[0];
                  if (!selected) return;
                  setError("");
                  setReading(true);
                  try {
                    if (selected.size > 2 * 1024 * 1024)
                      throw new Error("O arquivo deve ter no máximo 2 MB.");
                    const parsed = parseFile(await selected.text());
                    parsed.items = parsed.items.map((item) => ({
                      ...item,
                      action:
                        state.products.find(
                          (p) =>
                            p.supplierCode === item.code &&
                            p.supplierId === parsed.supplier,
                        )?.id || "new",
                    }));
                    setFile(parsed);
                    setStep(1);
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    setReading(false);
                    e.target.value = "";
                  }
                }}
              />
            </label>
            <span className="upload-or">ou</span>
            <button className="text-link" onClick={loadExample}>
              Experimentar com uma nota de exemplo <ArrowRight size={15} />
            </button>
          </div>
          <FormError message={error} />
          <div className="upload-explanation">
            <div>
              <span>01</span>
              <strong>Leia os itens</strong>
              <p>Descrição, unidade e valores de origem.</p>
            </div>
            <div>
              <span>02</span>
              <strong>Confira os vínculos</strong>
              <p>Evite cadastrar duas vezes o mesmo produto.</p>
            </div>
            <div>
              <span>03</span>
              <strong>Complete e confirme</strong>
              <p>Escolha o preço de venda e revise o resultado.</p>
            </div>
          </div>
        </section>
      ) : step === 1 && file ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>{file.supplier}</h2>
              <p>
                {file.number} · {file.items.length} itens encontrados
              </p>
            </div>
            <Badge tone="warning">Conferência necessária</Badge>
          </div>
          <div className="table-scroll">
            <table className="import-table">
              <thead>
                <tr>
                  <th>ITEM DO FORNECEDOR</th>
                  <th>QTDE / UNIDADE</th>
                  <th className="number">VALOR UNITÁRIO</th>
                  <th>AÇÃO NO CATÁLOGO</th>
                  <th>PREÇO DE VENDA (R$)</th>
                </tr>
              </thead>
              <tbody>
                {file.items.map((item, i) => (
                  <tr key={i}>
                    <td>
                      <div className="stack-cell">
                        <strong>{item.name}</strong>
                        <small>
                          {item.code} · NCM {item.ncm || "não informado"}
                        </small>
                      </div>
                    </td>
                    <td>
                      {item.quantity} {item.unit}
                    </td>
                    <td className="number">{money(item.cost)}</td>
                    <td>
                      <label className="sr-only" htmlFor={`action-${i}`}>
                        Ação para {item.name}
                      </label>
                      <select
                        id={`action-${i}`}
                        value={item.action}
                        onChange={(e) =>
                          updateItem(i, { action: e.target.value })
                        }
                      >
                        <option value="new">Criar novo produto</option>
                        <option value="ignore">Não cadastrar</option>
                        {state.products.map((p) => (
                          <option value={p.id} key={p.id}>
                            Vincular: {p.sku}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {item.action === "new" ? (
                        <>
                          <label className="sr-only" htmlFor={`price-${i}`}>
                            Preço de venda de {item.name}
                          </label>
                          <input
                            id={`price-${i}`}
                            type="number"
                            min="0"
                            max="9999999"
                            step="0.01"
                            placeholder="Definir preço"
                            value={item.price}
                            onChange={(e) =>
                              updateItem(i, { price: e.target.value })
                            }
                          />
                        </>
                      ) : (
                        <span className="muted">
                          {item.action === "ignore"
                            ? "Não será cadastrado"
                            : "Cadastro será preservado"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="import-actions">
            <FormError message={error} />
            <button
              className="button button-secondary"
              onClick={() => {
                setStep(0);
                setError("");
              }}
            >
              <ArrowLeft size={16} />
              Trocar arquivo
            </button>
            <button
              className="button button-primary"
              onClick={() => {
                if (validate()) setStep(2);
              }}
            >
              Revisar cadastro <ArrowRight size={16} />
            </button>
          </div>
        </section>
      ) : step === 2 && file ? (
        <section className="panel import-review">
          <span className="review-icon">
            <Package size={30} />
          </span>
          <h2>Confira o que será feito</h2>
          <p>
            {file.supplier} · {file.items.length} itens na origem
          </p>
          <div className="review-numbers">
            <div>
              <strong>{created.length}</strong>
              <span>novos produtos</span>
            </div>
            <div>
              <strong>
                {
                  file.items.filter(
                    (i) => i.action !== "new" && i.action !== "ignore",
                  ).length
                }
              </strong>
              <span>itens vinculados</span>
            </div>
            <div>
              <strong>0</strong>
              <span>alterações no estoque</span>
            </div>
          </div>
          <div className="notice notice-info">
            Somente novos cadastros serão criados. Produtos vinculados mantêm
            preço, dados fiscais e estoque. Os vínculos de exemplo ainda não são
            reutilizados em futuras compras.
          </div>
          <FormError message={error} />
          <div className="form-actions">
            <button
              className="button button-secondary"
              onClick={() => {
                setError("");
                setStep(1);
              }}
            >
              Voltar à conferência
            </button>
            <button
              className="button button-primary"
              onClick={() => {
                if (!validate()) return;
                try {
                  const products: Product[] = created.map((item) => ({
                    id: uid(),
                    sku: item.code,
                    name: item.name,
                    ncm: item.ncm,
                    unit: item.unit,
                    cost: item.cost,
                    price: Math.round(Number(item.price) * 100),
                    category: "Importados",
                    stock: 0,
                    reserved: 0,
                    minimum: 2,
                    serialized: false,
                    supplierCode: item.code,
                    supplierId: file.supplier,
                  }));
                  importProducts(file.key, products);
                  setCreatedCount(products.length);
                  setStep(3);
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              <Check size={17} />
              Confirmar cadastros
            </button>
          </div>
        </section>
      ) : (
        <section className="panel import-complete">
          <span className="success-illustration">
            <CheckCircle2 size={48} />
          </span>
          <h2>Produtos prontos para o próximo passo.</h2>
          <p>
            {createdCount} novos cadastros criados. Nenhuma entrada de estoque
            ou conta foi gerada.
          </p>
          <div className="page-actions">
            <button
              className="button button-secondary"
              onClick={() => {
                setFile(null);
                setError("");
                setStep(0);
              }}
            >
              <RotateCcw size={16} />
              Nova importação
            </button>
            <Link href="/produtos/" className="button button-primary">
              Ver produtos <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      )}
    </>
  );
}
