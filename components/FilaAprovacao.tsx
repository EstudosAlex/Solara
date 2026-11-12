"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { criarClienteNavegador } from "@/lib/supabase/navegador";

type Item = {
  id: string;
  titulo: string;
  item_tipo: string;
  item_id: string;
  proposta: unknown;
};

type Revisao = { aprovado?: boolean; motivos?: string[]; voltas?: number };

// Campos extras que o orquestrador grava na proposta.
type Proposta = { avisos?: string[]; revisao?: Revisao; [campo: string]: unknown };

// campoTexto: nome do campo da proposta que é o texto a ser enviado (ex.: "resposta").
// Quando informado, a tela mostra esse texto como e-mail, sem JSON.
export default function FilaAprovacao({ area, campoTexto }: { area: string; campoTexto?: string }) {
  const router = useRouter();
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

  function textoOriginal(item: Item): string {
    const p = item.proposta as Proposta | null;
    if (campoTexto) return String(p?.[campoTexto] ?? "");
    return JSON.stringify(item.proposta, null, 2);
  }

  function abrir(item: Item) {
    if (aberto === item.id) {
      setAberto(null);
      return;
    }
    setAberto(item.id);
    setTexto(textoOriginal(item));
    setObservacao("");
    setErro("");
  }

  async function decidir(item: Item, decisao: "aprovada" | "editada" | "rejeitada") {
    setErro("");
    let proposta: unknown;
    if (decisao === "aprovada" && campoTexto && texto !== textoOriginal(item)) {
      setErro("Você alterou o texto. Use \"Salvar edição e aprovar\".");
      return;
    }
    if (decisao === "editada") {
      if (campoTexto) {
        proposta = { ...(item.proposta as object), [campoTexto]: texto };
      } else {
        try {
          proposta = JSON.parse(texto);
        } catch {
          setErro("A proposta editada não é um JSON válido.");
          return;
        }
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
    router.refresh();
  }

  if (itens.length === 0) return <p>Nenhum item pendente.</p>;

  return (
    <div>
      {itens.map((item) => {
        const p = (item.proposta ?? {}) as Proposta;
        const avisos = p.avisos ?? [];
        const revisao = p.revisao;
        return (
          <div key={item.id} className="fila-item">
            <button type="button" className="titulo secundario" onClick={() => abrir(item)}>
              {item.titulo}
              {avisos.length > 0 && <span className="tag erro">validar</span>}
            </button>
            {aberto === item.id && (
              <div className="fila-corpo">
                {avisos.length > 0 && (
                  <div className="aviso-validar">
                    <strong>Validar antes de aprovar</strong>
                    <ul>
                      {avisos.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {revisao?.aprovado === false && (
                  <div className="aviso-validar">
                    <strong>O revisor não aprovou após {revisao.voltas ?? 0} volta(s):</strong>
                    <ul>
                      {(revisao.motivos ?? []).map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {campoTexto ? (
                  <label>
                    E-mail para o cliente (editável)
                    <textarea
                      className="email-editor"
                      value={texto}
                      onChange={(e) => setTexto(e.target.value)}
                    />
                  </label>
                ) : (
                  <label>
                    Proposta (editável, em JSON)
                    <textarea value={texto} onChange={(e) => setTexto(e.target.value)} />
                  </label>
                )}
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
        );
      })}
    </div>
  );
}
