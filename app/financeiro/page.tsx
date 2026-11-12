import Link from "next/link";
import { redirect } from "next/navigation";
import { obterPerfil } from "@/lib/perfil";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import ImportarExtrato from "@/components/ImportarExtrato";
import TelaFinanceiro, {
  type DivergenciaTela,
  type ExtratoTela,
  type LancamentoTela,
} from "@/components/TelaFinanceiro";

export default async function PaginaFinanceiro() {
  const { perfil } = await obterPerfil();
  if (!perfil?.areas.includes("financeiro")) redirect("/");

  const supabase = await criarClienteServidor();
  const { data: ultimo } = await supabase
    .from("extratos_importados")
    .select("id, nome_arquivo, importado_em, total_linhas, total_creditos")
    .order("importado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  let extrato: ExtratoTela | null = null;
  let lancamentos: LancamentoTela[] = [];
  let divergencias: DivergenciaTela[] = [];
  let relatorio: string | null = null;

  if (ultimo) {
    extrato = ultimo as ExtratoTela;
    const [l, d, c] = await Promise.all([
      supabase
        .from("lancamentos")
        .select("id, data, descricao, valor, tipo, situacao, cod_titulo_casado")
        .eq("extrato_id", ultimo.id)
        .order("data"),
      supabase
        .from("divergencias")
        .select("id, tipo_inicial, lancamento_id, cod_titulo, valor_lancamento, valor_titulo, status, hipotese")
        .eq("extrato_id", ultimo.id),
      supabase
        .from("execucoes_agentes")
        .select("saida")
        .eq("item_id", ultimo.id)
        .eq("agente", "consolidador")
        .eq("status", "ok")
        .order("inicio", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    lancamentos = (l.data ?? []) as LancamentoTela[];
    divergencias = (d.data ?? []) as DivergenciaTela[];
    relatorio = (c.data?.saida as { relatorio_markdown?: string } | null)?.relatorio_markdown ?? null;
  }

  return (
    <main className="amplo">
      <p>
        <Link href="/">← Voltar</Link>
      </p>
      <h1>Financeiro</h1>
      <ImportarExtrato />
      <TelaFinanceiro
        extrato={extrato}
        lancamentos={lancamentos}
        divergencias={divergencias}
        relatorio={relatorio}
      />
    </main>
  );
}
