import { NextResponse } from "next/server";
import { perfilDaRequisicao } from "@/lib/perfil";
import { ErroConciliacao, processarConciliacao } from "@/lib/orquestradores/financeiro";

export const maxDuration = 60;

export async function POST(req: Request) {
  const quem = await perfilDaRequisicao();
  if (!quem) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }
  if (!quem.areas.includes("financeiro")) {
    return NextResponse.json({ erro: "Sem acesso a esta área." }, { status: 403 });
  }

  const { extrato_id } = await req.json();
  if (!extrato_id || typeof extrato_id !== "string") {
    return NextResponse.json({ erro: "Informe extrato_id." }, { status: 400 });
  }

  try {
    const resultado = await processarConciliacao(extrato_id);
    return NextResponse.json({ ok: true, ...resultado });
  } catch (e) {
    if (e instanceof ErroConciliacao) {
      return NextResponse.json({ erro: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { erro: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
