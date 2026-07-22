-- Dev seed. Intended for a LOCAL Supabase stack only (`supabase db reset`).
-- Never run against a shared or production project.

insert into public.organizations (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Hair Twin Dev Org')
on conflict (id) do nothing;

insert into public.salons (id, organization_id, name)
values (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  '헤어트윈 데모 살롱'
)
on conflict (id) do nothing;

-- Global style presets (salon_id NULL). Mirrors
-- apps/web/src/lib/domain/style-presets.ts — keep the ids in sync.
insert into public.style_presets (id, display_name_ko, category, attributes, salon_id) values
 ('layered-c-curl','레이어드 C컬','perm',
  '{"length":"collarbone to mid-length","bangs":"none","texture":"smooth C-curl ends","volume":"moderate natural volume"}'::jsonb, null),
 ('see-through-bob','시스루뱅 단발','cut',
  '{"length":"chin-length bob","bangs":"airy see-through bangs","texture":"light airy texture"}'::jsonb, null),
 ('hush-cut','허쉬컷','cut',
  '{"length":"medium","bangs":"wispy curtain fringe","texture":"soft movement"}'::jsonb, null),
 ('long-wave','긴 웨이브','perm',
  '{"length":"long","texture":"loose glossy waves","volume":"soft blowout volume"}'::jsonb, null),
 ('tassel-cut','태슬컷','cut',
  '{"length":"shoulder-length bob","texture":"polished straight texture"}'::jsonb, null),
 ('ash-brown-tone-down','애쉬 브라운 톤다운','color',
  '{"color":{"family":"brown","tone":"neutral ash brown","level":6}}'::jsonb, null),
 ('balayage','발레아쥬','color',
  '{"color":{"family":"brown","tone":"dimensional balayage highlights","level":7}}'::jsonb, null),
 ('volume-magic','볼륨매직','perm',
  '{"texture":"sleek straight with curved ends","volume":"natural root lift"}'::jsonb, null),
 ('leaf-cut','리프컷','cut',
  '{"length":"medium","bangs":"side-swept fringe"}'::jsonb, null),
 ('dandy-cut','댄디컷','cut',
  '{"length":"short","bangs":"neat fringe"}'::jsonb, null)
on conflict (id) do nothing;

-- NOTE: no staff/profiles are seeded. Profiles reference auth.users, so create
-- a user through Auth first, then insert the profile + salon_membership. Seeding
-- fake auth users here would make the local stack diverge from a real project.
