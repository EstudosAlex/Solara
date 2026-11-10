import { NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase/servidor";
import { perfilDaRequisicao } from "@/lib/perfil";

const AREAS_VALIDAS = ["vendas", "financeiro"];
const PAPEIS_VALIDOS = ["admin", "operador"];

export async function POST(req: Request) {
  const quem = await perfilDaRequisicao();
  if (quem?.papel !== "admin") {
    return NextResponse.json({ erro: "Acesso negado." }, { status: 403 });
  }

  const { email, senha, nome, papel, areas } = await req.json();
  if (!email || !senha || !nome) {
    return NextResponse.json({ erro: "Preencha e-mail, senha e nome." }, { status: 400 });
  }
  if (!PAPEIS_VALIDOS.includes(papel)) {
    return NextResponse.json({ erro: "Papel inválido." }, { status: 400 });
  }
  const listaAreas: string[] = Array.isArray(areas) ? areas : [];
  if (!listaAreas.every((a) => AREAS_VALIDAS.includes(a))) {
    return NextResponse.json({ erro: "Área inválida." }, { status: 400 });
  }

  const admin = criarClienteAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
  });
  if (error || !data.user) {
    return NextResponse.json({ erro: error?.message ?? "Falha ao criar no Auth." }, { status: 400 });
  }

  const { error: erroPerfil } = await admin
    .from("perfis")
    .insert({ id: data.user.id, email, nome, papel, areas: listaAreas });
  if (erroPerfil) {
    await admin.auth.admin.deleteUser(data.user.id);
    return NextResponse.json({ erro: erroPerfil.message }, { status: 400 });
  }

  return NextResponse.json({ id: data.user.id });
}
