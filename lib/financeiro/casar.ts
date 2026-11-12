// Casamento de lançamentos com títulos. Código determinístico, sem modelo.
import type { LancamentoLimpo, TituloLimpo } from "./limpar";

export type TipoDivergencia =
  | "valor_diferente_mesma_nf"
  | "sem_titulo_correspondente"
  | "possivel_soma"
  | "duplicado"
  | "vencido_sem_pagamento";

export type TituloCandidato = TituloLimpo & { nome_cliente: string | null };

export type DivergenciaCasada = {
  tipo_inicial: TipoDivergencia;
  lancamento_index: number | null;
  cod_titulo: string | null;
  valor_lancamento: number | null;
  valor_titulo: number | null;
  titulos_sugeridos: string[];
  titulos_candidatos: TituloCandidato[];
};

export type ResultadoCasamento = {
  casados: { lancamento_index: number; cod_titulo: string }[];
  divergencias: DivergenciaCasada[];
  ignorados: number[];
};

const centavos = (v: number) => Math.round(v * 100);
const dias = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function nfDaDescricao(descricao: string): string | null {
  const m = descricao.match(/NF-?\s*(\d+)/i);
  return m ? `NF-${m[1]}` : null;
}

// Cliente cujo nome aparece na descrição do lançamento (o nome mais longo ganha).
export function clienteDaDescricao(descricao: string, nomes: Map<string, string>): string | null {
  const d = normalizar(descricao);
  let melhor: string | null = null;
  let tamanho = 0;
  for (const [cod, nome] of nomes) {
    const n = normalizar(nome);
    if (n.length > tamanho && d.includes(n)) {
      melhor = cod;
      tamanho = n.length;
    }
  }
  return melhor;
}

function acharPar(titulos: TituloLimpo[], valor: number): [TituloLimpo, TituloLimpo] | null {
  const alvo = centavos(valor);
  for (let i = 0; i < titulos.length; i++) {
    for (let j = i + 1; j < titulos.length; j++) {
      const a = titulos[i];
      const b = titulos[j];
      if (a.cod_cliente && a.cod_cliente === b.cod_cliente && centavos(a.valor + b.valor) === alvo) {
        return [a, b];
      }
    }
  }
  return null;
}

export function casar(
  lancamentos: LancamentoLimpo[],
  titulos: TituloLimpo[],
  nomesClientes: Map<string, string>,
  periodoFim: string | null
): ResultadoCasamento {
  const abertos = titulos.filter((t) => !t.status || t.status === "aberto");
  const usados = new Set<string>();
  const casados: ResultadoCasamento["casados"] = [];
  const divergencias: DivergenciaCasada[] = [];

  const nova = (
    tipo: TipoDivergencia,
    i: number | null,
    t: TituloLimpo | null,
    sugeridos: string[] = []
  ): DivergenciaCasada => ({
    tipo_inicial: tipo,
    lancamento_index: i,
    cod_titulo: t?.cod_titulo ?? null,
    valor_lancamento: i !== null ? lancamentos[i].valor : null,
    valor_titulo: t?.valor ?? null,
    titulos_sugeridos: sugeridos,
    titulos_candidatos: [],
  });

  const ignorados = lancamentos
    .map((l, i) => (l.tipo === "debito" ? i : -1))
    .filter((i) => i >= 0);

  // Créditos em ordem de data. Débitos ficam de fora.
  const ordem = lancamentos
    .map((_, i) => i)
    .filter((i) => lancamentos[i].tipo === "credito")
    .sort((a, b) => lancamentos[a].data.localeCompare(lancamentos[b].data) || a - b);

  for (const i of ordem) {
    const l = lancamentos[i];

    // 1. NF citada na descrição
    const nf = nfDaDescricao(l.descricao);
    const porNf = nf ? abertos.find((t) => (t.nota_fiscal ?? "").toUpperCase() === nf) : undefined;
    if (porNf) {
      if (centavos(porNf.valor) !== centavos(l.valor)) {
        divergencias.push(nova("valor_diferente_mesma_nf", i, porNf));
      } else if (usados.has(porNf.cod_titulo)) {
        divergencias.push(nova("duplicado", i, porNf));
      } else {
        usados.add(porNf.cod_titulo);
        casados.push({ lancamento_index: i, cod_titulo: porNf.cod_titulo });
      }
      continue;
    }

    // 2. Um único título em aberto, mesmo valor, vencimento a até 5 dias
    const livres = abertos.filter((t) => !usados.has(t.cod_titulo));
    const iguais = livres.filter(
      (t) => centavos(t.valor) === centavos(l.valor) && t.vencimento && dias(t.vencimento, l.data) <= 5
    );
    if (iguais.length === 1) {
      const t = iguais[0];
      usados.add(t.cod_titulo);
      casados.push({ lancamento_index: i, cod_titulo: t.cod_titulo });
      continue;
    }

    // 3. Divergência: duplicado, soma de dois títulos do mesmo cliente, ou sem correspondente
    const jaPago = abertos.find(
      (t) =>
        usados.has(t.cod_titulo) &&
        centavos(t.valor) === centavos(l.valor) &&
        t.vencimento &&
        dias(t.vencimento, l.data) <= 5
    );
    if (jaPago) {
      divergencias.push(nova("duplicado", i, jaPago));
      continue;
    }
    const par = acharPar(livres, l.valor);
    if (par) {
      divergencias.push(nova("possivel_soma", i, null, [par[0].cod_titulo, par[1].cod_titulo]));
      continue;
    }
    divergencias.push(nova("sem_titulo_correspondente", i, null));
  }

  // 4. Títulos em aberto, vencidos e sem lançamento casado e sem outra divergência
  const fim = periodoFim ?? lancamentos.map((l) => l.data).sort().pop() ?? "";
  const referenciados = new Set<string>();
  for (const d of divergencias) {
    if (d.cod_titulo) referenciados.add(d.cod_titulo);
    d.titulos_sugeridos.forEach((c) => referenciados.add(c));
  }
  for (const t of abertos) {
    if (usados.has(t.cod_titulo) || referenciados.has(t.cod_titulo)) continue;
    if (t.vencimento && fim && t.vencimento < fim) {
      divergencias.push(nova("vencido_sem_pagamento", null, t));
    }
  }

  // Candidatos para o Investigador
  const porCod = new Map(titulos.map((t) => [t.cod_titulo, t]));
  const comNome = (t: TituloLimpo): TituloCandidato => ({
    ...t,
    nome_cliente: t.cod_cliente ? nomesClientes.get(t.cod_cliente) ?? null : null,
  });
  for (const d of divergencias) {
    const principal = d.cod_titulo ? porCod.get(d.cod_titulo) : undefined;
    if (d.lancamento_index === null) {
      d.titulos_candidatos = principal ? [comNome(principal)] : [];
      continue;
    }
    const l = lancamentos[d.lancamento_index];
    const cliente = clienteDaDescricao(l.descricao, nomesClientes);
    const relacionados = abertos.filter(
      (t) =>
        !usados.has(t.cod_titulo) &&
        ((cliente !== null && t.cod_cliente === cliente) ||
          Math.abs(t.valor - l.valor) <= 0.1 * l.valor) &&
        t.vencimento !== null &&
        dias(t.vencimento, l.data) <= 30
    );
    const reunidos: TituloLimpo[] = [];
    const incluir = (t: TituloLimpo | undefined) => {
      if (t && !reunidos.some((x) => x.cod_titulo === t.cod_titulo)) reunidos.push(t);
    };
    incluir(principal);
    d.titulos_sugeridos.forEach((c) => incluir(porCod.get(c)));
    relacionados.forEach(incluir);
    d.titulos_candidatos = reunidos.slice(0, 10).map(comNome);
  }

  return { casados, divergencias, ignorados };
}
