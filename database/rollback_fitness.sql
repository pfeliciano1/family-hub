-- =====================================================================
-- Family Hub — undo Fitness (rollback_fitness.sql)
--
-- Removes ONLY what database/fitness.sql added: the five fitness_*
-- tables (with all workouts, profiles and custom routines in them), their
-- security rules, and the fitness_family_summary function.
-- Nothing else in Family Hub is touched.
--
-- How to run: Supabase dashboard → SQL Editor → New query → paste → Run.
-- Supabase will warn that it contains "drop" statements; that's expected.
-- Safe to run more than once.
-- =====================================================================

drop function if exists public.fitness_family_summary(text);

-- Dropping a table also removes its security rules and indexes.
drop table if exists public.fitness_logs;
drop table if exists public.fitness_routine_steps;
drop table if exists public.fitness_routines;
drop table if exists public.fitness_exercises;
drop table if exists public.fitness_profiles;
