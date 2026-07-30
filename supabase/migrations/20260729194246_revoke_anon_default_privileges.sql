-- Hair Twin -- restore the intended invite-only Data API boundary.
--
-- Supabase's real local stack provisions `anon` with non-DML table privileges
-- (including TRUNCATE) through platform defaults. RLS does not apply to
-- TRUNCATE, so relying on policies alone is not sufficient. The offline shim
-- did not model these defaults, which is why the coverage guard previously
-- passed there but failed on the authoritative stack.

revoke all privileges on schema public from anon;
revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;

-- Keep future objects default-deny as well. Explicit authenticated grants and
-- RPC ACLs remain the only application access path.
alter default privileges in schema public revoke all privileges on tables from anon;
alter default privileges in schema public revoke all privileges on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;
