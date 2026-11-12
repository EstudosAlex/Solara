-- PARTE 1: tabelas e permissoes (rode primeiro)

create table if not exists execucoes_agentes (
  id             uuid primary key default gen_random_uuid(),
  area           text not null,
  item_tipo      text not null,
  item_id        text not null,
  agente         text not null,
  chamado_por    uuid,
  status         text not null default 'rodando'
                 check (status in ('rodando','ok','erro')),
  entrada        jsonb,
  saida          jsonb,
  erro           text,
  tokens_entrada int,
  tokens_saida   int,
  inicio         timestamptz not null default now(),
  fim            timestamptz
);
create index if not exists execucoes_agentes_item_idx
  on execucoes_agentes (item_id, inicio);

create table if not exists aprovacoes (
  id           uuid primary key default gen_random_uuid(),
  area         text not null,
  item_tipo    text not null,
  item_id      text not null,
  titulo       text not null,
  proposta     jsonb,
  status       text not null default 'pendente'
               check (status in ('pendente','aprovada','editada','rejeitada')),
  decidido_por uuid,
  decidido_em  timestamptz,
  observacao   text
);
create index if not exists aprovacoes_area_status_idx
  on aprovacoes (area, status);

alter table execucoes_agentes enable row level security;
alter table aprovacoes        enable row level security;

drop policy if exists "leitura logados" on execucoes_agentes;
create policy "leitura logados" on execucoes_agentes
  for select to authenticated using (true);

drop policy if exists "leitura logados" on aprovacoes;
create policy "leitura logados" on aprovacoes
  for select to authenticated using (true);

notify pgrst, 'reload schema';

-- PARTE 2: Realtime (rode separado, depois da parte 1)
-- Se der "already member of publication", pode ignorar.

alter publication supabase_realtime add table execucoes_agentes;
alter publication supabase_realtime add table aprovacoes;
