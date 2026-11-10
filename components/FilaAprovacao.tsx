"use client";

import { useCallback, useEffect, useState } from "react";
import { criarClienteNavegador } from "@/lib/supabase/navegador";

type Item = {
  id: string;
  titulo: string;
  item_tipo: string;
  item_id: string;
  proposta: unknown;
};

export default function FilaAprovacao({ area }: { area: string }) {
  const [itens, setItens] = useState<Item[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async () => {
    const supabase = criarClienteNavegador();
    const { data } = await supabase
      .from("aprovacoes")
      .select("id, titulo, item_tipo, item_id, proposta")
      .eq("area", area)
      .eq("status", "pendente")
      .order("titulo");
    setItens((data as Item[]) ?? []);
  }, [area]);

  useEffect(() => {
    carregar();
    const supabase = criarClienteNavegador();
    const canal = supabase
      .channel(`fila-${area}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "aprovacoes", filter: `area=eq.${area}` },
        carregar
      )
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
  }, [area, carregar]);

  function abrir(item: Item) {
    if (aberto === item.id) {
      setAberto(null);
      return;
    }
    setAberto(item.id);
    setTexto(JSON.stringify(item.proposta, null, 2));
    setObservacao("");
    setErro("");
  }

  async function decidir(item: Item, decisao: "aprovada" | "editada" | "rejeitada") {
    setErro("");
    let proposta: unknown;
    if (decisao === "editada") {
      try {
        proposta = JSON.parse(texto);
      } catch {
        setErro("A proposta editada não é um JSON válido.");
        return;
      }
    }
    if (decisao === "rejeitada" && !observacao.trim()) {
      setErro("Escreva a observação para rejeitar.");
      return;
    }
    setEnviando(true);
    const resp = await fetch("/api/aprovacoes/decidir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, decisao, proposta, observacao }),
    });
    const corpo = await resp.json().catch(() => ({}));
    setEnviando(false);
    if (!resp.ok) {
      setErro(corpo.erro ?? "Não foi possível registrar a decisão.");
      return;
    }
    setAberto(null);
    carregar();
  }

  if (itens.length === 0) return <p>Nenhum item pendente.</p>;

  return (
    <div>
      {itens.map((item) => (
        <div key={item.id} className="fila-item">
          <button type="button" className="titulo secundario" onClick={() => abrir(item)}>
            {item.titulo}
          </button>
          {aberto === item.id && (
            <div className="fila-corpo">
              <label>
                Proposta (editável, em JSON)
                <textarea value={texto} onChange={(e) => setTexto(e.target.value)} />
              </label>
              <label>
                Observação (obrigatória para rejeitar)
                <input value={observacao} onChange={(e) => setObservacao(e.target.value)} />
              </label>
              {erro && <p className="erro">{erro}</p>}
              <div className="fila-botoes">
                <button type="button" disabled={enviando} onClick={() => decidir(item, "aprovada")}>
                  Aprovar
                </button>
                <button type="button" className="secundario" disabled={enviando} onClick={() => decidir(item, "editada")}>
                  Salvar edição e aprovar
                </button>
                <button type="button" className="perigo" disabled={enviando} onClick={() => decidir(item, "rejeitada")}>
                  Rejeitar
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
