-- SELF-TEST FIXTURE: a plain failing assertion must fail the run.
begin;
select plan(1);
select ok(false, 'this assertion fails on purpose');
select * from finish();
rollback;
