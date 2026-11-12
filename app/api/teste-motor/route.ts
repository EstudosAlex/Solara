// TEMPORÁRIO: apagar junto com app/teste-motor/ quando Vendas estiver pronta.
import { NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase/servidor";
import { perfilDaRequisicao } from "@/lib/perfil";

export const maxDuration = 60;

const ITEM_ID = "TESTE001";
const base = { area: "vendas", item_tipo: "pedido", item_id: ITEM_ID } as const;

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: Request) {
  const quem = await perfilDaRequisicao();
  if (quem?.papel !== "admin") {
    return NextResponse.json({ erro: "Acesso negado." }, { status: 403 });
  }
  const { acao } = await req.json();
  const banco = criarClienteAdmin();

  if (acao === "limpar") {
    await banco.from("execucoes_agentes").delete().eq("item_id", ITEM_ID);
    await banco.from("aprovacoes").delete().eq("item_id", ITEM_ID);
    return NextResponse.json({ ok: true });
  }

  if (acao === "simular") {
    const { data: raiz } = await banco
      .from("execucoes_agentes")
      .insert({ ...base, agente: "orquestrador", status: "rodando", entrada: { cod_pedido: ITEM_ID } })
      .select("id")
      .single();
    const chamado_por = raiz!.id;

    async function rodar(nome: string, saida: unknown, ms: number) {
      const { data } = await banco
        .from("execucoes_agentes")
        .insert({ ...base, agente: nome, chamado_por, status: "rodando", entrada: { simulado: true } })
        .select("id")
        .single();
      await pausa(ms);
      await banco
        .from("execucoes_agentes")
        .update({
          status: "ok",
          saida,
          tokens_entrada: 400,
          tokens_saida: 150,
          fim: new Date().toISOString(),
        })
        .eq("id", data!.id);
    }

    await rodar("triador", { tipo: "orcamento" }, 1500);
    await rodar("pesquisador", { itens: [] }, 1500);
    await rodar("redator", { resposta: "Rascunho 1", resumo: "teste" }, 1500);
    await rodar("revisor", { aprovado: false, motivos: ["prazo sem estoque"] }, 1000);
    await rodar("redator", { resposta: "Rascunho 2", resumo: "teste" }, 1500);
    await rodar("revisor", { aprovado: true, motivos: [] }, 1000);

    await banco
      .from("execucoes_agentes")
      .update({ status: "ok", fim: new Date().toISOString() })
      .eq("id", chamado_por);
    await banco.from("aprovacoes").insert({
      ...base,
      titulo: "Cliente de Teste · orçamento de parafusos",
      proposta: { resposta: "Olá! Segue o orçamento...", resumo: "teste" },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ erro: "Ação inválida." }, { status: 400 });
}
