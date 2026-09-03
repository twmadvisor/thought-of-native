create table if not exists public.user_crypto_keys (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  public_key text not null,
  key_version smallint not null default 1 check (key_version = 1),
  created_at timestamptz not null default now()
);

alter table public.user_crypto_keys enable row level security;

create policy user_crypto_keys_self_insert
on public.user_crypto_keys
for insert
to authenticated
with check (user_id = auth.uid());

create policy user_crypto_keys_connected_read
on public.user_crypto_keys
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.connections c
    where c.status = 'active'
      and (
        (c.user_a = auth.uid() and c.user_b = user_crypto_keys.user_id)
        or
        (c.user_b = auth.uid() and c.user_a = user_crypto_keys.user_id)
      )
  )
);

create table if not exists public.connection_key_envelopes (
  connection_id uuid not null references public.connections(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  envelope text not null,
  key_version smallint not null default 1 check (key_version = 1),
  created_at timestamptz not null default now(),
  primary key (connection_id, user_id)
);

alter table public.connection_key_envelopes enable row level security;

create policy connection_key_envelopes_self_read
on public.connection_key_envelopes
for select
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.connections c
    where c.id = connection_key_envelopes.connection_id
      and (c.user_a = auth.uid() or c.user_b = auth.uid())
  )
);

create or replace function public.initialize_connection_envelopes(
  p_connection_id uuid,
  p_user_a_envelope text,
  p_user_b_envelope text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_a uuid;
  v_user_b uuid;
  v_status text;
begin
  select user_a, user_b, status
    into v_user_a, v_user_b, v_status
  from public.connections
  where id = p_connection_id
  for update;

  if v_user_a is null or v_user_b is null then
    raise exception 'Connection not found';
  end if;

  if auth.uid() is null or auth.uid() not in (v_user_a, v_user_b) then
    raise exception 'Not authorized';
  end if;

  if v_status <> 'active' then
    raise exception 'Connection is not active';
  end if;

  if not exists (select 1 from public.user_crypto_keys where user_id = v_user_a)
     or not exists (select 1 from public.user_crypto_keys where user_id = v_user_b) then
    raise exception 'Encryption keys are not ready';
  end if;

  if exists (
    select 1
    from public.connection_key_envelopes
    where connection_id = p_connection_id
  ) then
    return false;
  end if;

  insert into public.connection_key_envelopes (connection_id, user_id, envelope)
  values
    (p_connection_id, v_user_a, p_user_a_envelope),
    (p_connection_id, v_user_b, p_user_b_envelope);

  return true;
end;
$$;

revoke all on function public.initialize_connection_envelopes(uuid, text, text) from public;
grant execute on function public.initialize_connection_envelopes(uuid, text, text) to authenticated;

alter table public.thoughts
  add column if not exists ciphertext text,
  add column if not exists nonce text,
  add column if not exists encryption_version smallint;

alter table public.thoughts alter column body drop not null;

alter table public.thoughts
  add constraint thoughts_encryption_shape_check
  check (
    (
      body is not null
      and ciphertext is null
      and nonce is null
      and encryption_version is null
    )
    or
    (
      body is null
      and ciphertext is not null
      and nonce is not null
      and encryption_version = 1
    )
  );

-- This first migration is intentionally compatible with the current TestFlight build.
-- Existing plaintext Thoughts remain readable during the transition, while the E2EE build
-- can begin writing encrypted Thoughts. A later migration will disable plaintext inserts
-- and remove legacy plaintext only after upgraded clients have migrated existing history.
