-- Crews: empty for now (crew beta). Invites, challenges and digests come later.
-- Ownership comes from crews.created_by only; crew_members has no role column.

create table public.crews (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 60),
  created_by  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index crews_created_by_idx on public.crews (created_by);

create table public.crew_members (
  crew_id    uuid not null references public.crews (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (crew_id, user_id)
);
create index crew_members_user_idx on public.crew_members (user_id);
