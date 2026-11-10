// TEMPORÁRIO: apagar quando Vendas estiver pronta.
import { redirect } from "next/navigation";
import Link from "next/link";
import { obterPerfil } from "@/lib/perfil";
import TesteMotor from "@/components/TesteMotor";

export default async function PaginaTesteMotor() {
  const { perfil } = await obterPerfil();
  if (perfil?.papel !== "admin") redirect("/");

  return (
    <main className="largo">
      <p>
        <Link href="/">← Voltar</Link>
      </p>
      <h1>Teste do motor (temporário)</h1>
      <TesteMotor />
    </main>
  );
}
