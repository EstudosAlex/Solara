import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export default async function PaginaInicial() {
  const supabase = await criarClienteServidor();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  return (
    <main>
      <h1>Solara OS</h1>
      <p>{data.user.email}</p>
    </main>
  );
}
