import fs from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { criarClienteAdmin } from "@/lib/supabase/servidor";

export type Papel =
  | "triador"
  | "pesquisador"
  | "redator"
  | "revisor"
  | "investigador"
  | "consolidador";

export type ContextoAgente = {
  area: "vendas" | "financeiro";
  item_tipo: "pedido" | "divergencia";
  item_id: string;
  chamado_por?: string | null;
};

const MODELO = "claude-sonnet-4-6";

// Aceita JSON puro ou embrulhado em cerca de código.
function lerJson(texto: string) {
  const limpo = texto
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(limpo);
}

export async function agente(
  papel: Papel,
  entrada: Record<string, unknown>,
  contexto: ContextoAgente
): Promise<{ saida: any; execucao_id: string }> {
  const banco = criarClienteAdmin();

  const { data: linha, error: erroInsert } = await banco
    .from("execucoes_agentes")
    .insert({
      area: contexto.area,
      item_tipo: contexto.item_tipo,
      item_id: contexto.item_id,
      agente: papel,
      chamado_por: contexto.chamado_por ?? null,
      status: "rodando",
      entrada,
      inicio: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (erroInsert || !linha) {
    throw new Error(`Falha ao registrar execução: ${erroInsert?.message}`);
  }
  const execucao_id: string = linha.id;

  let tokens_entrada: number | undefined;
  let tokens_saida: number | undefined;

  try {
    const arquivo = path.join(process.cwd(), "prompts", contexto.area, `${papel}.md`);
    const system = await fs.readFile(arquivo, "utf-8");

    const cliente = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resposta = await cliente.messages.create({
      model: MODELO,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: JSON.stringify(entrada) }],
    });
    tokens_entrada = resposta.usage.input_tokens;
    tokens_saida = resposta.usage.output_tokens;

    const texto = resposta.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");

    let saida: any;
    try {
      saida = lerJson(texto);
    } catch {
      throw new Error(`Resposta do ${papel} não é JSON válido: ${texto.slice(0, 200)}`);
    }

    await banco
      .from("execucoes_agentes")
      .update({
        status: "ok",
        saida,
        tokens_entrada,
        tokens_saida,
        fim: new Date().toISOString(),
      })
      .eq("id", execucao_id);

    return { saida, execucao_id };
  } catch (e) {
    await banco
      .from("execucoes_agentes")
      .update({
        status: "erro",
        erro: e instanceof Error ? e.message : String(e),
        tokens_entrada,
        tokens_saida,
        fim: new Date().toISOString(),
      })
      .eq("id", execucao_id);
    throw e;
  }
}
