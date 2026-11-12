"use client";

// TEMPORÁRIO: apagar quando Vendas estiver pronta.
import { useState } from "react";
import Organograma from "@/components/Organograma";
import LinhaDoTempo from "@/components/LinhaDoTempo";
import FilaAprovacao from "@/components/FilaAprovacao";

export default function TesteMotor() {
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState("");

  async function acao(nome: "simular" | "limpar") {
    setOcupado(true);
    setResultado("");
    const resp = await fetch("/api/teste-motor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: nome }),
    });
    const corpo = await resp.json().catch(() => ({}));
    setResultado(resp.ok ? JSON.stringify(corpo, null, 2) : `Erro: ${corpo.erro ?? resp.status}`);
    setOcupado(false);
  }

  return (
    <>
      <div className="fila-botoes">
        <button disabled={ocupado} onClick={() => acao("simular")}>
          Simular pedido (≈9 s)
        </button>
        <button className="perigo" disabled={ocupado} onClick={() => acao("limpar")}>
          Limpar dados de teste
        </button>
      </div>
      {resultado && <pre>{resultado}</pre>}

      <h2>Organograma</h2>
      <Organograma area="vendas" item_id="TESTE001" />
      <h2>Linha do tempo</h2>
      <LinhaDoTempo item_id="TESTE001" />
      <h2>Fila de aprovação (vendas)</h2>
      <FilaAprovacao area="vendas" />
    </>
  );
}
