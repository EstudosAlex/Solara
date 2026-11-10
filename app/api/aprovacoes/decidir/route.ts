import { NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase/servidor";
import { perfilDaRequisicao } from "@/lib/perfil";

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
    .select("id, area, status")
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
  return NextResponse.json({ ok: true });
}
