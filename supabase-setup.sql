-- ============================================================
--  ЩДК — налаштування бази для кількох ігор
--  Виконати один раз: Supabase → SQL Editor → New query → Run
-- ============================================================

-- 1. Тип гри для кожного пакета.
--    Усі наявні пакети автоматично стануть пакетами «Що? Де? Коли?».
alter table packages add column if not exists game text not null default 'chgk';

-- 2. Сховище для картинок, аудіо й відео в запитаннях
insert into storage.buckets (id, name, public)
values ('qdkk-media', 'qdkk-media', true)
on conflict (id) do nothing;

-- 3. Дозволи для сховища (як і для таблиці пакетів — без входу в акаунт)
drop policy if exists "qdkk media read"   on storage.objects;
drop policy if exists "qdkk media upload" on storage.objects;
drop policy if exists "qdkk media update" on storage.objects;
drop policy if exists "qdkk media delete" on storage.objects;
create policy "qdkk media read"   on storage.objects for select using (bucket_id = 'qdkk-media');
create policy "qdkk media upload" on storage.objects for insert with check (bucket_id = 'qdkk-media');
create policy "qdkk media update" on storage.objects for update using (bucket_id = 'qdkk-media');
create policy "qdkk media delete" on storage.objects for delete using (bucket_id = 'qdkk-media');
