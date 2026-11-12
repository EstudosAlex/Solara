"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Organograma from "@/components/Organograma";
import LinhaDoTempo from "@/components/LinhaDoTempo";
import FilaAprovacao from "@/components/FilaAprovacao";
import { criarClienteNavegador } from "@/lib/supabase/navegador";

export type PedidoVendas = {
  cod_pedido: string;
  data: string | null;
  canal: string | null;
  mensagem: string | null;
  status: string;
  cliente_nome: string | null;
};

const COLUNAS = [
  { chave: "novo", titulo: "Novo" },
  { chave: "processando", titulo: "Processando" },
  { chave: "aguardando_aprovacao", titulo: "Aguardando aprovação" },
  { chave: "respondido", titulo: "Respondido" },
  { chave: "rejeitado", titulo: "Rejeitado" },
];

export default function TelaVendas({ pedidos }: { pedidos: PedidoVendas[] }) {
  const router = useRouter();
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [processando, setProcessando] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState<"kanban" | "aprovacoes">("kanban");

  // Atualiza o kanban quando algum pedido muda no banco.
  useEffect(() => {
    const supabase = criarClienteNavegador();
    const canal = supabase
      .channel("kanban-vendas")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pedidos_orcamento" },
        () => router.refresh()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
  }, [router]);

  async function processar(cod: string) {
    setErro("");
    setProcessando(cod);
    const resp = await fetch("/api/vendas/processar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cod_pedido: cod }),
    });
    const corpo = await resp.json().catch(() => ({}));
    setProcessando(null);
    if (!resp.ok) setErro(corpo.erro ?? "Não foi possível processar o pedido.");
    router.refresh();
  }

  return (
    <>
      <nav className="abas">
        <button
          type="button"
          className={`aba ${aba === "kanban" ? "ativa" : ""}`}
          onClick={() => setAba("kanban")}
        >
          Kanban
        </button>
        <button
          type="button"
          className={`aba ${aba === "aprovacoes" ? "ativa" : ""}`}
          onClick={() => setAba("aprovacoes")}
        >
          Aprovações
        </button>
      </nav>

      {aba === "aprovacoes" ? (
        <FilaAprovacao area="vendas" campoTexto="resposta" />
      ) : (
    <>
      <section className="vendas-topo">
        <h2>{selecionado ? `Organograma · ${selecionado}` : "Organograma"}</h2>
        {selecionado ? (
          <Organograma area="vendas" item_id={selecionado} />
        ) : (
          <p>Selecione um cartão para ver o organograma do pedido.</p>
        )}
      </section>

      {erro && <p className="erro">{erro}</p>}

      <div className="kanban">
        {COLUNAS.map((col) => {
          const doStatus = pedidos.filter((p) => p.status === col.chave);
          return (
            <div key={col.chave} className="kanban-coluna">
              <h3>
                {col.titulo} ({doStatus.length})
              </h3>
              {doStatus.map((p) => (
                <div
                  key={p.cod_pedido}
                  className={`kanban-cartao ${selecionado === p.cod_pedido ? "selecionado" : ""}`}
                  onClick={() => setSelecionado(p.cod_pedido)}
                >
                  <strong>{p.cod_pedido}</strong>
                  <span>{p.cliente_nome ?? "Sem cliente"}</span>
                  <small>
                    {p.canal ?? "—"} · {p.data ?? "—"}
                  </small>
                  <small>{(p.mensagem ?? "").slice(0, 80)}</small>
                  {p.status === "novo" && (
                    <button
                      type="button"
                      disabled={processando !== null}
                      onClick={(e) => {
                        e.stopPropagation();
                        processar(p.cod_pedido);
                      }}
                    >
                      {processando === p.cod_pedido ? "Processando..." : "Processar"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {selecionado && (
        <aside className="painel-lateral">
          <div className="painel-cabecalho">
            <strong>Linha do tempo · {selecionado}</strong>
            <button type="button" className="secundario" onClick={() => setSelecionado(null)}>
              Fechar
            </button>
          </div>
          <LinhaDoTempo item_id={selecionado} />
        </aside>
      )}
    </>
      )}
    </>
  );
}
