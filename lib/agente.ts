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

// Índice da "}" que fecha o objeto que começa em `inicio`, ignorando chaves dentro de strings.
function fimDoObjeto(texto: string, inicio: number): number {
  let profundidade = 0;
  let emString = false;
  let escape = false;
  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i];
    if (emString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') emString = false;
      continue;
    }
    if (c === '"') emString = true;
    else if (c === "{") profundidade++;
    else if (c === "}") {
      profundidade--;
      if (profundidade === 0) return i;
    }
  }
  return -1;
}

// Aceita JSON puro, embrulhado em cerca de código ou com texto ao redor.
// Se o modelo escrever mais de um objeto (ex.: uma "correção" no meio), vale o último
// objeto JSON válido. Se nenhum for válido, lança erro: é falha do agente.
function lerJson(texto: string) {
  let ultimo: { valor: unknown } | null = null;
  for (let s = texto.indexOf("{"); s >= 0; s = texto.indexOf("{", s + 1)) {
    const fim = fimDoObjeto(texto, s);
    if (fim < 0) continue;
    try {
      ultimo = { valor: JSON.parse(texto.slice(s, fim + 1)) };
      s = fim;
    } catch {
      // não é JSON válido a partir daqui; tenta o próximo "{"
    }
  }
  if (!ultimo) throw new SyntaxError("nenhum objeto JSON válido na resposta");
  return ultimo.valor;
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

    if (resposta.stop_reason === "max_tokens") {
      throw new Error(
        `Resposta do ${papel} cortada pelo limite de 2000 tokens antes do JSON terminar.`
      );
    }

    let saida: any;
    try {
      saida = lerJson(texto);
    } catch {
      // Guarda o texto completo (até 4000 caracteres) para diagnóstico na linha do tempo.
      throw new Error(`Resposta do ${papel} não é JSON válido: ${texto.slice(0, 4000)}`);
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
