import { agente } from "@/lib/agente";
import { criarClienteAdmin } from "@/lib/supabase/servidor";

export class ErroConciliacao extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

const LIMITE_CONFIANCA = 0.7;

const reais = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const rotulo = (hipotese: string) => hipotese.replace(/_/g, " ");

function textoDaHipotese(h: Record<string, unknown>): string {
  const conf = Math.round(Number(h.confianca ?? 0) * 100);
  return [
    `Hipótese: ${rotulo(String(h.hipotese))} (confiança ${conf}%)`,
    "",
    String(h.explicacao ?? ""),
    "",
    `Ação sugerida: ${h.acao_sugerida ?? ""}`,
  ].join("\n");
}

type Candidato = {
  cod_titulo: string;
  cod_cliente: string | null;
  nome_cliente: string | null;
  nota_fiscal: string | null;
  valor: number;
  vencimento: string | null;
  status: string | null;
};

type DivergenciaRow = {
  id: string;
  tipo_inicial: string;
  lancamento_id: string | null;
  cod_titulo: string | null;
  valor_lancamento: number | null;
  valor_titulo: number | null;
  hipotese: { titulos_candidatos?: Candidato[]; titulos_sugeridos?: string[] } | null;
};

// Conciliação: Investigadores (um por divergência, em paralelo), Consolidador e Revisor.
// Código comum: o modelo não decide a sequência.
export async function processarConciliacao(extrato_id: string) {
  const banco = criarClienteAdmin();

  const { data: extrato } = await banco
    .from("extratos_importados")
    .select("id")
    .eq("id", extrato_id)
    .maybeSingle();
  if (!extrato) throw new ErroConciliacao("Extrato não encontrado.", 404);

  const { data: pendentes, error: erroPend } = await banco
    .from("divergencias")
    .select("id, tipo_inicial, lancamento_id, cod_titulo, valor_lancamento, valor_titulo, hipotese")
    .eq("extrato_id", extrato_id)
    .eq("status", "nova");
  if (erroPend) throw new Error(erroPend.message);
  const divergencias = (pendentes ?? []) as DivergenciaRow[];
  if (divergencias.length === 0) {
    return { investigadas: 0, mensagem: "Nenhuma divergência nova para investigar." };
  }

  const { data: lancs } = await banco.from("lancamentos").select("*").eq("extrato_id", extrato_id);
  const lancPorId = new Map((lancs ?? []).map((l) => [l.id, l]));

  const { data: raiz, error: erroRaiz } = await banco
    .from("execucoes_agentes")
    .insert({
      area: "financeiro",
      item_tipo: "divergencia",
      item_id: extrato_id,
      agente: "orquestrador",
      status: "rodando",
      entrada: { extrato_id, divergencias: divergencias.length },
      inicio: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (erroRaiz || !raiz) throw new Error(`Falha ao registrar execução raiz: ${erroRaiz?.message}`);

  const contexto = {
    area: "financeiro" as const,
    item_tipo: "divergencia" as const,
    item_id: extrato_id,
    chamado_por: raiz.id,
  };

  async function fecharRaiz(status: "ok" | "erro", saida: unknown, erro?: string) {
    await banco
      .from("execucoes_agentes")
      .update({ status, saida, erro: erro ?? null, fim: new Date().toISOString() })
      .eq("id", raiz!.id);
  }

  await banco
    .from("divergencias")
    .update({ status: "investigando" })
    .in("id", divergencias.map((d) => d.id));

  try {
    // 1. Investigadores em paralelo. Uma falha volta só aquela divergência para "nova".
    const resultados = await Promise.all(
      divergencias.map(async (d) => {
        const l = d.lancamento_id ? lancPorId.get(d.lancamento_id) : undefined;
        const candidatos = d.hipotese?.titulos_candidatos ?? [];
        try {
          const { saida } = await agente(
            "investigador",
            {
              divergencia_id: d.id,
              divergencia: {
                tipo_inicial: d.tipo_inicial,
                valor_lancamento: d.valor_lancamento,
                valor_titulo: d.valor_titulo,
              },
              lancamento: l ? { data: l.data, descricao: l.descricao, valor: Number(l.valor) } : null,
              titulos_candidatos: candidatos,
            },
            contexto
          );
          // Guarda a hipótese mantendo os candidatos, para uma nova conciliação se a divergência voltar.
          await banco
            .from("divergencias")
            .update({ hipotese: { titulos_candidatos: candidatos, titulos_sugeridos: d.hipotese?.titulos_sugeridos ?? [], ...saida } })
            .eq("id", d.id);

          const titular = candidatos.find((c) => c.cod_titulo === d.cod_titulo);
          return {
            ok: true as const,
            d,
            saida,
            candidatos,
            valor: Math.abs(d.valor_lancamento ?? d.valor_titulo ?? 0),
            referencia: titular?.nome_cliente ?? l?.descricao ?? d.cod_titulo ?? "sem identificação",
          };
        } catch (e) {
          await banco.from("divergencias").update({ status: "nova" }).eq("id", d.id);
          return { ok: false as const, d, erro: e instanceof Error ? e.message : String(e) };
        }
      })
    );

    const investigadas = resultados.filter((r) => r.ok);
    const falhas = resultados.filter((r) => !r.ok);
    if (investigadas.length === 0) {
      throw new Error(`Nenhum investigador concluiu: ${falhas[0] && !falhas[0].ok ? falhas[0].erro : ""}`);
    }

    // Resumo do casamento, calculado a partir do banco
    const casados = (lancs ?? []).filter((l) => l.situacao === "casado");
    const datas = (lancs ?? []).map((l) => l.data as string).sort();
    const br = (iso: string) => iso.split("-").reverse().join("/");
    const resumo_casamento = {
      qtd_casados: casados.length,
      valor_casado: casados.reduce((a, l) => a + Number(l.valor), 0),
      qtd_divergencias: investigadas.length,
      valor_divergente: investigadas.reduce((a, r) => a + r.valor, 0),
      periodo: datas.length ? `${br(datas[0])} a ${br(datas[datas.length - 1])}` : "",
    };

    const hipoteses = investigadas.map((r) => ({ referencia: r.referencia, ...r.saida }));
    const titulosAbertos = new Map<string, Candidato>();
    for (const r of investigadas) {
      for (const c of r.candidatos) titulosAbertos.set(c.cod_titulo, c);
    }
    const titulos_abertos = [...titulosAbertos.values()].map((c) => ({
      cod_titulo: c.cod_titulo,
      valor: c.valor,
      cod_cliente: c.cod_cliente,
      vencimento: c.vencimento,
    }));

    // 2. Consolidador e Revisor. Se o Revisor reprovar, o Consolidador refaz uma vez.
    let consolidado = (await agente("consolidador", { resumo_casamento, hipoteses }, contexto)).saida;
    let revisao = (
      await agente("revisor", { hipoteses, titulos_abertos, relatorio: consolidado }, contexto)
    ).saida;
    if (revisao.aprovado !== true) {
      consolidado = (
        await agente(
          "consolidador",
          { resumo_casamento, hipoteses, ajustes: revisao.motivos },
          contexto
        )
      ).saida;
      revisao = (
        await agente("revisor", { hipoteses, titulos_abertos, relatorio: consolidado }, contexto)
      ).saida;
    }
    const aprovado = revisao.aprovado === true;
    const motivos: string[] = revisao.motivos ?? [];

    // 3. Uma aprovação por hipótese. Divergências vão para aguardando_aprovacao.
    const itensAprovacao = investigadas.map((r) => {
      const h = r.saida;
      const confianca = Number(h.confianca ?? 0);
      const avisos: string[] = [];
      if (confianca < LIMITE_CONFIANCA) avisos.push("Confiança baixa: confirmar antes de aprovar.");
      if (!aprovado) motivos.forEach((m) => avisos.push(`Revisor: ${m}`));
      return {
        area: "financeiro",
        item_tipo: "divergencia",
        item_id: r.d.id,
        titulo: `${rotulo(String(h.hipotese))} · ${r.referencia} · ${reais(r.valor)}`,
        proposta: {
          texto: textoDaHipotese(h),
          hipotese: h.hipotese,
          explicacao: h.explicacao,
          confianca,
          acao_sugerida: h.acao_sugerida,
          cod_titulos_envolvidos: h.cod_titulos_envolvidos ?? [],
          valor_a_baixar: h.valor_a_baixar ?? 0,
          valor_pendente: h.valor_pendente ?? 0,
          avisos,
        },
      };
    });

    const { error: erroAprov } = await banco.from("aprovacoes").insert(itensAprovacao);
    if (erroAprov) throw new Error(erroAprov.message);

    await banco
      .from("divergencias")
      .update({ status: "aguardando_aprovacao" })
      .in("id", investigadas.map((r) => r.d.id));

    await fecharRaiz("ok", {
      investigadas: investigadas.length,
      falhas: falhas.length,
      revisor_aprovado: aprovado,
    });
    return {
      investigadas: investigadas.length,
      falhas: falhas.length,
      revisor_aprovado: aprovado,
      execucao_raiz: raiz.id,
    };
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e);
    await fecharRaiz("erro", null, mensagem);
    // Divergências que ficaram em "investigando" voltam para "nova".
    await banco
      .from("divergencias")
      .update({ status: "nova" })
      .in("id", divergencias.map((d) => d.id))
      .eq("status", "investigando");
    throw e;
  }
}
