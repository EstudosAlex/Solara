import { redirect } from "next/navigation";
import Link from "next/link";
import { obterPerfil } from "@/lib/perfil";
import { criarClienteAdmin } from "@/lib/supabase/servidor";
import FormUsuario from "@/components/FormUsuario";

export default async function PaginaAdmin() {
  const { perfil } = await obterPerfil();
  if (perfil?.papel !== "admin") redirect("/");

  const { data: perfis } = await criarClienteAdmin()
    .from("perfis")
    .select("id, email, nome, papel, areas")
    .order("email");

  return (
    <main className="largo">
      <p>
        <Link href="/">← Voltar</Link>
      </p>
      <h1>Administração</h1>

      <h2>Usuários</h2>
      <table>
        <thead>
          <tr>
            <th>E-mail</th>
            <th>Nome</th>
            <th>Papel</th>
            <th>Áreas</th>
          </tr>
        </thead>
        <tbody>
          {(perfis ?? []).map((p) => (
            <tr key={p.id}>
              <td>{p.email}</td>
              <td>{p.nome}</td>
              <td>{p.papel}</td>
              <td>{(p.areas ?? []).join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Criar usuário</h2>
      <FormUsuario />
    </main>
  );
}
