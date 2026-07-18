-- SELF-TEST FIXTURE: a clean file must still pass (guards against a runner
-- that fails everything).
begin;
select plan(2);
select ok(true, 'truth holds');
select is(1, 1, 'arithmetic holds');
select * from finish();
rollback;
