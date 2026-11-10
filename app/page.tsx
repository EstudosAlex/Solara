import Link from "next/link";
import { obterPerfil } from "@/lib/perfil";

const AREAS = [
  { chave: "vendas", nome: "Vendas", ativa: true },
  { chave: "financeiro", nome: "Financeiro", ativa: true },
  { chave: "rh", nome: "RH", ativa: false },
  { chave: "juridico", nome: "Jurídico", ativa: false },
  { chave: "operacoes", nome: "Operações", ativa: false },
];

export default async function PaginaInicial() {
  const { user, perfil } = await obterPerfil();
  const areasDoUsuario = perfil?.areas ?? [];

  const cartoes = AREAS.filter((a) => !a.ativa || areasDoUsuario.includes(a.chave));

  return (
    <main className="largo">
      <h1>Solara OS</h1>
      <p>
        {user.email}
        {perfil?.papel === "admin" && (
          <>
            {" · "}
            <Link href="/admin">Administração</Link>
          </>
        )}
      </p>
      {!perfil && <p className="erro">Seu usuário ainda não tem perfil. Peça ao administrador.</p>}
      <div className="cartoes">
        {cartoes.map((a) =>
          a.ativa ? (
            <Link key={a.chave} href={`/${a.chave}`} className="cartao">
              {a.nome}
            </Link>
          ) : (
            <div key={a.chave} className="cartao desativado">
              {a.nome}
              <small>em breve</small>
            </div>
          )
        )}
      </div>
    </main>
  );
}
