import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

// Cliente com a sessão do usuário (anon key), para páginas de servidor.
export async function criarClienteServidor() {
  const armazem = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return armazem.getAll();
        },
        setAll(lista) {
          try {
            lista.forEach(({ name, value, options }) =>
              armazem.set(name, value, options)
            );
          } catch {
            // Chamado de um Server Component: o proxy renova a sessão.
          }
        },
      },
    }
  );
}

// Cliente com service role. Usar somente em rotas de API.
export function criarClienteAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
