


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."check_and_increment_request_rate_internal"("p_requester_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.connection_request_rate_limits%rowtype;
begin
  select * into v_row from public.connection_request_rate_limits where requester_id=p_requester_id for update;
  if not found then
    insert into public.connection_request_rate_limits(requester_id,window_started_at,attempts)
    values (p_requester_id,now(),1);
    return true;
  end if;
  if v_row.window_started_at < now() - interval '1 hour' then
    update public.connection_request_rate_limits set window_started_at=now(),attempts=1 where requester_id=p_requester_id;
    return true;
  end if;
  if v_row.attempts >= 20 then
    return false;
  end if;
  update public.connection_request_rate_limits set attempts=attempts+1 where requester_id=p_requester_id;
  return true;
end;
$$;


ALTER FUNCTION "public"."check_and_increment_request_rate_internal"("p_requester_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."connection_phone_hash"("p_phone_e164" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  select encode(extensions.digest(p_phone_e164, 'sha256'), 'hex')
$$;


ALTER FUNCTION "public"."connection_phone_hash"("p_phone_e164" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."connection_request_internal_bundle"("p_requester_id" "uuid", "p_phone_e164" "text") RETURNS TABLE("request_id" "uuid", "action" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.check_and_increment_request_rate_internal(p_requester_id) then
    return query select null::uuid,'suppressed'::text;
    return;
  end if;
  return query select * from public.process_connection_request_internal(p_requester_id,p_phone_e164);
end;
$$;


ALTER FUNCTION "public"."connection_request_internal_bundle"("p_requester_id" "uuid", "p_phone_e164" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_my_archive"("p_connection_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_connection public.connections%rowtype;
  v_other uuid;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select * into v_connection
  from public.connections c
  where c.id = p_connection_id
    and (c.user_a = v_actor or c.user_b = v_actor)
  limit 1;
  if not found then raise exception 'Archive not available'; end if;

  v_other := case when v_connection.user_a = v_actor then v_connection.user_b else v_connection.user_a end;

  if v_connection.status = 'active' then
    if not exists (
      select 1 from public.blocks b
      where b.blocker_id = v_actor and b.blocked_id = v_other
    ) then raise exception 'Archive not available'; end if;

    update public.connection_members
    set history_deleted_at = now(),
        archived_at = coalesce(archived_at, now()),
        archive_expires_at = null
    where connection_id = p_connection_id and user_id = v_actor;
  else
    update public.connection_members
    set history_deleted_at = now(),
        archived_at = null,
        archive_expires_at = null
    where connection_id = p_connection_id and user_id = v_actor;
  end if;

  return 'deleted';
end;
$$;


ALTER FUNCTION "public"."delete_my_archive"("p_connection_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_old_connection_requests"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_count integer;
begin
  update public.connection_requests
  set status='expired', responded_at=coalesce(responded_at,now())
  where status='pending' and created_at < now()-interval '90 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


ALTER FUNCTION "public"."expire_old_connection_requests"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_archived_people"() RETURNS TABLE("connection_id" "uuid", "person_id" "uuid", "person_name" "text", "archived_at" timestamp with time zone, "archive_expires_at" timestamp with time zone, "history_available" boolean, "blocked_by_me" boolean)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  select
    c.id,
    case when c.user_a = auth.uid() then c.user_b else c.user_a end as person_id,
    p.display_name as person_name,
    cm.archived_at,
    cm.archive_expires_at,
    (
      cm.archive_expires_at is not null
      and cm.archive_expires_at > now()
      and exists (
        select 1 from public.thoughts t
        where t.connection_id = c.id
          and (cm.history_deleted_at is null or t.created_at > cm.history_deleted_at)
          and not exists (
            select 1 from public.thought_shadow_hides h
            where h.thought_id = t.id and h.hidden_from_user_id = auth.uid()
          )
      )
    ) as history_available,
    exists (
      select 1 from public.blocks b
      where b.blocker_id = auth.uid()
        and b.blocked_id = case when c.user_a = auth.uid() then c.user_b else c.user_a end
    ) as blocked_by_me
  from public.connections c
  join public.connection_members cm
    on cm.connection_id = c.id and cm.user_id = auth.uid()
  join public.profiles p
    on p.id = case when c.user_a = auth.uid() then c.user_b else c.user_a end
  where (c.user_a = auth.uid() or c.user_b = auth.uid())
    and (
      (
        c.status = 'ended'
        and cm.archived_at is not null
        and cm.archive_expires_at is not null
        and cm.archive_expires_at > now()
      )
      or
      (
        c.status = 'active'
        and exists (
          select 1 from public.blocks b
          where b.blocker_id = auth.uid()
            and b.blocked_id = case when c.user_a = auth.uid() then c.user_b else c.user_a end
        )
      )
    )
  order by cm.archived_at desc nulls last;
$$;


ALTER FUNCTION "public"."get_archived_people"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_connected_person_contact"("p_target_user_id" "uuid") RETURNS TABLE("phone" "text", "whatsapp_enabled" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  select u.phone, coalesce(p.whatsapp_enabled, false)
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.id = p_target_user_id
    and auth.uid() is not null
    and exists (
      select 1
      from public.connections c
      join public.connection_members cm
        on cm.connection_id = c.id and cm.user_id = auth.uid()
      where c.status = 'active'
        and cm.archived_at is null
        and (
          (c.user_a = auth.uid() and c.user_b = p_target_user_id)
          or
          (c.user_b = auth.uid() and c.user_a = p_target_user_id)
        )
    );
$$;


ALTER FUNCTION "public"."get_connected_person_contact"("p_target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_incoming_connection_requests_internal"("p_actor_id" "uuid") RETURNS TABLE("request_id" "uuid", "requester_id" "uuid", "requester_name" "text", "requester_avatar_path" "text", "created_at" timestamp with time zone)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select r.id, r.requester_id, p.display_name, p.avatar_path, r.created_at
  from public.connection_requests r
  join public.profiles p on p.id = r.requester_id
  where r.target_user_id = p_actor_id
    and r.status = 'pending'
  order by r.created_at desc
$$;


ALTER FUNCTION "public"."get_incoming_connection_requests_internal"("p_actor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_recently_accepted_connections"("p_since" timestamp with time zone DEFAULT ("now"() - '7 days'::interval)) RETURNS TABLE("connection_id" "uuid", "person_id" "uuid", "person_name" "text", "accepted_at" timestamp with time zone)
    LANGUAGE "sql"
    SET "search_path" TO 'public'
    AS $$
  select c.id,
         case when c.user_a=auth.uid() then c.user_b else c.user_a end,
         p.display_name,
         coalesce(r.responded_at,c.created_at)
  from public.connections c
  join public.profiles p on p.id = case when c.user_a=auth.uid() then c.user_b else c.user_a end
  left join lateral (
    select responded_at
    from public.connection_requests r
    where r.status='accepted'
      and ((r.requester_id=auth.uid() and r.target_user_id=p.id) or (r.requester_id=p.id and r.target_user_id=auth.uid()))
    order by responded_at desc nulls last
    limit 1
  ) r on true
  where c.status='active'
    and (c.user_a=auth.uid() or c.user_b=auth.uid())
    and coalesce(r.responded_at,c.created_at)>=p_since
  order by coalesce(r.responded_at,c.created_at) desc
$$;


ALTER FUNCTION "public"."get_recently_accepted_connections"("p_since" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_auth_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'display_name',''), 'New Person'))
  on conflict (id) do nothing;

  insert into public.user_preferences(user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_auth_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."link_pending_requests_to_new_phone"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  normalized_phone text;
begin
  if new.phone is not null and new.phone <> '' then
    normalized_phone := case when left(new.phone,1) = '+' then new.phone else '+' || new.phone end;
    update public.connection_requests
    set target_user_id = new.id
    where target_user_id is null
      and target_phone_hash = public.connection_phone_hash(normalized_phone)
      and status = 'pending';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."link_pending_requests_to_new_phone"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_shadow_hidden_reaction"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_other uuid;
begin
  select case when c.user_a = new.user_id then c.user_b else c.user_a end
    into v_other
  from public.thoughts t
  join public.connections c on c.id = t.connection_id
  where t.id = new.thought_id
    and c.status = 'active'
    and new.user_id in (c.user_a,c.user_b)
  limit 1;

  if v_other is not null and exists (
    select 1 from public.blocks b
    where b.blocker_id = v_other
      and b.blocked_id = new.user_id
  ) then
    insert into public.reaction_shadow_hides(thought_id,user_id,hidden_from_user_id)
    values(new.thought_id,new.user_id,v_other)
    on conflict (thought_id,user_id) do update
      set hidden_from_user_id = excluded.hidden_from_user_id,
          created_at = now();
  elsif tg_op = 'UPDATE' then
    delete from public.reaction_shadow_hides
    where thought_id = new.thought_id and user_id = new.user_id;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."mark_shadow_hidden_reaction"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_shadow_hidden_thought"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_other uuid;
begin
  select case when c.user_a = new.sender_id then c.user_b else c.user_a end
    into v_other
  from public.connections c
  where c.id = new.connection_id
    and c.status = 'active'
    and new.sender_id in (c.user_a, c.user_b)
  limit 1;

  if v_other is not null and exists (
    select 1 from public.blocks b
    where b.blocker_id = v_other
      and b.blocked_id = new.sender_id
  ) then
    insert into public.thought_shadow_hides(thought_id, hidden_from_user_id)
    values(new.id, v_other)
    on conflict (thought_id) do nothing;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."mark_shadow_hidden_thought"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_late_thought_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if old.sender_id <> auth.uid() then
    raise exception 'Only the sender can rethink a Thought';
  end if;
  if now() > old.created_at + interval '10 seconds' then
    raise exception 'Rethink window has expired';
  end if;
  return old;
end;
$$;


ALTER FUNCTION "public"."prevent_late_thought_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_connection_request_internal"("p_requester_id" "uuid", "p_phone_e164" "text") RETURNS TABLE("request_id" "uuid", "action" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions'
    AS $_$
declare
  v_hash text;
  v_target uuid;
  v_existing public.connection_requests%rowtype;
begin
  if p_requester_id is null then
    return query select null::uuid, 'suppressed'::text;
    return;
  end if;

  if p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$' then
    return query select null::uuid, 'suppressed'::text;
    return;
  end if;

  v_hash := public.connection_phone_hash(p_phone_e164);

  select u.id into v_target
  from auth.users u
  where u.phone = p_phone_e164
  limit 1;

  if v_target = p_requester_id then
    return query select null::uuid, 'suppressed'::text;
    return;
  end if;

  if v_target is not null and exists (
    select 1 from public.blocks b
    where b.blocker_id = v_target and b.blocked_id = p_requester_id
  ) then
    return query select null::uuid, 'suppressed'::text;
    return;
  end if;

  if v_target is not null and exists (
    select 1 from public.connections c
    where c.status = 'active'
      and least(c.user_a, c.user_b) = least(p_requester_id, v_target)
      and greatest(c.user_a, c.user_b) = greatest(p_requester_id, v_target)
  ) then
    return query select null::uuid, 'suppressed'::text;
    return;
  end if;

  select * into v_existing
  from public.connection_requests r
  where r.requester_id = p_requester_id
    and r.target_phone_hash = v_hash
    and r.status = 'pending'
  order by r.created_at desc
  limit 1;

  if found then
    update public.connection_requests
      set last_attempt_at = now(),
          target_user_id = coalesce(target_user_id, v_target)
    where id = v_existing.id;

    if v_existing.target_user_id is null and v_target is null then
      return query select v_existing.id, 'external_invite'::text;
    else
      return query select v_existing.id, 'suppressed'::text;
    end if;
    return;
  end if;

  if exists (
    select 1 from public.connection_requests r
    where r.requester_id = p_requester_id
      and r.target_phone_hash = v_hash
      and r.status = 'declined'
      and r.cooldown_until is not null
      and r.cooldown_until > now()
  ) then
    return query select null::uuid, 'suppressed'::text;
    return;
  end if;

  insert into public.connection_requests(
    requester_id, target_phone_hash, target_user_id, status, last_attempt_at
  ) values (
    p_requester_id, v_hash, v_target, 'pending', now()
  ) returning id into request_id;

  if v_target is null then
    action := 'external_invite';
  else
    action := 'in_app';
  end if;

  return next;
end;
$_$;


ALTER FUNCTION "public"."process_connection_request_internal"("p_requester_id" "uuid", "p_phone_e164" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reaction_visible_to_me"("p_thought_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select auth.uid() is not null
     and not exists (
       select 1 from public.reaction_shadow_hides h
       where h.thought_id = p_thought_id
         and h.user_id = p_user_id
         and h.hidden_from_user_id = auth.uid()
     );
$$;


ALTER FUNCTION "public"."reaction_visible_to_me"("p_thought_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_person"("p_connection_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_connection public.connections%rowtype;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select * into v_connection
  from public.connections
  where id = p_connection_id
    and status = 'active'
    and (user_a = v_actor or user_b = v_actor)
  for update;

  if not found then raise exception 'Connection not available'; end if;

  update public.connection_members
  set history_deleted_at = case
        when archive_expires_at is not null and archive_expires_at <= now()
        then greatest(coalesce(history_deleted_at,'-infinity'::timestamptz), archive_expires_at)
        else history_deleted_at
      end
  where connection_id = p_connection_id;

  update public.connections
  set status = 'ended', ended_at = now()
  where id = p_connection_id;

  update public.connection_members
  set archived_at = now(),
      archive_expires_at = now() + interval '1 year'
  where connection_id = p_connection_id;

  update public.connection_requests
  set status = 'expired', responded_at = coalesce(responded_at, now())
  where status = 'pending'
    and (
      (requester_id = v_connection.user_a and target_user_id = v_connection.user_b)
      or (requester_id = v_connection.user_b and target_user_id = v_connection.user_a)
    );

  return 'removed';
end;
$$;


ALTER FUNCTION "public"."remove_person"("p_connection_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_reconnect"("p_connection_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_connection public.connections%rowtype;
  v_other uuid;
  v_phone text;
  v_normalized text;
  v_dummy record;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select * into v_connection
  from public.connections
  where id = p_connection_id
    and status = 'ended'
    and (user_a = v_actor or user_b = v_actor)
  limit 1;

  if not found then return 'sent'; end if;
  v_other := case when v_connection.user_a = v_actor then v_connection.user_b else v_connection.user_a end;

  if exists (select 1 from public.blocks b where b.blocker_id = v_actor and b.blocked_id = v_other) then
    raise exception 'Unblock this person before reconnecting.';
  end if;

  if exists (select 1 from public.blocks b where b.blocker_id = v_other and b.blocked_id = v_actor) then
    return 'sent';
  end if;

  select u.phone into v_phone from auth.users u where u.id = v_other;
  if v_phone is null or v_phone = '' then return 'sent'; end if;
  v_normalized := case when left(v_phone,1) = '+' then v_phone else '+' || v_phone end;

  select * into v_dummy from public.connection_request_internal_bundle(v_actor, v_normalized) limit 1;
  return 'sent';
end;
$$;


ALTER FUNCTION "public"."request_reconnect"("p_connection_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."respond_connection_request_internal"("p_actor_id" "uuid", "p_request_id" "uuid", "p_action" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_request public.connection_requests%rowtype;
  v_a uuid;
  v_b uuid;
  v_connection_id uuid;
begin
  if p_actor_id is null then raise exception 'Authentication required'; end if;

  select * into v_request
  from public.connection_requests
  where id=p_request_id and target_user_id=p_actor_id and status='pending'
  for update;
  if not found then raise exception 'Request not available'; end if;

  if p_action='not_now' then
    update public.connection_requests
    set status='declined',responded_at=now(),cooldown_until=now()+interval '30 days'
    where id=p_request_id;
    return 'declined';
  end if;

  if p_action='block' then
    insert into public.blocks(blocker_id,blocked_id)
    values(p_actor_id,v_request.requester_id)
    on conflict do nothing;
    update public.connection_requests
    set status='declined',responded_at=now(),cooldown_until=null
    where id=p_request_id;
    return 'blocked';
  end if;

  if p_action<>'accept' then raise exception 'Invalid action'; end if;

  if exists(
    select 1 from public.blocks b
    where (b.blocker_id=p_actor_id and b.blocked_id=v_request.requester_id)
       or (b.blocker_id=v_request.requester_id and b.blocked_id=p_actor_id)
  ) then raise exception 'Request not available'; end if;

  v_a:=least(v_request.requester_id,p_actor_id);
  v_b:=greatest(v_request.requester_id,p_actor_id);

  select id into v_connection_id
  from public.connections
  where least(user_a,user_b)=v_a and greatest(user_a,user_b)=v_b
  limit 1 for update;

  if v_connection_id is null then
    insert into public.connections(user_a,user_b,status)
    values(v_a,v_b,'active') returning id into v_connection_id;
    insert into public.connection_members(connection_id,user_id)
    values(v_connection_id,v_a),(v_connection_id,v_b);
  else
    update public.connections set status='active',ended_at=null where id=v_connection_id;
    insert into public.connection_members(connection_id,user_id)
    values(v_connection_id,v_a),(v_connection_id,v_b)
    on conflict(connection_id,user_id) do nothing;
    update public.connection_members
    set history_deleted_at=case
      when archive_expires_at is not null and archive_expires_at<=now()
      then greatest(coalesce(history_deleted_at,'-infinity'::timestamptz),archive_expires_at)
      else history_deleted_at end,
      archived_at=null,archive_expires_at=null
    where connection_id=v_connection_id and user_id in(v_a,v_b);
  end if;

  update public.connection_requests
  set status='accepted',responded_at=now(),cooldown_until=null
  where id=p_request_id;

  update public.connection_requests
  set status='expired',responded_at=now()
  where id<>p_request_id and status='pending'
    and ((requester_id=v_request.requester_id and target_user_id=p_actor_id)
      or (requester_id=p_actor_id and target_user_id=v_request.requester_id));

  return v_connection_id::text;
end;
$$;


ALTER FUNCTION "public"."respond_connection_request_internal"("p_actor_id" "uuid", "p_request_id" "uuid", "p_action" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_my_display_name"("p_display_name" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_display_name is null or char_length(trim(p_display_name)) < 1 or char_length(trim(p_display_name)) > 40 then
    raise exception 'Invalid display name';
  end if;
  update public.profiles set display_name=trim(p_display_name) where id=auth.uid();
end;
$$;


ALTER FUNCTION "public"."set_my_display_name"("p_display_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_person_block"("p_connection_id" "uuid", "p_blocked" boolean) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_connection public.connections%rowtype;
  v_other uuid;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select * into v_connection
  from public.connections
  where id = p_connection_id
    and (user_a = v_actor or user_b = v_actor)
  for update;

  if not found then raise exception 'Connection not available'; end if;
  v_other := case when v_connection.user_a = v_actor then v_connection.user_b else v_connection.user_a end;

  if p_blocked then
    insert into public.blocks(blocker_id, blocked_id)
    values(v_actor, v_other)
    on conflict do nothing;

    if v_connection.status = 'active' then
      update public.connection_members
      set archived_at = now(),
          archive_expires_at = now() + interval '1 year'
      where connection_id = p_connection_id and user_id = v_actor;
    end if;

    update public.connection_requests
    set status = 'expired', responded_at = coalesce(responded_at, now())
    where status = 'pending'
      and (
        (requester_id = v_connection.user_a and target_user_id = v_connection.user_b)
        or (requester_id = v_connection.user_b and target_user_id = v_connection.user_a)
      );

    return 'blocked';
  else
    delete from public.blocks
    where blocker_id = v_actor and blocked_id = v_other;

    if v_connection.status = 'active' then
      update public.connection_members
      set history_deleted_at = case
            when archive_expires_at is not null and archive_expires_at <= now()
            then greatest(coalesce(history_deleted_at,'-infinity'::timestamptz), archive_expires_at)
            else history_deleted_at
          end,
          archived_at = null,
          archive_expires_at = null
      where connection_id = p_connection_id and user_id = v_actor;
    end if;

    return 'unblocked';
  end if;
end;
$$;


ALTER FUNCTION "public"."set_person_block"("p_connection_id" "uuid", "p_blocked" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."thought_visible_to_me"("p_thought_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select auth.uid() is not null
     and not exists (
       select 1 from public.thought_shadow_hides h
       where h.thought_id = p_thought_id
         and h.hidden_from_user_id = auth.uid()
     );
$$;


ALTER FUNCTION "public"."thought_visible_to_me"("p_thought_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."app_private_config" (
    "name" "text" NOT NULL,
    "value" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."app_private_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."blocks" (
    "blocker_id" "uuid" NOT NULL,
    "blocked_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "blocks_check" CHECK (("blocker_id" <> "blocked_id"))
);


ALTER TABLE "public"."blocks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."connection_members" (
    "connection_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "private_name" "text",
    "archived_at" timestamp with time zone,
    "archive_expires_at" timestamp with time zone,
    "history_deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_opened_at" timestamp with time zone,
    CONSTRAINT "connection_members_private_name_check" CHECK ((("private_name" IS NULL) OR (("char_length"("private_name") >= 1) AND ("char_length"("private_name") <= 40))))
);


ALTER TABLE "public"."connection_members" OWNER TO "postgres";


COMMENT ON COLUMN "public"."connection_members"."last_opened_at" IS 'Most recent time this user opened the connection Thought history. Used only for private unread-dot state.';



CREATE TABLE IF NOT EXISTS "public"."connection_request_rate_limits" (
    "requester_id" "uuid" NOT NULL,
    "window_started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."connection_request_rate_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."connection_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "requester_id" "uuid" NOT NULL,
    "target_phone_hash" "text" NOT NULL,
    "target_user_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "responded_at" timestamp with time zone,
    "cooldown_until" timestamp with time zone,
    "last_attempt_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "accepted_notice_sent_at" timestamp with time zone,
    CONSTRAINT "connection_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'declined'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."connection_requests" OWNER TO "postgres";


COMMENT ON TABLE "public"."connection_requests" IS 'Private server-managed requests. Senders never receive status rows; user-facing request endpoint always returns Request sent.';



CREATE TABLE IF NOT EXISTS "public"."connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_a" "uuid" NOT NULL,
    "user_b" "uuid" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ended_at" timestamp with time zone,
    CONSTRAINT "connections_check" CHECK (("user_a" <> "user_b")),
    CONSTRAINT "connections_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'ended'::"text"])))
);


ALTER TABLE "public"."connections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."group_memberships" (
    "group_id" "uuid" NOT NULL,
    "connection_id" "uuid" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."group_memberships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "groups_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 30)))
);


ALTER TABLE "public"."groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "display_name" "text" NOT NULL,
    "avatar_path" "text",
    "whatsapp_enabled" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profiles_display_name_check" CHECK ((("char_length"("display_name") >= 1) AND ("char_length"("display_name") <= 40)))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_registrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "token" "text",
    "endpoint" "text",
    "p256dh" "text",
    "auth" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "push_registrations_check" CHECK (((("provider" = 'expo'::"text") AND ("token" IS NOT NULL) AND ("endpoint" IS NULL) AND ("p256dh" IS NULL) AND ("auth" IS NULL)) OR (("provider" = 'web'::"text") AND ("token" IS NULL) AND ("endpoint" IS NOT NULL) AND ("p256dh" IS NOT NULL) AND ("auth" IS NOT NULL)))),
    CONSTRAINT "push_registrations_provider_check" CHECK (("provider" = ANY (ARRAY['web'::"text", 'expo'::"text"])))
);


ALTER TABLE "public"."push_registrations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reaction_shadow_hides" (
    "thought_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "hidden_from_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."reaction_shadow_hides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reactions" (
    "thought_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "emoji" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reactions_emoji_check" CHECK ((("char_length"("emoji") >= 1) AND ("char_length"("emoji") <= 16)))
);


ALTER TABLE "public"."reactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."thought_shadow_hides" (
    "thought_id" "uuid" NOT NULL,
    "hidden_from_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."thought_shadow_hides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."thoughts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "connection_id" "uuid" NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "thoughts_body_check" CHECK ((("body" IS NULL) OR ("char_length"("body") <= 60))),
    CONSTRAINT "thoughts_body_nonempty_check" CHECK ((("char_length"(TRIM(BOTH FROM "body")) >= 1) AND ("char_length"(TRIM(BOTH FROM "body")) <= 60)))
);


ALTER TABLE "public"."thoughts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_preferences" (
    "user_id" "uuid" NOT NULL,
    "default_group_name" "text" DEFAULT 'Your People'::"text" NOT NULL,
    "notification_color" "text" DEFAULT '#111111'::"text" NOT NULL,
    "outgoing_thought_color" "text" DEFAULT '#111111'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_preferences_default_group_name_check" CHECK ((("char_length"("default_group_name") >= 1) AND ("char_length"("default_group_name") <= 30)))
);


ALTER TABLE "public"."user_preferences" OWNER TO "postgres";


ALTER TABLE ONLY "public"."app_private_config"
    ADD CONSTRAINT "app_private_config_pkey" PRIMARY KEY ("name");



ALTER TABLE ONLY "public"."blocks"
    ADD CONSTRAINT "blocks_pkey" PRIMARY KEY ("blocker_id", "blocked_id");



ALTER TABLE ONLY "public"."connection_members"
    ADD CONSTRAINT "connection_members_pkey" PRIMARY KEY ("connection_id", "user_id");



ALTER TABLE ONLY "public"."connection_request_rate_limits"
    ADD CONSTRAINT "connection_request_rate_limits_pkey" PRIMARY KEY ("requester_id");



ALTER TABLE ONLY "public"."connection_requests"
    ADD CONSTRAINT "connection_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."connections"
    ADD CONSTRAINT "connections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."connections"
    ADD CONSTRAINT "connections_user_a_user_b_key" UNIQUE ("user_a", "user_b");



ALTER TABLE ONLY "public"."group_memberships"
    ADD CONSTRAINT "group_memberships_pkey" PRIMARY KEY ("group_id", "connection_id");



ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_registrations"
    ADD CONSTRAINT "push_registrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reaction_shadow_hides"
    ADD CONSTRAINT "reaction_shadow_hides_pkey" PRIMARY KEY ("thought_id", "user_id");



ALTER TABLE ONLY "public"."reactions"
    ADD CONSTRAINT "reactions_pkey" PRIMARY KEY ("thought_id", "user_id");



ALTER TABLE ONLY "public"."thought_shadow_hides"
    ADD CONSTRAINT "thought_shadow_hides_pkey" PRIMARY KEY ("thought_id");



ALTER TABLE ONLY "public"."thoughts"
    ADD CONSTRAINT "thoughts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id");



CREATE INDEX "connection_members_user_idx" ON "public"."connection_members" USING "btree" ("user_id");



CREATE INDEX "connection_requests_decline_cooldown_idx" ON "public"."connection_requests" USING "btree" ("requester_id", "target_phone_hash", "cooldown_until") WHERE ("status" = 'declined'::"text");



CREATE UNIQUE INDEX "connection_requests_one_pending_per_target" ON "public"."connection_requests" USING "btree" ("requester_id", "target_phone_hash") WHERE ("status" = 'pending'::"text");



CREATE INDEX "connection_requests_requester_idx" ON "public"."connection_requests" USING "btree" ("requester_id", "created_at" DESC);



CREATE INDEX "connection_requests_target_pending_idx" ON "public"."connection_requests" USING "btree" ("target_user_id", "created_at" DESC) WHERE ("status" = 'pending'::"text");



CREATE INDEX "connection_requests_target_user_idx" ON "public"."connection_requests" USING "btree" ("target_user_id", "status");



CREATE UNIQUE INDEX "connections_symmetric_pair_unique" ON "public"."connections" USING "btree" (LEAST("user_a", "user_b"), GREATEST("user_a", "user_b"));



CREATE INDEX "group_memberships_owner_idx" ON "public"."group_memberships" USING "btree" ("owner_id");



CREATE UNIQUE INDEX "push_registrations_expo_token_key" ON "public"."push_registrations" USING "btree" ("token") WHERE ("provider" = 'expo'::"text");



CREATE UNIQUE INDEX "push_registrations_web_endpoint_key" ON "public"."push_registrations" USING "btree" ("endpoint") WHERE ("provider" = 'web'::"text");



CREATE INDEX "thoughts_connection_created_idx" ON "public"."thoughts" USING "btree" ("connection_id", "created_at");



CREATE OR REPLACE TRIGGER "preferences_updated_at" BEFORE UPDATE ON "public"."user_preferences" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "reactions_shadow_hide" AFTER INSERT OR UPDATE ON "public"."reactions" FOR EACH ROW EXECUTE FUNCTION "public"."mark_shadow_hidden_reaction"();



CREATE OR REPLACE TRIGGER "thoughts_rethink_guard" BEFORE DELETE ON "public"."thoughts" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_late_thought_delete"();



CREATE OR REPLACE TRIGGER "thoughts_shadow_hide" AFTER INSERT ON "public"."thoughts" FOR EACH ROW EXECUTE FUNCTION "public"."mark_shadow_hidden_thought"();



ALTER TABLE ONLY "public"."blocks"
    ADD CONSTRAINT "blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."blocks"
    ADD CONSTRAINT "blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."connection_members"
    ADD CONSTRAINT "connection_members_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."connection_members"
    ADD CONSTRAINT "connection_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."connection_request_rate_limits"
    ADD CONSTRAINT "connection_request_rate_limits_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."connection_requests"
    ADD CONSTRAINT "connection_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."connection_requests"
    ADD CONSTRAINT "connection_requests_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."connections"
    ADD CONSTRAINT "connections_user_a_fkey" FOREIGN KEY ("user_a") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."connections"
    ADD CONSTRAINT "connections_user_b_fkey" FOREIGN KEY ("user_b") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_memberships"
    ADD CONSTRAINT "group_memberships_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_memberships"
    ADD CONSTRAINT "group_memberships_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_memberships"
    ADD CONSTRAINT "group_memberships_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_registrations"
    ADD CONSTRAINT "push_registrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reaction_shadow_hides"
    ADD CONSTRAINT "reaction_shadow_hides_hidden_from_user_id_fkey" FOREIGN KEY ("hidden_from_user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reaction_shadow_hides"
    ADD CONSTRAINT "reaction_shadow_hides_thought_id_user_id_fkey" FOREIGN KEY ("thought_id", "user_id") REFERENCES "public"."reactions"("thought_id", "user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reactions"
    ADD CONSTRAINT "reactions_thought_id_fkey" FOREIGN KEY ("thought_id") REFERENCES "public"."thoughts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reactions"
    ADD CONSTRAINT "reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."thought_shadow_hides"
    ADD CONSTRAINT "thought_shadow_hides_hidden_from_user_id_fkey" FOREIGN KEY ("hidden_from_user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."thought_shadow_hides"
    ADD CONSTRAINT "thought_shadow_hides_thought_id_fkey" FOREIGN KEY ("thought_id") REFERENCES "public"."thoughts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."thoughts"
    ADD CONSTRAINT "thoughts_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."thoughts"
    ADD CONSTRAINT "thoughts_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE "public"."app_private_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."blocks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "blocks_self_delete" ON "public"."blocks" FOR DELETE USING (("blocker_id" = "auth"."uid"()));



CREATE POLICY "blocks_self_insert" ON "public"."blocks" FOR INSERT WITH CHECK (("blocker_id" = "auth"."uid"()));



CREATE POLICY "blocks_self_read" ON "public"."blocks" FOR SELECT USING (("blocker_id" = "auth"."uid"()));



ALTER TABLE "public"."connection_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "connection_members_self_read" ON "public"."connection_members" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "connection_members_self_update" ON "public"."connection_members" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."connection_request_rate_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."connection_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."connections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "connections_member_read" ON "public"."connections" FOR SELECT USING (((("user_a" = "auth"."uid"()) OR ("user_b" = "auth"."uid"())) AND (("status" = 'ended'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."connection_members" "cm"
  WHERE (("cm"."connection_id" = "connections"."id") AND ("cm"."user_id" = "auth"."uid"()) AND ("cm"."archived_at" IS NULL)))))));



ALTER TABLE "public"."group_memberships" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "group_memberships_owner_all" ON "public"."group_memberships" TO "authenticated" USING (("owner_id" = "auth"."uid"())) WITH CHECK ((("owner_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."groups" "g"
  WHERE (("g"."id" = "group_memberships"."group_id") AND ("g"."owner_id" = "auth"."uid"())))) AND (EXISTS ( SELECT 1
   FROM "public"."connections" "c"
  WHERE (("c"."id" = "group_memberships"."connection_id") AND (("c"."user_a" = "auth"."uid"()) OR ("c"."user_b" = "auth"."uid"())))))));



ALTER TABLE "public"."groups" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "groups_owner_all" ON "public"."groups" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "preferences_self_all" ON "public"."user_preferences" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_connected_read" ON "public"."profiles" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."connections" "c"
  WHERE (("c"."status" = 'active'::"text") AND ((("c"."user_a" = "auth"."uid"()) AND ("c"."user_b" = "profiles"."id")) OR (("c"."user_b" = "auth"."uid"()) AND ("c"."user_a" = "profiles"."id")))))));



CREATE POLICY "profiles_pending_request_recipient_read" ON "public"."profiles" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."connection_requests" "r"
  WHERE (("r"."requester_id" = "profiles"."id") AND ("r"."target_user_id" = "auth"."uid"()) AND ("r"."status" = 'pending'::"text")))));



CREATE POLICY "profiles_self_insert" ON "public"."profiles" FOR INSERT WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "profiles_self_read" ON "public"."profiles" FOR SELECT USING (("id" = "auth"."uid"()));



CREATE POLICY "profiles_self_update" ON "public"."profiles" FOR UPDATE USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



ALTER TABLE "public"."push_registrations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "push_registrations_self_delete" ON "public"."push_registrations" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "push_registrations_self_insert" ON "public"."push_registrations" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "push_registrations_self_read" ON "public"."push_registrations" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "push_registrations_self_update" ON "public"."push_registrations" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "rate_limits_explicit_deny" ON "public"."connection_request_rate_limits" TO "authenticated" USING (false) WITH CHECK (false);



ALTER TABLE "public"."reaction_shadow_hides" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reactions_member_read" ON "public"."reactions" FOR SELECT USING (("public"."thought_visible_to_me"("thought_id") AND "public"."reaction_visible_to_me"("thought_id", "user_id") AND (EXISTS ( SELECT 1
   FROM ("public"."thoughts" "t"
     JOIN "public"."connection_members" "cm" ON (("cm"."connection_id" = "t"."connection_id")))
  WHERE (("t"."id" = "reactions"."thought_id") AND ("cm"."user_id" = "auth"."uid"()) AND (("cm"."history_deleted_at" IS NULL) OR ("t"."created_at" > "cm"."history_deleted_at")) AND (("cm"."archived_at" IS NULL) OR (("cm"."archive_expires_at" IS NOT NULL) AND ("cm"."archive_expires_at" > "now"()))))))));



CREATE POLICY "reactions_self_delete" ON "public"."reactions" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "reactions_self_insert" ON "public"."reactions" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."thought_visible_to_me"("thought_id") AND (EXISTS ( SELECT 1
   FROM ("public"."thoughts" "t"
     JOIN "public"."connections" "c" ON (("c"."id" = "t"."connection_id")))
  WHERE (("t"."id" = "reactions"."thought_id") AND ("c"."status" = 'active'::"text") AND (("c"."user_a" = "auth"."uid"()) OR ("c"."user_b" = "auth"."uid"())))))));



CREATE POLICY "reactions_self_update" ON "public"."reactions" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "requests_target_read" ON "public"."connection_requests" FOR SELECT TO "authenticated" USING ((("target_user_id" = "auth"."uid"()) AND ("status" = 'pending'::"text")));



ALTER TABLE "public"."thought_shadow_hides" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."thoughts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "thoughts_member_read" ON "public"."thoughts" FOR SELECT USING (("public"."thought_visible_to_me"("id") AND (EXISTS ( SELECT 1
   FROM "public"."connection_members" "cm"
  WHERE (("cm"."connection_id" = "thoughts"."connection_id") AND ("cm"."user_id" = "auth"."uid"()) AND (("cm"."history_deleted_at" IS NULL) OR ("thoughts"."created_at" > "cm"."history_deleted_at")) AND (("cm"."archived_at" IS NULL) OR (("cm"."archive_expires_at" IS NOT NULL) AND ("cm"."archive_expires_at" > "now"()))))))));



CREATE POLICY "thoughts_sender_delete" ON "public"."thoughts" FOR DELETE USING (("sender_id" = "auth"."uid"()));



CREATE POLICY "thoughts_sender_insert" ON "public"."thoughts" FOR INSERT WITH CHECK ((("sender_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."connections" "c"
  WHERE (("c"."id" = "thoughts"."connection_id") AND ("c"."status" = 'active'::"text") AND (("c"."user_a" = "auth"."uid"()) OR ("c"."user_b" = "auth"."uid"())))))));



ALTER TABLE "public"."user_preferences" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."reactions";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."thoughts";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "public"."check_and_increment_request_rate_internal"("p_requester_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_and_increment_request_rate_internal"("p_requester_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."connection_phone_hash"("p_phone_e164" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."connection_phone_hash"("p_phone_e164" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."connection_request_internal_bundle"("p_requester_id" "uuid", "p_phone_e164" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."connection_request_internal_bundle"("p_requester_id" "uuid", "p_phone_e164" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_my_archive"("p_connection_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_my_archive"("p_connection_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_my_archive"("p_connection_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."expire_old_connection_requests"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."expire_old_connection_requests"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_archived_people"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_archived_people"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_archived_people"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_connected_person_contact"("p_target_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_connected_person_contact"("p_target_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_connected_person_contact"("p_target_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_incoming_connection_requests_internal"("p_actor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_incoming_connection_requests_internal"("p_actor_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_recently_accepted_connections"("p_since" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_recently_accepted_connections"("p_since" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_recently_accepted_connections"("p_since" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_auth_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_auth_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."link_pending_requests_to_new_phone"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."link_pending_requests_to_new_phone"() TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_shadow_hidden_reaction"() TO "anon";
GRANT ALL ON FUNCTION "public"."mark_shadow_hidden_reaction"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_shadow_hidden_reaction"() TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_shadow_hidden_thought"() TO "anon";
GRANT ALL ON FUNCTION "public"."mark_shadow_hidden_thought"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_shadow_hidden_thought"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_late_thought_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_late_thought_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_late_thought_delete"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."process_connection_request_internal"("p_requester_id" "uuid", "p_phone_e164" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."process_connection_request_internal"("p_requester_id" "uuid", "p_phone_e164" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reaction_visible_to_me"("p_thought_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reaction_visible_to_me"("p_thought_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."reaction_visible_to_me"("p_thought_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reaction_visible_to_me"("p_thought_id" "uuid", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."remove_person"("p_connection_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remove_person"("p_connection_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."remove_person"("p_connection_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."request_reconnect"("p_connection_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_reconnect"("p_connection_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."request_reconnect"("p_connection_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."respond_connection_request_internal"("p_actor_id" "uuid", "p_request_id" "uuid", "p_action" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."respond_connection_request_internal"("p_actor_id" "uuid", "p_request_id" "uuid", "p_action" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_my_display_name"("p_display_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_my_display_name"("p_display_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_my_display_name"("p_display_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_person_block"("p_connection_id" "uuid", "p_blocked" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_person_block"("p_connection_id" "uuid", "p_blocked" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_person_block"("p_connection_id" "uuid", "p_blocked" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."thought_visible_to_me"("p_thought_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."thought_visible_to_me"("p_thought_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."thought_visible_to_me"("p_thought_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."thought_visible_to_me"("p_thought_id" "uuid") TO "service_role";


















GRANT ALL ON TABLE "public"."app_private_config" TO "service_role";



GRANT ALL ON TABLE "public"."blocks" TO "anon";
GRANT ALL ON TABLE "public"."blocks" TO "authenticated";
GRANT ALL ON TABLE "public"."blocks" TO "service_role";



GRANT ALL ON TABLE "public"."connection_members" TO "anon";
GRANT ALL ON TABLE "public"."connection_members" TO "authenticated";
GRANT ALL ON TABLE "public"."connection_members" TO "service_role";



GRANT ALL ON TABLE "public"."connection_request_rate_limits" TO "service_role";



GRANT ALL ON TABLE "public"."connection_requests" TO "service_role";
GRANT SELECT ON TABLE "public"."connection_requests" TO "authenticated";



GRANT ALL ON TABLE "public"."connections" TO "anon";
GRANT ALL ON TABLE "public"."connections" TO "authenticated";
GRANT ALL ON TABLE "public"."connections" TO "service_role";



GRANT ALL ON TABLE "public"."group_memberships" TO "anon";
GRANT ALL ON TABLE "public"."group_memberships" TO "authenticated";
GRANT ALL ON TABLE "public"."group_memberships" TO "service_role";



GRANT ALL ON TABLE "public"."groups" TO "anon";
GRANT ALL ON TABLE "public"."groups" TO "authenticated";
GRANT ALL ON TABLE "public"."groups" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."push_registrations" TO "anon";
GRANT ALL ON TABLE "public"."push_registrations" TO "authenticated";
GRANT ALL ON TABLE "public"."push_registrations" TO "service_role";



GRANT ALL ON TABLE "public"."reaction_shadow_hides" TO "service_role";



GRANT ALL ON TABLE "public"."reactions" TO "anon";
GRANT ALL ON TABLE "public"."reactions" TO "authenticated";
GRANT ALL ON TABLE "public"."reactions" TO "service_role";



GRANT ALL ON TABLE "public"."thought_shadow_hides" TO "service_role";



GRANT ALL ON TABLE "public"."thoughts" TO "anon";
GRANT ALL ON TABLE "public"."thoughts" TO "authenticated";
GRANT ALL ON TABLE "public"."thoughts" TO "service_role";



GRANT ALL ON TABLE "public"."user_preferences" TO "anon";
GRANT ALL ON TABLE "public"."user_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."user_preferences" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































