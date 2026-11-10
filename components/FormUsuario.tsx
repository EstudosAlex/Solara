"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const AREAS = ["vendas", "financeiro"];

export default function FormUsuario() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [nome, setNome] = useState("");
  const [papel, setPapel] = useState("operador");
  const [areas, setAreas] = useState<string[]>([]);
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  function alternarArea(area: string) {
    setAreas((atual) =>
      atual.includes(area) ? atual.filter((a) => a !== area) : [...atual, area]
    );
  }

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setMensagem("");
    setEnviando(true);
    const resp = await fetch("/api/admin/usuarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, senha, nome, papel, areas }),
    });
    const corpo = await resp.json().catch(() => ({}));
    setEnviando(false);
    if (!resp.ok) {
      setErro(corpo.erro ?? "Não foi possível criar o usuário.");
      return;
    }
    setMensagem(`Usuário ${email} criado.`);
    setEmail("");
    setSenha("");
    setNome("");
    setPapel("operador");
    setAreas([]);
    router.refresh();
  }

  return (
    <form onSubmit={criar}>
      <label>
        E-mail
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Senha inicial
        <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} minLength={6} required />
      </label>
      <label>
        Nome
        <input value={nome} onChange={(e) => setNome(e.target.value)} required />
      </label>
      <label>
        Papel
        <select value={papel} onChange={(e) => setPapel(e.target.value)}>
          <option value="operador">operador</option>
          <option value="admin">admin</option>
        </select>
      </label>
      <fieldset>
        <legend>Áreas</legend>
        {AREAS.map((a) => (
          <label key={a} className="linha">
            <input type="checkbox" checked={areas.includes(a)} onChange={() => alternarArea(a)} />
            {a}
          </label>
        ))}
      </fieldset>
      {erro && <p className="erro">{erro}</p>}
      {mensagem && <p className="ok">{mensagem}</p>}
      <button type="submit" disabled={enviando}>
        {enviando ? "Criando..." : "Criar usuário"}
      </button>
    </form>
  );
}
