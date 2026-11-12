// Limpeza de arquivos do financeiro. Código determinístico, sem modelo.

export type LancamentoLimpo = {
  data: string; // aaaa-mm-dd
  descricao: string;
  valor: number; // sempre positivo; o tipo guarda o sinal
  tipo: "credito" | "debito";
};

export type TituloLimpo = {
  cod_titulo: string;
  cod_cliente: string | null;
  nota_fiscal: string | null;
  valor: number;
  vencimento: string | null; // aaaa-mm-dd
  status: string | null;
};

export type ExtratoLimpo = {
  modo: "limpo" | "bruto";
  lancamentos: LancamentoLimpo[];
  periodo_fim: string | null;
  antes: string[]; // primeiras 6 linhas como vieram
  depois: LancamentoLimpo[]; // primeiros 6 lançamentos normalizados
};

// UTF-8 primeiro; se o arquivo não for UTF-8, lê como latin-1 (windows-1252).
export function decodificar(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

// dd/mm/aaaa ou aaaa-mm-dd -> aaaa-mm-dd. Qualquer outra coisa vira null.
export function dataParaIso(texto: string): string | null {
  const t = texto.trim();
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return null;
}

// "1.250,00" -> 1250; "-8.750,00" -> -8750; "540.00" -> 540.
export function valorParaNumero(texto: string): number | null {
  let t = texto.trim();
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function separadorDe(linha: string): string {
  return linha.includes(";") ? ";" : ",";
}

function periodoFimDe(linhas: string[]): string | null {
  for (const l of linhas) {
    const m = l.match(/Periodo:\s*(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (m) return dataParaIso(m[2]);
  }
  return null;
}

// Aceita o extrato limpo (cabeçalho cod_lancamento,data,descricao,valor,tipo)
// ou o extrato bruto do banco (cabeçalho Data;Historico;Valor (R$);Saldo (R$)).
export function limparExtrato(texto: string): ExtratoLimpo {
  const linhas = texto.replace(/\r/g, "").split("\n");
  const antes = linhas.slice(0, 6);
  const indiceCabecalho = linhas.findIndex((l) => l.trim() !== "");
  const cabecalhoOriginal = linhas[indiceCabecalho] ?? "";

  if (cabecalhoOriginal.trim().toLowerCase().startsWith("cod_lancamento")) {
    const cab = cabecalhoOriginal.trim().split(",").map((c) => c.trim().toLowerCase());
    const col = (n: string) => cab.indexOf(n);
    if (col("data") < 0 || col("descricao") < 0 || col("valor") < 0 || col("tipo") < 0) {
      throw new Error("Extrato limpo sem as colunas data, descricao, valor e tipo.");
    }
    const lancamentos: LancamentoLimpo[] = [];
    for (const l of linhas.slice(indiceCabecalho + 1)) {
      if (!l.trim()) continue;
      const c = l.split(",");
      const data = dataParaIso(c[col("data")] ?? "");
      const valor = valorParaNumero(c[col("valor")] ?? "");
      if (!data || valor === null) continue;
      lancamentos.push({
        data,
        descricao: (c[col("descricao")] ?? "").trim(),
        valor: Math.abs(valor),
        tipo: (c[col("tipo")] ?? "").trim().toLowerCase() === "debito" ? "debito" : "credito",
      });
    }
    return { modo: "limpo", lancamentos, periodo_fim: null, antes, depois: lancamentos.slice(0, 6) };
  }

  const iCab = linhas.findIndex((l) => /^\s*Data\b/i.test(l));
  if (iCab < 0) {
    throw new Error("Cabeçalho 'Data' não encontrado: o arquivo não parece um extrato do banco.");
  }
  const sep = separadorDe(linhas[iCab]);
  const cab = linhas[iCab].split(sep).map((c) => c.trim().toLowerCase());
  const iData = cab.findIndex((c) => c.startsWith("data"));
  const iHist = cab.findIndex((c) => c.includes("hist"));
  const iValor = cab.findIndex((c) => c.startsWith("valor"));
  if (iData < 0 || iHist < 0 || iValor < 0) {
    throw new Error("Extrato sem as colunas Data, Historico e Valor.");
  }

  const lancamentos: LancamentoLimpo[] = [];
  for (const l of linhas.slice(iCab + 1)) {
    const c = l.split(sep);
    if (c.length <= Math.max(iData, iHist, iValor)) continue;
    const data = dataParaIso(c[iData]); // rodapés e linhas vazias não têm data
    if (!data) continue;
    const historico = c[iHist].trim();
    if (/SALDO/i.test(historico)) continue; // SALDO ANTERIOR e SALDO FINAL não são lançamentos
    const valor = valorParaNumero(c[iValor]);
    if (valor === null) continue;
    lancamentos.push({
      data,
      descricao: historico,
      valor: Math.abs(valor),
      tipo: valor < 0 ? "debito" : "credito",
    });
  }
  return {
    modo: "bruto",
    lancamentos,
    periodo_fim: periodoFimDe(linhas),
    antes,
    depois: lancamentos.slice(0, 6),
  };
}

// Planilha de títulos: cabeçalho com cod_titulo e valor (obrigatórios); demais colunas opcionais.
export function lerTitulos(texto: string): TituloLimpo[] {
  const linhas = texto
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => l.trim() !== "");
  if (linhas.length < 2) throw new Error("Arquivo de títulos sem linhas.");
  const sep = separadorDe(linhas[0]);
  const cab = linhas[0].split(sep).map((c) => c.trim().toLowerCase());
  const col = (n: string) => cab.indexOf(n);
  if (col("cod_titulo") < 0 || col("valor") < 0) {
    throw new Error("Títulos: as colunas cod_titulo e valor são obrigatórias.");
  }

  const titulos: TituloLimpo[] = [];
  for (const l of linhas.slice(1)) {
    const c = l.split(sep).map((x) => x.trim());
    const cod = c[col("cod_titulo")];
    const valor = valorParaNumero(c[col("valor")] ?? "");
    if (!cod || valor === null) continue;
    const campo = (n: string) => {
      const i = col(n);
      return i >= 0 && c[i] ? c[i] : null;
    };
    titulos.push({
      cod_titulo: cod,
      cod_cliente: campo("cod_cliente"),
      nota_fiscal: campo("nota_fiscal"),
      valor,
      vencimento: dataParaIso(campo("vencimento") ?? ""),
      status: campo("status"),
    });
  }
  return titulos;
}
