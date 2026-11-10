"use client";

import { useEffect, useRef, useState } from "react";
import { criarClienteNavegador } from "@/lib/supabase/navegador";

type Execucao = {
  id: string;
  agente: string;
  status: "rodando" | "ok" | "erro";
  saida: { aprovado?: boolean } | null;
  tokens_entrada: number | null;
  tokens_saida: number | null;
  inicio: string;
  fim: string | null;
};

const AGENTES: Record<string, string[]> = {
  vendas: ["triador", "pesquisador", "redator", "revisor"],
  financeiro: ["investigador", "consolidador", "revisor"],
};

function segundos(e: Execucao) {
  if (!e.fim) return null;
  return ((new Date(e.fim).getTime() - new Date(e.inicio).getTime()) / 1000).toFixed(1);
}

function tokens(e: Execucao) {
  return (e.tokens_entrada ?? 0) + (e.tokens_saida ?? 0);
}

function CartaoAgente({ nome, execucoes }: { nome: string; execucoes: Execucao[] }) {
  const doAgente = execucoes
    .filter((e) => e.agente === nome)
    .sort((a, b) => a.inicio.localeCompare(b.inicio));

  let classe = "";
  let detalhe: React.ReactNode = null;

  if (nome === "investigador" && doAgente.length > 0) {
    const rodando = doAgente.filter((e) => e.status === "rodando").length;
    const concluidos = doAgente.filter((e) => e.status === "ok").length;
    const comErro = doAgente.some((e) => e.status === "erro");
    classe = rodando > 0 ? "rodando" : comErro ? "erro" : "ok";
    detalhe = (
      <small>
        {rodando} rodando / {concluidos} concluídos
      </small>
    );
  } else if (doAgente.length > 0) {
    const ultimo = doAgente[doAgente.length - 1];
    classe = ultimo.status;
    if (ultimo.status === "ok") {
      detalhe = (
        <small>
          {segundos(ultimo)} s · {tokens(ultimo)} tokens
        </small>
      );
    }
  }

  return (
    <div className={`org-no ${classe}`}>
      {nome}
      {detalhe}
    </div>
  );
}

export default function Organograma({ area, item_id }: { area: string; item_id: string }) {
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [revisorDevolveu, setRevisorDevolveu] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = criarClienteNavegador();
    let ativo = true;
    setExecucoes([]);
    setRevisorDevolveu(false);

    supabase
      .from("execucoes_agentes")
      .select("id, agente, status, saida, tokens_entrada, tokens_saida, inicio, fim")
      .eq("item_id", item_id)
      .then(({ data }) => {
        if (ativo && data) setExecucoes(data as Execucao[]);
      });

    const canal = supabase
      .channel(`organograma-${item_id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "execucoes_agentes", filter: `item_id=eq.${item_id}` },
        (payload) => {
          const nova = payload.new as Execucao;
          setExecucoes((atual) => [...atual.filter((e) => e.id !== nova.id), nova]);
          if (nova.agente === "revisor" && nova.status === "ok" && nova.saida?.aprovado === false) {
            setRevisorDevolveu(true);
            if (temporizador.current) clearTimeout(temporizador.current);
            temporizador.current = setTimeout(() => setRevisorDevolveu(false), 3000);
          }
        }
      )
      .subscribe();

    return () => {
      ativo = false;
      if (temporizador.current) clearTimeout(temporizador.current);
      supabase.removeChannel(canal);
    };
  }, [item_id]);

  const nomes = AGENTES[area] ?? [];
  const raiz = execucoes.filter((e) => e.agente === "orquestrador");
  const classeRaiz = raiz.length > 0 ? raiz[raiz.length - 1].status : "";

  return (
    <div className="org">
      <div className={`org-no ${classeRaiz}`}>orquestrador</div>
      <div className="org-haste" />
      <div className="org-linha">
        {nomes.map((nome, i) => (
          <div key={nome} style={{ display: "flex" }}>
            <div className="org-filho">
              <CartaoAgente nome={nome} execucoes={execucoes} />
            </div>
            {area === "vendas" && nome === "redator" && (
              <span className={`org-volta ${revisorDevolveu ? "vermelha" : ""}`} title="revisor devolve ao redator">
                ⇄
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
