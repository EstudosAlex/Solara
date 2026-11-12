import { NextResponse } from "next/server";
import { perfilDaRequisicao } from "@/lib/perfil";
import { criarClienteAdmin } from "@/lib/supabase/servidor";
import { decodificar, limparExtrato, lerTitulos, type TituloLimpo } from "@/lib/financeiro/limpar";
import { casar } from "@/lib/financeiro/casar";

export const maxDuration = 60;

const soma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// Upload do extrato (obrigatório) e dos títulos (opcional).
// Limpeza e casamento rodam aqui, em código. O Conciliar é que chama os agentes.
export async function POST(req: Request) {
  const quem = await perfilDaRequisicao();
  if (!quem) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }
  if (!quem.areas.includes("financeiro")) {
    return NextResponse.json({ erro: "Sem acesso a esta área." }, { status: 403 });
  }

  const form = await req.formData();
  const extratoArq = form.get("extrato");
  const titulosArq = form.get("titulos");
  if (!(extratoArq instanceof File) || extratoArq.size === 0) {
    return NextResponse.json({ erro: "Envie o arquivo do extrato." }, { status: 400 });
  }

  let limpo;
  try {
    limpo = limparExtrato(decodificar(await extratoArq.arrayBuffer()));
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  if (limpo.lancamentos.length === 0) {
    return NextResponse.json({ erro: "Nenhum lançamento encontrado no extrato." }, { status: 400 });
  }

  const banco = criarClienteAdmin();
  const { data: clientes } = await banco.from("Clientes").select("cod_cliente, nome");
  const nomes = new Map<string, string>((clientes ?? []).map((c) => [c.cod_cliente, c.nome]));

  let titulos: TituloLimpo[];
  let origem: "arquivo" | "tabela";
  if (titulosArq instanceof File && titulosArq.size > 0) {
    try {
      titulos = lerTitulos(decodificar(await titulosArq.arrayBuffer()));
    } catch (e) {
      return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
    origem = "arquivo";
  } else {
    const { data, error } = await banco
      .from("titulos_receber")
      .select("cod_titulo, cod_cliente, nota_fiscal, valor, vencimento, status");
    if (error) {
      return NextResponse.json({ erro: error.message }, { status: 500 });
    }
    titulos = (data ?? []).map((t) => ({ ...t, valor: Number(t.valor) }));
    origem = "tabela";
  }

  const r = casar(limpo.lancamentos, titulos, nomes, limpo.periodo_fim);

  const { data: extrato, error: erroExtrato } = await banco
    .from("extratos_importados")
    .insert({
      nome_arquivo: extratoArq.name,
      importado_por: quem.id,
      total_linhas: limpo.lancamentos.length,
      total_creditos: soma(limpo.lancamentos.filter((l) => l.tipo === "credito").map((l) => l.valor)),
    })
    .select("id")
    .single();
  if (erroExtrato || !extrato) {
    return NextResponse.json({ erro: erroExtrato?.message ?? "Falha ao salvar o extrato." }, { status: 500 });
  }
  const extratoId: string = extrato.id;

  const lancIds = limpo.lancamentos.map(() => crypto.randomUUID());
  const casadoCom = new Map(r.casados.map((c) => [c.lancamento_index, c.cod_titulo]));
  const { error: erroLanc } = await banco.from("lancamentos").insert(
    limpo.lancamentos.map((l, i) => ({
      id: lancIds[i],
      extrato_id: extratoId,
      data: l.data,
      descricao: l.descricao,
      valor: l.valor,
      tipo: l.tipo,
      cod_titulo_casado: casadoCom.get(i) ?? null,
      situacao: l.tipo === "debito" ? "ignorado" : casadoCom.has(i) ? "casado" : "divergente",
    }))
  );

  const { error: erroDiv } = erroLanc
    ? { error: erroLanc }
    : await banco.from("divergencias").insert(
        r.divergencias.map((d) => ({
          id: crypto.randomUUID(),
          extrato_id: extratoId,
          tipo_inicial: d.tipo_inicial,
          lancamento_id: d.lancamento_index !== null ? lancIds[d.lancamento_index] : null,
          cod_titulo: d.cod_titulo,
          valor_lancamento: d.valor_lancamento,
          valor_titulo: d.valor_titulo,
          status: "nova",
          // Candidatos ficam guardados aqui para o Investigador usar no Conciliar.
          hipotese: { titulos_candidatos: d.titulos_candidatos, titulos_sugeridos: d.titulos_sugeridos },
        }))
      );

  if (erroLanc || erroDiv) {
    await banco.from("extratos_importados").delete().eq("id", extratoId);
    return NextResponse.json({ erro: (erroLanc ?? erroDiv)?.message }, { status: 500 });
  }

  const valorCasado = soma(r.casados.map((c) => limpo.lancamentos[c.lancamento_index].valor));
  const valorDivergente = soma(
    r.divergencias.map((d) => Math.abs(d.valor_lancamento ?? d.valor_titulo ?? 0))
  );

  return NextResponse.json({
    extrato_id: extratoId,
    origem_titulos: origem,
    modo: limpo.modo,
    periodo_fim: limpo.periodo_fim,
    antes: limpo.antes,
    depois: limpo.depois,
    resumo: {
      qtd_casados: r.casados.length,
      valor_casado: valorCasado,
      qtd_divergencias: r.divergencias.length,
      valor_divergente: valorDivergente,
      qtd_ignorados: r.ignorados.length,
    },
  });
}
