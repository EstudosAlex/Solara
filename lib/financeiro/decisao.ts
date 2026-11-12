// Decisão na fila para divergências do financeiro.
import { criarClienteAdmin } from "@/lib/supabase/servidor";

type Hipotese = {
  hipotese?: string;
  cod_titulos_envolvidos?: string[];
  valor_a_baixar?: number;
  valor_pendente?: number;
};

// Aprovar ou editar: divergência resolvida e títulos do ERP atualizados.
// Rejeitar: divergência volta para nova (a observação fica em aprovacoes).
export async function decidirDivergencia(
  divergencia_id: string,
  decisao: "aprovada" | "editada" | "rejeitada"
) {
  const banco = criarClienteAdmin();

  if (decisao === "rejeitada") {
    const { error } = await banco
      .from("divergencias")
      .update({ status: "nova" })
      .eq("id", divergencia_id);
    if (error) throw new Error(error.message);
    return;
  }

  const { data: div, error: erroLeitura } = await banco
    .from("divergencias")
    .select("id, hipotese")
    .eq("id", divergencia_id)
    .maybeSingle();
  if (erroLeitura || !div) throw new Error("Divergência não encontrada.");

  const h = (div.hipotese ?? {}) as Hipotese;
  const titulos = h.cod_titulos_envolvidos ?? [];
  const baixa = h.hipotese === "vencido_sem_pagamento" || Number(h.valor_a_baixar ?? 0) > 0;

  if (titulos.length > 0 && baixa) {
    const status =
      h.hipotese === "vencido_sem_pagamento"
        ? "vencido"
        : Number(h.valor_pendente ?? 0) > 0
          ? "pago_parcial"
          : "pago";
    // Só atualiza títulos que estão na tabela do ERP. Títulos de planilha enviada não são guardados.
    const { error } = await banco.from("titulos_receber").update({ status }).in("cod_titulo", titulos);
    if (error) throw new Error(error.message);
  }

  const { error } = await banco
    .from("divergencias")
    .update({ status: "resolvida" })
    .eq("id", divergencia_id);
  if (error) throw new Error(error.message);
}
