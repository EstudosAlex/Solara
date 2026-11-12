"use client";

import { useEffect, useState } from "react";
import { criarClienteNavegador } from "@/lib/supabase/navegador";

type Execucao = {
  id: string;
  agente: string;
  status: "rodando" | "ok" | "erro";
  entrada: unknown;
  saida: unknown;
  erro: string | null;
  tokens_entrada: number | null;
  tokens_saida: number | null;
  inicio: string;
  fim: string | null;
};

// divergencia_id (opcional): mostra só as execuções dessa divergência e a raiz do orquestrador.
export default function LinhaDoTempo({ item_id, divergencia_id }: { item_id: string; divergencia_id?: string }) {
  const [todas, setTodas] = useState<Execucao[]>([]);
  const execucoes = divergencia_id
    ? todas.filter(
        (e) =>
          (e.entrada as { divergencia_id?: string } | null)?.divergencia_id === divergencia_id ||
          e.agente === "orquestrador"
      )
    : todas;

  useEffect(() => {
    const supabase = criarClienteNavegador();
    let ativo = true;

    async function carregar() {
      const { data } = await supabase
        .from("execucoes_agentes")
        .select("*")
        .eq("item_id", item_id)
        .order("inicio", { ascending: true });
      if (ativo && data) setTodas(data as Execucao[]);
    }
    carregar();

    const canal = supabase
      .channel(`linha-do-tempo-${item_id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "execucoes_agentes", filter: `item_id=eq.${item_id}` },
        carregar
      )
      .subscribe();

    return () => {
      ativo = false;
      supabase.removeChannel(canal);
    };
  }, [item_id]);

  if (execucoes.length === 0) return <p>Nenhuma execução registrada.</p>;

  return (
    <div>
      {execucoes.map((e) => {
        const tempo = e.fim
          ? ((new Date(e.fim).getTime() - new Date(e.inicio).getTime()) / 1000).toFixed(1) + " s"
          : "—";
        const tokens = (e.tokens_entrada ?? 0) + (e.tokens_saida ?? 0);
        return (
          <details key={e.id} className="tempo-item">
            <summary>
              <strong>{e.agente}</strong> <span className={`tag ${e.status}`}>{e.status}</span> · {tempo} ·{" "}
              {tokens} tokens
            </summary>
            {e.erro && <p className="erro">{e.erro}</p>}
            <p>Entrada</p>
            <pre>{JSON.stringify(e.entrada, null, 2)}</pre>
            <p>Saída</p>
            <pre>{JSON.stringify(e.saida, null, 2)}</pre>
          </details>
        );
      })}
    </div>
  );
}
