import Link from "next/link";
import { redirect } from "next/navigation";
import { obterPerfil } from "@/lib/perfil";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import TelaVendas, { type PedidoVendas } from "@/components/TelaVendas";

export default async function PaginaVendas() {
  const { perfil } = await obterPerfil();
  if (!perfil?.areas.includes("vendas")) redirect("/");

  const supabase = await criarClienteServidor();
  const [{ data: pedidos }, { data: clientes }] = await Promise.all([
    supabase
      .from("pedidos_orcamento")
      .select("cod_pedido, data, cod_cliente, canal, mensagem, status")
      .order("cod_pedido"),
    supabase.from("Clientes").select("cod_cliente, nome"),
  ]);

  const nomes = new Map((clientes ?? []).map((c) => [c.cod_cliente, c.nome]));
  const lista: PedidoVendas[] = (pedidos ?? []).map((p) => ({
    cod_pedido: p.cod_pedido,
    data: p.data,
    canal: p.canal,
    mensagem: p.mensagem,
    status: p.status ?? "novo",
    cliente_nome: p.cod_cliente ? nomes.get(p.cod_cliente) ?? null : null,
  }));

  return (
    <main className="amplo">
      <p>
        <Link href="/">← Voltar</Link>
      </p>
      <h1>Vendas</h1>
      <TelaVendas pedidos={lista} />
    </main>
  );
}
