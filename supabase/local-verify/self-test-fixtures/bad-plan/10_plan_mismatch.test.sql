-- SELF-TEST FIXTURE (not part of the schema suite).
-- Deliberate plan mismatch: promises 2 assertions, runs 1. The runner must
-- fail on this; if it reports green, the runner itself has regressed.
begin;
select plan(2);
select ok(true, 'only one assertion actually runs');
select * from finish();
rollback;
