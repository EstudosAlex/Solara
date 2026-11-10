import { redirect } from "next/navigation";
import { criarClienteServidor, criarClienteAdmin } from "@/lib/supabase/servidor";

export type Perfil = {
  id: string;
  email: string;
  nome: string | null;
  papel: "admin" | "operador";
  areas: string[];
};

async function buscarPerfil(id: string) {
  const { data } = await criarClienteAdmin()
    .from("perfis")
    .select("id, email, nome, papel, areas")
    .eq("id", id)
    .maybeSingle();
  return (data as Perfil | null) ?? null;
}

// Usuário logado + perfil. Redireciona para /login se não houver sessão.
export async function obterPerfil() {
  const supabase = await criarClienteServidor();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  return { user: data.user, perfil: await buscarPerfil(data.user.id) };
}

// Para rotas de API: devolve o perfil ou null.
export async function perfilDaRequisicao(): Promise<Perfil | null> {
  const supabase = await criarClienteServidor();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return buscarPerfil(data.user.id);
}
