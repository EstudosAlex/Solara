"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Linha = { data: string; descricao: string; valor: number; tipo: string };

type Previa = {
  origem_titulos: "arquivo" | "tabela";
  modo: "limpo" | "bruto";
  antes: string[];
  depois: Linha[];
  resumo: {
    qtd_casados: number;
    valor_casado: number;
    qtd_divergencias: number;
    valor_divergente: number;
    qtd_ignorados: number;
  };
};

const moeda = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

export default function ImportarExtrato() {
  const router = useRouter();
  const [extrato, setExtrato] = useState<File | null>(null);
  const [titulos, setTitulos] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [previa, setPrevia] = useState<Previa | null>(null);

  async function importar(e: React.FormEvent) {
    e.preventDefault();
    if (!extrato) return;
    setErro("");
    setEnviando(true);
    const corpo = new FormData();
    corpo.append("extrato", extrato);
    if (titulos) corpo.append("titulos", titulos);
    const resp = await fetch("/api/financeiro/importar", { method: "POST", body: corpo });
    const dados = await resp.json().catch(() => ({}));
    setEnviando(false);
    if (!resp.ok) {
      setErro(dados.erro ?? "Não foi possível importar o extrato.");
      return;
    }
    setPrevia(dados as Previa);
    router.refresh();
  }

  return (
    <section className="bloco">
      <h2>Importar</h2>
      <form onSubmit={importar}>
        <label>
          Extrato do banco (obrigatório)
          <input type="file" accept=".csv,.txt" onChange={(e) => setExtrato(e.target.files?.[0] ?? null)} />
        </label>
        <label>
          Títulos a receber (opcional; sem arquivo, usa a tabela do ERP)
          <input type="file" accept=".csv" onChange={(e) => setTitulos(e.target.files?.[0] ?? null)} />
        </label>
        <button type="submit" disabled={!extrato || enviando}>
          {enviando ? "Importando..." : "Importar"}
        </button>
      </form>
      {erro && <p className="erro">{erro}</p>}

      {previa && (
        <>
          <p className="ok">
            Arquivo lido ({previa.modo === "bruto" ? "extrato bruto do banco" : "extrato já limpo"}). Títulos
            usados: {previa.origem_titulos === "arquivo" ? "planilha enviada" : "tabela do ERP"}.
          </p>
          <div className="antes-depois">
            <div>
              <h3>Como veio</h3>
              <pre>{previa.antes.join("\n")}</pre>
            </div>
            <div>
              <h3>Normalizado</h3>
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Descrição</th>
                    <th>Valor</th>
                    <th>Tipo</th>
                  </tr>
                </thead>
                <tbody>
                  {previa.depois.map((l, i) => (
                    <tr key={i}>
                      <td>{l.data}</td>
                      <td>{l.descricao}</td>
                      <td>{moeda(l.valor)}</td>
                      <td>{l.tipo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p>
            Bateram: {previa.resumo.qtd_casados} ({moeda(previa.resumo.valor_casado)}) · Divergências:{" "}
            {previa.resumo.qtd_divergencias} ({moeda(previa.resumo.valor_divergente)}) · Ignorados (débitos):{" "}
            {previa.resumo.qtd_ignorados}
          </p>
        </>
      )}
    </section>
  );
}
