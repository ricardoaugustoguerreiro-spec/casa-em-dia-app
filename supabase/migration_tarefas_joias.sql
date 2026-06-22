-- Integração com o Sistema de Joias (Alfa 3D): tabela de trabalhos/serviços em aberto,
-- sincronizada automaticamente a partir do backup_auto.json do sistema de joias.
-- Itens SEM prazo definido também entram aqui (só não aparecem marcados no calendário).

create table if not exists public.tarefas_joias (
  id text primary key, -- mesmo id do projeto no Sistema Joias (ex: 'p1782131560345')
  titulo text not null,
  cliente text,
  prazo date, -- pode ser null: nem todo projeto de joia tem prazo definido
  status text not null default 'aberto', -- 'aberto' | 'concluido'
  origem text not null default 'sistema_joias',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists t_tarefas_joias_upd on public.tarefas_joias;
create trigger t_tarefas_joias_upd before update on public.tarefas_joias for each row execute function public.touch_updated_at();

alter table public.tarefas_joias enable row level security;

drop policy if exists "All auth read tarefas_joias" on public.tarefas_joias;
drop policy if exists "Admin insert tarefas_joias" on public.tarefas_joias;
drop policy if exists "Admin update tarefas_joias" on public.tarefas_joias;
drop policy if exists "Admin delete tarefas_joias" on public.tarefas_joias;

-- leitura liberada pros dois (Jéssica também vê os trabalhos em aberto, é informativo);
-- escrita só por sincronização administrada (o script roda com service_role, que ignora RLS,
-- mas mantemos a política restrita a admin como segunda camada de defesa caso alguém tente
-- escrever direto pelo app com a chave anon)
create policy "All auth read tarefas_joias" on public.tarefas_joias for select to authenticated using (true);
create policy "Admin insert tarefas_joias" on public.tarefas_joias for insert to authenticated with check (public.is_admin());
create policy "Admin update tarefas_joias" on public.tarefas_joias for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admin delete tarefas_joias" on public.tarefas_joias for delete to authenticated using (public.is_admin());

select 'Migração tarefas_joias concluída' as resultado;
