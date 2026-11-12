import { NextResponse } from "next/server";
import { perfilDaRequisicao } from "@/lib/perfil";
import { ErroPedido, processarPedidoVendas } from "@/lib/orquestradores/vendas";

export const maxDuration = 60;

export async function POST(req: Request) {
  const quem = await perfilDaRequisicao();
  if (!quem) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }
  if (!quem.areas.includes("vendas")) {
    return NextResponse.json({ erro: "Sem acesso a esta área." }, { status: 403 });
  }

  const { cod_pedido } = await req.json();
  if (!cod_pedido || typeof cod_pedido !== "string") {
    return NextResponse.json({ erro: "Informe cod_pedido." }, { status: 400 });
  }

  try {
    const resultado = await processarPedidoVendas(cod_pedido);
    return NextResponse.json({ ok: true, ...resultado });
  } catch (e) {
    if (e instanceof ErroPedido) {
      return NextResponse.json({ erro: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { erro: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
