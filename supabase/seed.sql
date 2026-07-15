-- Dev seed data. Safe to run against a local Supabase only.
-- Provides one org, one salon, and the global style presets used by the app.

insert into organizations (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Hair Twin Dev Org')
on conflict (id) do nothing;

insert into salons (id, organization_id, name)
values (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  '헤어트윈 데모 살롱'
)
on conflict (id) do nothing;

-- Global style presets (mirror of apps/web/src/lib/domain/style-presets.ts).
insert into style_presets (id, display_name_ko, category, attributes, salon_id) values
 ('layered-c-curl','레이어드 C컬','perm','{"length":"collarbone to mid-length","texture":"smooth C-curl ends"}',null),
 ('see-through-bob','시스루뱅 단발','cut','{"length":"chin-length bob","bangs":"airy see-through bangs"}',null),
 ('hush-cut','허쉬컷','cut','{"length":"medium","bangs":"wispy curtain fringe"}',null),
 ('long-wave','긴 웨이브','perm','{"length":"long","texture":"loose glossy waves"}',null),
 ('tassel-cut','태슬컷','cut','{"length":"shoulder-length bob","texture":"polished straight"}',null),
 ('ash-brown-tone-down','애쉬 브라운 톤다운','color','{"color":"neutral ash brown, level 6"}',null),
 ('balayage','발레아쥬','color','{"color":"dimensional balayage highlights"}',null),
 ('volume-magic','볼륨매직','perm','{"volume":"natural root lift"}',null),
 ('leaf-cut','리프컷','cut','{"bangs":"side-swept fringe"}',null),
 ('dandy-cut','댄디컷','cut','{"length":"short","bangs":"neat fringe"}',null)
on conflict (id) do nothing;
-- Global presets use salon_id = NULL.
