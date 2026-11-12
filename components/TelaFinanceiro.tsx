"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Organograma from "@/components/Organograma";
import LinhaDoTempo from "@/components/LinhaDoTempo";
import FilaAprovacao from "@/components/FilaAprovacao";
import { criarClienteNavegador } from "@/lib/supabase/navegador";

export type ExtratoTela = {
  id: string;
  nome_arquivo: string;
  importado_em: string;
  total_linhas: number;
  total_creditos: number;
};

export type LancamentoTela = {
  id: string;
  data: string;
  descricao: string | null;
  valor: number | string;
  tipo: string;
  situacao: string | null;
  cod_titulo_casado: string | null;
};

export type DivergenciaTela = {
  id: string;
  tipo_inicial: string;
  lancamento_id: string | null;
  cod_titulo: string | null;
  valor_lancamento: number | string | null;
  valor_titulo: number | string | null;
  status: string;
  hipotese: { hipotese?: string } | null;
};

const COLUNAS = [
  { chave: "nova", titulo: "Nova" },
  { chave: "investigando", titulo: "Investigando" },
  { chave: "aguardando_aprovacao", titulo: "Aguardando aprovação" },
  { chave: "resolvida", titulo: "Resolvida" },
];

const ROTULO_TIPO: Record<string, string> = {
  valor_diferente_mesma_nf: "Valor diferente da NF",
  sem_titulo_correspondente: "Sem título correspondente",
  possivel_soma: "Possível soma de dois títulos",
  duplicado: "Duplicado",
  vencido_sem_pagamento: "Vencido sem pagamento",
};

const moeda = (v: number | string | null) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v ?? 0));

const data = (iso: string) => iso.split("-").reverse().join("/");

export default function TelaFinanceiro({
  extrato,
  lancamentos,
  divergencias,
  relatorio,
}: {
  extrato: ExtratoTela | null;
  lancamentos: LancamentoTela[];
  divergencias: DivergenciaTela[];
  relatorio: string | null;
}) {
  const router = useRouter();
  const [aba, setAba] = useState<"resultado" | "relatorio" | "aprovacoes">("resultado");
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [conciliando, setConciliando] = useState(false);
  const [erro, setErro] = useState("");

  // Atualiza as divergências quando o status muda no banco.
  useEffect(() => {
    if (!extrato) return;
    const supabase = criarClienteNavegador();
    const canal = supabase
      .channel(`divergencias-${extrato.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "divergencias", filter: `extrato_id=eq.${extrato.id}` },
        () => router.refresh()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
  }, [extrato, router]);

  if (!extrato) return <p>Importe um extrato para começar.</p>;

  async function conciliar() {
    setErro("");
    setConciliando(true);
    const resp = await fetch("/api/financeiro/conciliar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extrato_id: extrato!.id }),
    });
    const corpo = await resp.json().catch(() => ({}));
    setConciliando(false);
    if (!resp.ok) setErro(corpo.erro ?? "Não foi possível conciliar.");
    router.refresh();
  }

  const casados = lancamentos.filter((l) => l.situacao === "casado");
  const ignorados = lancamentos.filter((l) => l.tipo === "debito");
  const escolhida = divergencias.find((d) => d.id === selecionada) ?? null;

  return (
    <>
      <section className="vendas-topo">
        <h2>Organograma da conciliação · {extrato.nome_arquivo}</h2>
        <Organograma area="financeiro" item_id={extrato.id} />
      </section>

      <div className="fila-botoes">
        <button type="button" disabled={conciliando} onClick={conciliar}>
          {conciliando ? "Conciliando..." : "Conciliar"}
        </button>
      </div>
      {erro && <p className="erro">{erro}</p>}

      <nav className="abas">
        {[
          { chave: "resultado", rotulo: "Resultado" },
          { chave: "relatorio", rotulo: "Relatório" },
          { chave: "aprovacoes", rotulo: "Aprovações" },
        ].map((a) => (
          <button
            key={a.chave}
            type="button"
            className={`aba ${aba === a.chave ? "ativa" : ""}`}
            onClick={() => setAba(a.chave as typeof aba)}
          >
            {a.rotulo}
          </button>
        ))}
      </nav>

      {aba === "resultado" && (
        <>
          <h2>Bateram ({casados.length})</h2>
          <ul className="lista-lancamentos">
            {casados.map((l) => (
              <li key={l.id} className="casado">
                <span>
                  {data(l.data)} · {l.descricao}
                </span>
                <strong>
                  {moeda(l.valor)} → {l.cod_titulo_casado}
                </strong>
              </li>
            ))}
          </ul>

          <h2>Divergências ({divergencias.length})</h2>
          <div className="kanban">
            {COLUNAS.map((col) => {
              const doStatus = divergencias.filter((d) => d.status === col.chave);
              return (
                <div key={col.chave} className="kanban-coluna">
                  <h3>
                    {col.titulo} ({doStatus.length})
                  </h3>
                  {doStatus.map((d) => (
                    <div
                      key={d.id}
                      className={`kanban-cartao ${selecionada === d.id ? "selecionado" : ""}`}
                      onClick={() => setSelecionada(d.id)}
                    >
                      <strong>{ROTULO_TIPO[d.tipo_inicial] ?? d.tipo_inicial}</strong>
                      <span>{moeda(d.valor_lancamento ?? d.valor_titulo)}</span>
                      <small>{d.cod_titulo ?? "sem título"}</small>
                      {d.hipotese?.hipotese && <small>Hipótese: {d.hipotese.hipotese.replace(/_/g, " ")}</small>}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          <h2>Ignorados: débitos ({ignorados.length})</h2>
          <ul className="lista-lancamentos">
            {ignorados.map((l) => (
              <li key={l.id}>
                <span>
                  {data(l.data)} · {l.descricao}
                </span>
                <strong>{moeda(l.valor)}</strong>
              </li>
            ))}
          </ul>
        </>
      )}

      {aba === "relatorio" && (
        <pre className="relatorio">
          {relatorio ?? "Ainda não há relatório. Clique em Conciliar."}
        </pre>
      )}

      {aba === "aprovacoes" && <FilaAprovacao area="financeiro" campoTexto="texto" />}

      {escolhida && (
        <aside className="painel-lateral">
          <div className="painel-cabecalho">
            <strong>Linha do tempo · {ROTULO_TIPO[escolhida.tipo_inicial] ?? escolhida.tipo_inicial}</strong>
            <button type="button" className="secundario" onClick={() => setSelecionada(null)}>
              Fechar
            </button>
          </div>
          <LinhaDoTempo item_id={extrato.id} divergencia_id={escolhida.id} />
        </aside>
      )}
    </>
  );
}
