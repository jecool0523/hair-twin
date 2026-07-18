-- Hair Twin — bind a mask contract's source image to its session.
--
-- DEFECT (reproduced against Postgres before writing this): mask_contracts had
-- two INDEPENDENT composite FKs —
--
--   (session_id, salon_id)      -> consultation_sessions(id, salon_id)
--   (source_image_id, salon_id) -> source_images(id, salon_id)
--
-- Each proves salon agreement, but NOTHING tied the source to the session. So
-- within one salon, a contract could claim session B while using session A's
-- source photo: customer A's face cross-linked into customer B's consultation.
-- Cross-salon was impossible; cross-customer within a salon was not.
--
-- Fix: source_images gains a (id, salon_id, session_id) unique target, and
-- mask_contracts references all three columns in ONE foreign key. A contract
-- whose session disagrees with its source's session now fails with 23503.
--
-- generation_jobs and mask_assets are transitively covered: they already
-- reference mask_contracts by the 4-column identity (id, salon_id, session_id,
-- source_image_id), so they can only ever agree with a contract that this FK
-- has already proven consistent.
--
-- The two original FKs stay: dropping constraints created by an applied-order
-- migration would rewrite history, and they are subsumed, not wrong.

alter table public.source_images
  add constraint source_images_id_salon_session_key
  unique (id, salon_id, session_id);

alter table public.mask_contracts
  add constraint mask_contracts_source_in_session
  foreign key (source_image_id, salon_id, session_id)
  references public.source_images (id, salon_id, session_id)
  on delete cascade;
