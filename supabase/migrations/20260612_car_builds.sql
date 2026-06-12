-- car_builds: one record per build per user
create table public.car_builds (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  year integer,
  make text,
  model text,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz default now() not null
);

-- car_build_phases: phases within a build
create table public.car_build_phases (
  id uuid default gen_random_uuid() primary key,
  build_id uuid references public.car_builds(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  sort_order integer not null default 0,
  hidden boolean not null default false,
  created_at timestamptz default now() not null
);

-- car_build_items: items within a phase
create table public.car_build_items (
  id uuid default gen_random_uuid() primary key,
  phase_id uuid references public.car_build_phases(id) on delete cascade not null,
  build_id uuid references public.car_builds(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  brand text,
  price numeric,
  link text,
  completed boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz default now() not null
);

-- Indexes
create index idx_car_builds_user on public.car_builds(user_id);
create index idx_car_build_phases_build on public.car_build_phases(build_id);
create index idx_car_build_items_build on public.car_build_items(build_id);
create index idx_car_build_items_phase on public.car_build_items(phase_id);

-- RLS
alter table public.car_builds enable row level security;
alter table public.car_build_phases enable row level security;
alter table public.car_build_items enable row level security;

create policy "users manage own builds"
  on public.car_builds for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users manage own build phases"
  on public.car_build_phases for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users manage own build items"
  on public.car_build_items for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
