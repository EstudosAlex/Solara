import { agente } from "@/lib/agente";
import { criarClienteAdmin } from "@/lib/supabase/servidor";

export class ErroPedido extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

const TIPOS_ORCAMENTO = ["orcamento", "complemento"];
const MAX_VOLTAS = 2;
// As regras do Revisor estão no system prompt (prompts/vendas/revisor.md).
const REGRAS = "conforme o system prompt";

const STOPWORDS = new Set([
  "para", "com", "dos", "das", "uns", "umas", "pra", "tem", "mais", "sem",
  "uma", "um", "que", "por", "favor", "preciso", "quero", "cotar", "preço",
  "preco", "entrega", "prazo", "quanto", "fica", "manda", "pedido",
]);

// Palavras-chave da descrição do cliente, para a busca no catálogo.
function palavrasChave(texto: string): string[] {
  return texto
    .toLowerCase()
    .replace(/[(),%*_"'\\]/g, " ")
    .split(/\s+/)
    .filter((p) => p.length >= 3 || /\d/.test(p))
    .filter((p) => !STOPWORDS.has(p))
    .slice(0, 5);
}

// Busca por semelhança de descrição. Código, não modelo.
async function buscarCandidatos(banco: ReturnType<typeof criarClienteAdmin>, descricao: string) {
  const palavras = palavrasChave(descricao);
  if (palavras.length === 0) return [];
  const { data, error } = await banco
    .from("produtos")
    .select("cod_produto, descricao, unidade, preco_unitario, preco_acima_100_un, estoque, prazo_reposicao_dias")
    .or(palavras.map((p) => `descricao.ilike.%${p}%`).join(","))
    .limit(12);
  if (error) throw new Error(`Falha na busca de produtos: ${error.message}`);
  return data ?? [];
}

// Pedidos do mesmo cliente nos últimos 30 dias (exceto o atual).
async function buscarPedidosAnteriores(
  banco: ReturnType<typeof criarClienteAdmin>,
  cod_cliente: string,
  cod_pedido: string
) {
  const limite = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data, error } = await banco
    .from("pedidos_orcamento")
    .select("cod_pedido, data, status, mensagem")
    .eq("cod_cliente", cod_cliente)
    .neq("cod_pedido", cod_pedido)
    .gte("data", limite)
    .order("data", { ascending: false })
    .limit(10);
  if (error) throw new Error(`Falha ao buscar pedidos anteriores: ${error.message}`);
  return data ?? [];
}

// Orquestrador de Vendas. Código comum: o modelo não decide a sequência.
export async function processarPedidoVendas(cod_pedido: string) {
  const banco = criarClienteAdmin();

  // Reserva o pedido: só avança se ainda estiver em "novo".
  const { data: pedido } = await banco
    .from("pedidos_orcamento")
    .update({ status: "processando" })
    .eq("cod_pedido", cod_pedido)
    .eq("status", "novo")
    .select("cod_pedido, cod_cliente, canal, mensagem")
    .maybeSingle();
  if (!pedido) {
    throw new ErroPedido("Pedido não encontrado ou já processado.", 409);
  }

  const { data: cliente } = pedido.cod_cliente
    ? await banco.from("Clientes").select("*").eq("cod_cliente", pedido.cod_cliente).maybeSingle()
    : { data: null };

  const { data: raiz, error: erroRaiz } = await banco
    .from("execucoes_agentes")
    .insert({
      area: "vendas",
      item_tipo: "pedido",
      item_id: cod_pedido,
      agente: "orquestrador",
      status: "rodando",
      entrada: { cod_pedido },
      inicio: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (erroRaiz || !raiz) {
    await banco.from("pedidos_orcamento").update({ status: "novo" }).eq("cod_pedido", cod_pedido);
    throw new Error(`Falha ao registrar execução raiz: ${erroRaiz?.message}`);
  }

  const contexto = {
    area: "vendas" as const,
    item_tipo: "pedido" as const,
    item_id: cod_pedido,
    chamado_por: raiz.id,
  };

  async function fecharRaiz(status: "ok" | "erro", saida: unknown, erro?: string) {
    await banco
      .from("execucoes_agentes")
      .update({ status, saida, erro: erro ?? null, fim: new Date().toISOString() })
      .eq("id", raiz!.id);
  }

  try {
    // 1. Triador
    const { saida: triagem } = await agente(
      "triador",
      {
        mensagem: pedido.mensagem ?? "",
        canal: pedido.canal ?? "",
        cliente: {
          cod_cliente: cliente?.cod_cliente ?? null,
          nome: cliente?.nome ?? null,
          segmento: cliente?.segmento ?? null,
        },
      },
      contexto
    );

    if (!TIPOS_ORCAMENTO.includes(triagem.tipo)) {
      await banco.from("aprovacoes").insert({
        area: "vendas",
        item_tipo: "pedido",
        item_id: cod_pedido,
        titulo: `Não é orçamento: ${triagem.tipo}`,
        proposta: {
          resposta: `Mensagem classificada como "${triagem.tipo}". ${triagem.observacoes ?? ""}`.trim(),
          triagem,
          avisos: [`Não é orçamento (${triagem.tipo}). Validar antes de aprovar.`],
        },
      });
      await banco
        .from("pedidos_orcamento")
        .update({ status: "aguardando_aprovacao" })
        .eq("cod_pedido", cod_pedido);
      await fecharRaiz("ok", { tipo: triagem.tipo });
      return { tipo: triagem.tipo as string, execucao_raiz: raiz.id };
    }

    if (!cliente) {
      throw new ErroPedido("Pedido sem cliente cadastrado: não dá para cotar.", 422);
    }

    // 2. Pesquisador: as duas consultas em paralelo
    const [candidatos, pedidosAnteriores] = await Promise.all([
      Promise.all(
        triagem.itens.map(async (item: { descricao_cliente: string }) => ({
          descricao_cliente: item.descricao_cliente,
          candidatos: await buscarCandidatos(banco, item.descricao_cliente),
        }))
      ),
      buscarPedidosAnteriores(banco, cliente.cod_cliente, cod_pedido),
    ]);

    const { saida: contexto_comercial } = await agente(
      "pesquisador",
      {
        itens_pedidos: triagem.itens,
        candidatos_catalogo: candidatos,
        cliente,
        pedidos_anteriores: pedidosAnteriores,
      },
      contexto
    );

    // 3. Redator e Revisor, com até MAX_VOLTAS voltas do Redator
    const entradaRedator = { triagem, contexto: contexto_comercial, cliente };
    let redacao = await agente("redator", entradaRedator, contexto);
    let revisao = await agente(
      "revisor",
      { resposta: redacao.saida.resposta, contexto: contexto_comercial, regras: REGRAS },
      contexto
    );

    let voltas = 0;
    while (revisao.saida.aprovado !== true && voltas < MAX_VOLTAS) {
      voltas++;
      redacao = await agente(
        "redator",
        { ...entradaRedator, ajustes: revisao.saida.motivos },
        contexto
      );
      revisao = await agente(
        "revisor",
        { resposta: redacao.saida.resposta, contexto: contexto_comercial, regras: REGRAS },
        contexto
      );
    }

    const aprovado = revisao.saida.aprovado === true;
    const motivos: string[] = revisao.saida.motivos ?? [];

    // 4. Item na fila de aprovação (motivos anexados se o Revisor não aprovou)
    await banco.from("aprovacoes").insert({
      area: "vendas",
      item_tipo: "pedido",
      item_id: cod_pedido,
      titulo: `${cliente.nome} · ${redacao.saida.resumo ?? "orçamento"}`,
      proposta: {
        resposta: redacao.saida.resposta,
        triagem,
        contexto: contexto_comercial,
        revisao: { aprovado, motivos, voltas },
        avisos: (contexto_comercial.itens ?? [])
          .filter((i: { existe?: boolean }) => i.existe === false)
          .map(
            (i: { descricao_cliente: string }) =>
              `Não vendemos: ${i.descricao_cliente}. Validar antes de aprovar.`
          ),
      },
    });
    await banco
      .from("pedidos_orcamento")
      .update({ status: "aguardando_aprovacao" })
      .eq("cod_pedido", cod_pedido);

    await fecharRaiz("ok", { tipo: triagem.tipo, aprovado, voltas });
    return { tipo: triagem.tipo as string, aprovado, voltas, execucao_raiz: raiz.id };
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e);
    await fecharRaiz("erro", null, mensagem);
    await banco.from("pedidos_orcamento").update({ status: "novo" }).eq("cod_pedido", cod_pedido);
    throw e;
  }
}
