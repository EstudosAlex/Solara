import { NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase/servidor";
import { perfilDaRequisicao } from "@/lib/perfil";
import { decidirDivergencia } from "@/lib/financeiro/decisao";

const DECISOES = ["aprovada", "editada", "rejeitada"];

export async function POST(req: Request) {
  const quem = await perfilDaRequisicao();
  if (!quem) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const { id, decisao, proposta, observacao } = await req.json();
  if (!id || !DECISOES.includes(decisao)) {
    return NextResponse.json({ erro: "Pedido inválido." }, { status: 400 });
  }
  if (decisao === "rejeitada" && !observacao?.trim()) {
    return NextResponse.json({ erro: "Informe a observação da rejeição." }, { status: 400 });
  }

  const admin = criarClienteAdmin();
  const { data: item } = await admin
    .from("aprovacoes")
    .select("id, area, status, item_tipo, item_id")
    .eq("id", id)
    .maybeSingle();
  if (!item) {
    return NextResponse.json({ erro: "Item não encontrado." }, { status: 404 });
  }
  if (!quem.areas.includes(item.area)) {
    return NextResponse.json({ erro: "Sem acesso a esta área." }, { status: 403 });
  }
  if (item.status !== "pendente") {
    return NextResponse.json({ erro: "Este item já foi decidido." }, { status: 409 });
  }

  const alteracoes: Record<string, unknown> = {
    status: decisao,
    decidido_por: quem.id,
    decidido_em: new Date().toISOString(),
    observacao: observacao ?? null,
  };
  if (decisao === "editada") alteracoes.proposta = proposta;

  const { error } = await admin
    .from("aprovacoes")
    .update(alteracoes)
    .eq("id", id)
    .eq("status", "pendente");
  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }

  // Financeiro: a decisão resolve ou devolve a divergência e atualiza os títulos.
  if (item.area === "financeiro" && item.item_tipo === "divergencia") {
    try {
      await decidirDivergencia(item.item_id, decisao);
    } catch (e) {
      return NextResponse.json(
        { erro: e instanceof Error ? e.message : String(e) },
        { status: 500 }
      );
    }
  }

  // Move o card do pedido: aprovar/editar -> respondido; rejeitar -> rejeitado.
  if (item.area === "vendas" && item.item_tipo === "pedido") {
    const novoStatusPedido = decisao === "rejeitada" ? "rejeitado" : "respondido";
    const { error: erroPedido } = await admin
      .from("pedidos_orcamento")
      .update({ status: novoStatusPedido })
      .eq("cod_pedido", item.item_id)
      .eq("status", "aguardando_aprovacao");
    if (erroPedido) {
      return NextResponse.json({ erro: erroPedido.message }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true });
}
