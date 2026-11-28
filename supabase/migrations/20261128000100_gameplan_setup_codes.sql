-- Game Plan: one-time setup codes to set a password without email.
--
-- An operator creates a code for an existing user (only its SHA-256 hash is stored). The
-- gameplan-auth edge function checks email + code, sets the password the user chose, and marks
-- the code used. Codes expire, are single use, and lock after 5 wrong tries.

create table private.gameplan_setup_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  code_hash  text not null,
  expires_at timestamptz not null default now() + interval '2 days',
  used_at    timestamptz,
  attempts   integer not null default 0
);
revoke all on private.gameplan_setup_codes from public, anon, authenticated;

-- Returns the user id when the code is right, and marks it used. Wrong guesses count against
-- every open code for that email.
create function public.gameplan_claim_setup_code(p_email text, p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_id uuid;
begin
  select u.id into v_user from auth.users u where lower(u.email) = lower(trim(p_email));
  if v_user is null then
    return null;
  end if;
  select c.id into v_id from private.gameplan_setup_codes c
  where c.user_id = v_user and c.used_at is null and c.expires_at > now() and c.attempts < 5
    and c.code_hash = encode(extensions.digest(regexp_replace(upper(p_code), '[^A-Z0-9]', '', 'g'), 'sha256'), 'hex')
  limit 1;
  if v_id is null then
    update private.gameplan_setup_codes set attempts = attempts + 1
    where user_id = v_user and used_at is null;
    return null;
  end if;
  update private.gameplan_setup_codes set used_at = now() where id = v_id;
  return v_user;
end;
$$;
revoke all on function public.gameplan_claim_setup_code(text, text) from public, anon, authenticated;
grant execute on function public.gameplan_claim_setup_code(text, text) to service_role;
