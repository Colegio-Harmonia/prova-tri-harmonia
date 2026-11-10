-- Baseline estrutural de 10/11/2026. Sem dados, proprietários ou credenciais.
-- Somente para banco vazio: npm run db:bootstrap -- --database NOME
--
-- PostgreSQL database dump
--


-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: drizzle; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA drizzle;


--
-- Name: enforce_exam_scan_page_assignment_exam(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_exam_scan_page_assignment_exam() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  upload_exam_id integer;
  assignment_exam_id integer;
BEGIN
  IF NEW.sheet_assignment_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT exam_id INTO upload_exam_id
  FROM exam_scan_uploads
  WHERE id = NEW.upload_id;

  SELECT exam_id INTO assignment_exam_id
  FROM exam_sheet_assignments
  WHERE id = NEW.sheet_assignment_id;

  IF upload_exam_id IS NULL OR assignment_exam_id IS NULL OR upload_exam_id <> assignment_exam_id THEN
    RAISE EXCEPTION 'exam_scan_pages: associação da página pertence a outra prova (upload %, assignment %)', NEW.upload_id, NEW.sheet_assignment_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: __drizzle_migrations; Type: TABLE; Schema: drizzle; Owner: -
--

CREATE TABLE drizzle.__drizzle_migrations (
    id integer NOT NULL,
    hash text NOT NULL,
    created_at bigint
);


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE; Schema: drizzle; Owner: -
--

CREATE SEQUENCE drizzle.__drizzle_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: drizzle; Owner: -
--

ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNED BY drizzle.__drizzle_migrations.id;


--
-- Name: activity_classroom_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_classroom_results (
    id integer NOT NULL,
    exam_id integer NOT NULL,
    classroom_student_id text NOT NULL,
    classroom_submission_id text NOT NULL,
    student_name text NOT NULL,
    student_email text,
    submission_state text,
    assigned_grade real,
    assigned_rubric_grades jsonb,
    imported_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone
);


--
-- Name: activity_classroom_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.activity_classroom_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: activity_classroom_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.activity_classroom_results_id_seq OWNED BY public.activity_classroom_results.id;


--
-- Name: activity_classroom_syncs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_classroom_syncs (
    id integer NOT NULL,
    exam_id integer NOT NULL,
    course_id text NOT NULL,
    coursework_id text NOT NULL,
    rubric_id text,
    published_at timestamp without time zone DEFAULT now() NOT NULL,
    last_imported_at timestamp without time zone,
    last_import_error text,
    form_id text
);


--
-- Name: activity_classroom_syncs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.activity_classroom_syncs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: activity_classroom_syncs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.activity_classroom_syncs_id_seq OWNED BY public.activity_classroom_syncs.id;


--
-- Name: adapted_exams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.adapted_exams (
    id integer NOT NULL,
    exam_id integer NOT NULL,
    adaptation_profiles text[] NOT NULL,
    library_versions jsonb NOT NULL,
    target_student_label text,
    adapted_payload jsonb,
    status text DEFAULT 'gerando'::text NOT NULL,
    validation_report jsonb,
    error_message text,
    prova_adaptada_doc_id text,
    prova_adaptada_doc_url text,
    created_by integer NOT NULL,
    approved_by integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    approved_at timestamp without time zone
);


--
-- Name: adapted_exams_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.adapted_exams_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: adapted_exams_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.adapted_exams_id_seq OWNED BY public.adapted_exams.id;


--
-- Name: administrative_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.administrative_audit (
    id integer NOT NULL,
    action text NOT NULL,
    actor_id integer NOT NULL,
    target_user_id integer,
    previous_value jsonb,
    next_value jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: administrative_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.administrative_audit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: administrative_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.administrative_audit_id_seq OWNED BY public.administrative_audit.id;


--
-- Name: ai_budget_controls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_budget_controls (
    purpose text NOT NULL,
    disabled boolean DEFAULT false NOT NULL,
    updated_by integer NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_budget_resets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_budget_resets (
    id integer NOT NULL,
    purpose text,
    reset_by integer NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_budget_resets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_budget_resets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_budget_resets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_budget_resets_id_seq OWNED BY public.ai_budget_resets.id;


--
-- Name: ai_model_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_model_profiles (
    id integer NOT NULL,
    purpose text NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    input_cost_microusd_per_million integer,
    output_cost_microusd_per_million integer,
    image_cost_microusd integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_model_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_model_profiles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_model_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_model_profiles_id_seq OWNED BY public.ai_model_profiles.id;


--
-- Name: ai_operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_operations (
    id integer NOT NULL,
    operation text NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    status text NOT NULL,
    attempt smallint NOT NULL,
    prompt_tokens integer,
    completion_tokens integer,
    total_tokens integer,
    duration_ms integer,
    error_code text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    model_profile_id integer,
    estimated_cost_microusd integer
);


--
-- Name: ai_operations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_operations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_operations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_operations_id_seq OWNED BY public.ai_operations.id;


--
-- Name: application_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.application_settings (
    key text NOT NULL,
    value text NOT NULL,
    updated_by integer NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: curriculum_enrichment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.curriculum_enrichment (
    id integer NOT NULL,
    segment text NOT NULL,
    grade_year integer NOT NULL,
    subject text NOT NULL,
    chapter_title text NOT NULL,
    bimester integer,
    enriched_content text,
    detailed_objectives text,
    pedagogical_notes text,
    source text DEFAULT 'manual_professor'::text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: curriculum_enrichment_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.curriculum_enrichment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: curriculum_enrichment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.curriculum_enrichment_id_seq OWNED BY public.curriculum_enrichment.id;


--
-- Name: curriculum_plan_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.curriculum_plan_assignments (
    id integer NOT NULL,
    plan_id integer NOT NULL,
    user_id integer NOT NULL,
    responsibility text DEFAULT 'responsavel'::text NOT NULL,
    assigned_by integer NOT NULL,
    assigned_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT curriculum_plan_assignments_responsibility_check CHECK ((responsibility = ANY (ARRAY['responsavel'::text, 'colaborador'::text])))
);


--
-- Name: curriculum_plan_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.curriculum_plan_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: curriculum_plan_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.curriculum_plan_assignments_id_seq OWNED BY public.curriculum_plan_assignments.id;


--
-- Name: curriculum_plan_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.curriculum_plan_skills (
    id integer NOT NULL,
    unit_id integer NOT NULL,
    code text NOT NULL,
    description text,
    "position" integer NOT NULL,
    target_mastery_percent smallint DEFAULT 100 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT curriculum_plan_skills_position_check CHECK (("position" >= 0)),
    CONSTRAINT curriculum_plan_skills_target_mastery_percent_check CHECK (((target_mastery_percent >= 0) AND (target_mastery_percent <= 100)))
);


--
-- Name: curriculum_plan_skills_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.curriculum_plan_skills_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: curriculum_plan_skills_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.curriculum_plan_skills_id_seq OWNED BY public.curriculum_plan_skills.id;


--
-- Name: curriculum_plan_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.curriculum_plan_status_history (
    id integer NOT NULL,
    version_id integer NOT NULL,
    from_status text,
    to_status text NOT NULL,
    changed_by integer NOT NULL,
    note text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT curriculum_plan_status_history_from_status_check CHECK (((from_status IS NULL) OR (from_status = ANY (ARRAY['rascunho'::text, 'em_revisao'::text, 'aprovado'::text, 'encerrado'::text])))),
    CONSTRAINT curriculum_plan_status_history_to_status_check CHECK ((to_status = ANY (ARRAY['rascunho'::text, 'em_revisao'::text, 'aprovado'::text, 'encerrado'::text])))
);


--
-- Name: curriculum_plan_status_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.curriculum_plan_status_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: curriculum_plan_status_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.curriculum_plan_status_history_id_seq OWNED BY public.curriculum_plan_status_history.id;


--
-- Name: curriculum_plan_units; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.curriculum_plan_units (
    id integer NOT NULL,
    version_id integer NOT NULL,
    "position" integer NOT NULL,
    title text NOT NULL,
    content text,
    objectives text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    enem_skills text,
    CONSTRAINT curriculum_plan_units_position_check CHECK (("position" >= 0))
);


--
-- Name: curriculum_plan_units_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.curriculum_plan_units_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: curriculum_plan_units_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.curriculum_plan_units_id_seq OWNED BY public.curriculum_plan_units.id;


--
-- Name: curriculum_plan_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.curriculum_plan_versions (
    id integer NOT NULL,
    plan_id integer NOT NULL,
    version_number integer NOT NULL,
    status text DEFAULT 'rascunho'::text NOT NULL,
    source text DEFAULT 'interno'::text NOT NULL,
    source_reference text,
    source_hash text,
    copied_from_version_id integer,
    created_by integer NOT NULL,
    reviewed_by integer,
    approved_by integer,
    submitted_at timestamp without time zone,
    approved_at timestamp without time zone,
    closed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT curriculum_plan_versions_source_check CHECK ((source = ANY (ARRAY['interno'::text, 'planilha'::text, 'copia'::text]))),
    CONSTRAINT curriculum_plan_versions_status_check CHECK ((status = ANY (ARRAY['rascunho'::text, 'em_revisao'::text, 'aprovado'::text, 'encerrado'::text]))),
    CONSTRAINT curriculum_plan_versions_version_number_check CHECK ((version_number > 0))
);


--
-- Name: curriculum_plan_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.curriculum_plan_versions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: curriculum_plan_versions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.curriculum_plan_versions_id_seq OWNED BY public.curriculum_plan_versions.id;


--
-- Name: curriculum_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.curriculum_plans (
    id integer NOT NULL,
    academic_year integer NOT NULL,
    segment text NOT NULL,
    grade_year integer NOT NULL,
    subject text NOT NULL,
    bimester smallint NOT NULL,
    created_by integer NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT curriculum_plans_academic_year_check CHECK (((academic_year >= 2020) AND (academic_year <= 2100))),
    CONSTRAINT curriculum_plans_bimester_check CHECK (((bimester >= 1) AND (bimester <= 4))),
    CONSTRAINT curriculum_plans_grade_year_check CHECK (((grade_year >= 1) AND (grade_year <= 9))),
    CONSTRAINT curriculum_plans_segment_check CHECK ((segment = ANY (ARRAY['anos-iniciais'::text, 'anos-finais'::text, 'ensino-medio'::text])))
);


--
-- Name: curriculum_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.curriculum_plans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: curriculum_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.curriculum_plans_id_seq OWNED BY public.curriculum_plans.id;


--
-- Name: curriculum_tab_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.curriculum_tab_overrides (
    id integer NOT NULL,
    segment text NOT NULL,
    grade_year integer NOT NULL,
    subject text NOT NULL,
    sheet_tab_name text NOT NULL,
    updated_by integer,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: curriculum_tab_overrides_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.curriculum_tab_overrides_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: curriculum_tab_overrides_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.curriculum_tab_overrides_id_seq OWNED BY public.curriculum_tab_overrides.id;


--
-- Name: enem_areas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enem_areas (
    id integer NOT NULL,
    code character varying(32) NOT NULL,
    name text NOT NULL,
    "order" smallint NOT NULL
);


--
-- Name: enem_areas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.enem_areas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: enem_areas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.enem_areas_id_seq OWNED BY public.enem_areas.id;


--
-- Name: enem_cognitive_axes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enem_cognitive_axes (
    id integer NOT NULL,
    code character varying(4) NOT NULL,
    name text NOT NULL,
    description text NOT NULL
);


--
-- Name: enem_cognitive_axes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.enem_cognitive_axes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: enem_cognitive_axes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.enem_cognitive_axes_id_seq OWNED BY public.enem_cognitive_axes.id;


--
-- Name: enem_competencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enem_competencies (
    id integer NOT NULL,
    area_id integer NOT NULL,
    number smallint NOT NULL,
    description text NOT NULL
);


--
-- Name: enem_competencies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.enem_competencies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: enem_competencies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.enem_competencies_id_seq OWNED BY public.enem_competencies.id;


--
-- Name: enem_sae_imports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enem_sae_imports (
    id integer NOT NULL,
    academic_year integer NOT NULL,
    grade_year smallint DEFAULT 3 NOT NULL,
    bimester smallint NOT NULL,
    analysis jsonb NOT NULL,
    imported_by integer NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: enem_sae_imports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.enem_sae_imports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: enem_sae_imports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.enem_sae_imports_id_seq OWNED BY public.enem_sae_imports.id;


--
-- Name: enem_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enem_skills (
    id integer NOT NULL,
    competency_id integer NOT NULL,
    code character varying(16) NOT NULL,
    description text NOT NULL
);


--
-- Name: enem_skills_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.enem_skills_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: enem_skills_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.enem_skills_id_seq OWNED BY public.enem_skills.id;


--
-- Name: exam_corrections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_corrections (
    id integer NOT NULL,
    exam_id integer NOT NULL,
    student_name text NOT NULL,
    student_email text,
    answers jsonb NOT NULL,
    status text DEFAULT 'pendente'::text NOT NULL,
    created_by integer NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone,
    classroom_student_id text,
    grade_returned_at timestamp without time zone,
    score_result jsonb,
    attendance_status text DEFAULT 'presente'::text NOT NULL,
    absence_marked_at timestamp without time zone,
    absence_marked_by integer
);


--
-- Name: exam_corrections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.exam_corrections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: exam_corrections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.exam_corrections_id_seq OWNED BY public.exam_corrections.id;


--
-- Name: exam_scan_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_scan_audit_events (
    id integer NOT NULL,
    exam_id integer NOT NULL,
    upload_id integer,
    action text NOT NULL,
    actor_id integer,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: exam_scan_audit_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.exam_scan_audit_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: exam_scan_audit_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.exam_scan_audit_events_id_seq OWNED BY public.exam_scan_audit_events.id;


--
-- Name: exam_scan_pages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_scan_pages (
    id integer NOT NULL,
    upload_id integer NOT NULL,
    page_index smallint NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    exception_code text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone,
    sheet_assignment_id integer,
    sheet_page_number smallint,
    page_type text,
    qr_token_digest text,
    quality_score real,
    canonical_drive_file_id text,
    canonical_verified_sha256 text,
    canonical_mime_type text,
    canonical_staging_object_key text,
    canonical_archived_at timestamp without time zone,
    canonical_archive_error_code text,
    detected_sheet_assignment_id integer
);


--
-- Name: exam_scan_pages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.exam_scan_pages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: exam_scan_pages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.exam_scan_pages_id_seq OWNED BY public.exam_scan_pages.id;


--
-- Name: exam_scan_processing_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_scan_processing_attempts (
    id integer NOT NULL,
    upload_id integer NOT NULL,
    attempt_number smallint NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    requested_by integer NOT NULL,
    delivered_at timestamp without time zone,
    delivery_error_code text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone
);


--
-- Name: exam_scan_processing_attempts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.exam_scan_processing_attempts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: exam_scan_processing_attempts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.exam_scan_processing_attempts_id_seq OWNED BY public.exam_scan_processing_attempts.id;


--
-- Name: exam_scan_readings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_scan_readings (
    id integer NOT NULL,
    page_id integer NOT NULL,
    question_number smallint NOT NULL,
    kind text NOT NULL,
    suggested_letter text,
    suggested_transcription text,
    confidence real,
    exception_code text,
    model_reference text,
    review_status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone,
    crop_drive_file_id text,
    crop_verified_sha256 text,
    crop_mime_type text,
    crop_staging_object_key text,
    crop_archived_at timestamp without time zone,
    crop_archive_error_code text,
    confirmed_letter text,
    confirmed_transcription text,
    reviewed_by integer,
    reviewed_at timestamp without time zone
);


--
-- Name: exam_scan_readings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.exam_scan_readings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: exam_scan_readings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.exam_scan_readings_id_seq OWNED BY public.exam_scan_readings.id;


--
-- Name: exam_scan_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_scan_uploads (
    id integer NOT NULL,
    exam_id integer NOT NULL,
    mime_type text NOT NULL,
    byte_size integer NOT NULL,
    sha256 text NOT NULL,
    staging_object_key text,
    status text DEFAULT 'staged'::text NOT NULL,
    drive_file_id text,
    drive_verified_sha256 text,
    archived_at timestamp without time zone,
    archive_error_code text,
    technical_metadata jsonb,
    created_by integer NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone
);


--
-- Name: exam_scan_uploads_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.exam_scan_uploads_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: exam_scan_uploads_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.exam_scan_uploads_id_seq OWNED BY public.exam_scan_uploads.id;


--
-- Name: exam_sheet_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_sheet_assignments (
    id integer NOT NULL,
    exam_id integer NOT NULL,
    exam_correction_id integer NOT NULL,
    classroom_student_id text NOT NULL,
    student_name_snapshot text NOT NULL,
    student_email_snapshot text,
    public_id text NOT NULL,
    token_digest text,
    layout_version text DEFAULT 'PTR1'::text NOT NULL,
    page_count smallint DEFAULT 2 NOT NULL,
    status text DEFAULT 'pronta'::text NOT NULL,
    issued_by integer NOT NULL,
    emitted_at timestamp without time zone,
    emitted_by integer,
    voided_at timestamp without time zone,
    voided_by integer,
    reprint_of_id integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone
);


--
-- Name: exam_sheet_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.exam_sheet_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: exam_sheet_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.exam_sheet_assignments_id_seq OWNED BY public.exam_sheet_assignments.id;


--
-- Name: exam_user_archives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_user_archives (
    id integer NOT NULL,
    exam_id integer NOT NULL,
    user_id integer NOT NULL,
    archived_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: exam_user_archives_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.exam_user_archives_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: exam_user_archives_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.exam_user_archives_id_seq OWNED BY public.exam_user_archives.id;


--
-- Name: generated_exams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generated_exams (
    id integer NOT NULL,
    created_by integer NOT NULL,
    segment text NOT NULL,
    grade_year integer NOT NULL,
    subject text NOT NULL,
    bimester integer,
    question_count integer NOT NULL,
    objective_count integer NOT NULL,
    discursive_count integer NOT NULL,
    status text DEFAULT 'rascunho'::text NOT NULL,
    generation_payload jsonb NOT NULL,
    unmapped_warnings jsonb,
    drive_folder_id text,
    prova_doc_id text,
    prova_doc_url text,
    gabarito_doc_id text,
    gabarito_doc_url text,
    mapa_doc_id text,
    mapa_doc_url text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    finalized_at timestamp without time zone,
    assigned_to integer,
    assigned_by integer,
    assigned_at timestamp without time zone,
    chat_notified_at timestamp without time zone,
    reviewed_at timestamp without time zone,
    printed_at timestamp without time zone,
    applied_at timestamp without time zone,
    corrected_at timestamp without time zone,
    academic_year integer NOT NULL,
    enem_bank_question_ids integer[],
    classroom_course_id text,
    classroom_coursework_id text,
    review_ready_notified_at timestamp without time zone,
    assessment_kind text DEFAULT 'padrao'::text NOT NULL,
    scoring_method text DEFAULT 'percentual'::text NOT NULL,
    exam_kind text DEFAULT 'prova'::text NOT NULL,
    archived_at timestamp without time zone
);


--
-- Name: generated_exams_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.generated_exams_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: generated_exams_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.generated_exams_id_seq OWNED BY public.generated_exams.id;


--
-- Name: generation_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generation_batches (
    id integer NOT NULL,
    requested_by integer NOT NULL,
    segment text NOT NULL,
    grade_year integer NOT NULL,
    academic_year integer NOT NULL,
    class_label text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: generation_batches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.generation_batches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: generation_batches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.generation_batches_id_seq OWNED BY public.generation_batches.id;


--
-- Name: generation_job_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generation_job_items (
    id integer NOT NULL,
    job_id integer NOT NULL,
    slot_number integer NOT NULL,
    status text DEFAULT 'pendente'::text NOT NULL,
    question_payload jsonb,
    issues jsonb,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    last_error text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    quality_repair_attempts integer DEFAULT 0 NOT NULL,
    quality_repair_history jsonb DEFAULT '[]'::jsonb NOT NULL,
    current_stage text,
    stage_checkpoints jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: generation_job_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.generation_job_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: generation_job_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.generation_job_items_id_seq OWNED BY public.generation_job_items.id;


--
-- Name: generation_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generation_jobs (
    id integer NOT NULL,
    batch_id integer,
    job_type text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'pendente'::text NOT NULL,
    priority integer DEFAULT 5 NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 2 NOT NULL,
    result_exam_id integer,
    result_ref jsonb,
    error_message text,
    requested_by integer NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    started_at timestamp without time zone,
    finished_at timestamp without time zone,
    available_at timestamp without time zone,
    last_heartbeat_at timestamp without time zone
);


--
-- Name: generation_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.generation_jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: generation_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.generation_jobs_id_seq OWNED BY public.generation_jobs.id;


--
-- Name: google_chat_installations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.google_chat_installations (
    id integer NOT NULL,
    user_id integer,
    chat_user_id text NOT NULL,
    space_name text NOT NULL,
    connect_token_hash text NOT NULL,
    connect_token_expires_at timestamp without time zone NOT NULL,
    active boolean DEFAULT true NOT NULL,
    connected_at timestamp without time zone,
    removed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: google_chat_installations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.google_chat_installations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: google_chat_installations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.google_chat_installations_id_seq OWNED BY public.google_chat_installations.id;


--
-- Name: imported_question_classifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.imported_question_classifications (
    id integer NOT NULL,
    question_id integer NOT NULL,
    source character varying(16) DEFAULT 'enem'::character varying NOT NULL,
    bloom_level character varying(16),
    bloom_level_source character varying(16) DEFAULT 'pending'::character varying,
    enem_area_id integer,
    enem_competency_id integer,
    enem_skill_id integer,
    enem_cognitive_axis_id integer,
    enem_classification_source character varying(16) DEFAULT 'pending'::character varying,
    classified_at timestamp without time zone,
    classified_by integer,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: imported_question_classifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.imported_question_classifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: imported_question_classifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.imported_question_classifications_id_seq OWNED BY public.imported_question_classifications.id;


--
-- Name: imported_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.imported_questions (
    id integer NOT NULL,
    source character varying(16) DEFAULT 'enem'::character varying NOT NULL,
    year smallint NOT NULL,
    question_index smallint NOT NULL,
    discipline character varying(64),
    language character varying(32) DEFAULT ''::character varying,
    title text NOT NULL,
    context text,
    files jsonb DEFAULT '[]'::jsonb,
    correct_alternative character(1) NOT NULL,
    alternatives_introduction text,
    alternatives jsonb NOT NULL,
    raw_json jsonb,
    created_at timestamp without time zone DEFAULT now(),
    tri_param_a real,
    tri_param_b real,
    tri_param_c real,
    tri_param_source text,
    discipline_source text,
    discipline_original character varying(64)
);


--
-- Name: imported_questions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.imported_questions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: imported_questions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.imported_questions_id_seq OWNED BY public.imported_questions.id;


--
-- Name: jev_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jev_decisions (
    id integer NOT NULL,
    operation text NOT NULL,
    question_version text NOT NULL,
    model text NOT NULL,
    state_hash text NOT NULL,
    cache_key text NOT NULL,
    source text NOT NULL,
    status text NOT NULL,
    route text NOT NULL,
    outcome text NOT NULL,
    context jsonb,
    answers jsonb,
    duration_ms integer,
    error_code text,
    cache_expires_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: jev_decisions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jev_decisions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jev_decisions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jev_decisions_id_seq OWNED BY public.jev_decisions.id;


--
-- Name: pedagogical_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pedagogical_categories (
    id integer NOT NULL,
    taxonomy_id integer NOT NULL,
    code character varying(32) NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    "order" smallint NOT NULL,
    metadata jsonb,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone
);


--
-- Name: pedagogical_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pedagogical_categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pedagogical_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pedagogical_categories_id_seq OWNED BY public.pedagogical_categories.id;


--
-- Name: pedagogical_classification_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pedagogical_classification_audit (
    id integer NOT NULL,
    classification_id integer NOT NULL,
    action text NOT NULL,
    previous_value jsonb,
    new_value jsonb,
    reason text,
    performed_by integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: pedagogical_classification_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pedagogical_classification_audit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pedagogical_classification_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pedagogical_classification_audit_id_seq OWNED BY public.pedagogical_classification_audit.id;


--
-- Name: pedagogical_classifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pedagogical_classifications (
    id integer NOT NULL,
    classifiable_type text NOT NULL,
    classifiable_id integer NOT NULL,
    classifiable_sub_id integer,
    taxonomy_id integer NOT NULL,
    category_id integer NOT NULL,
    classification_code character varying(32) NOT NULL,
    is_primary boolean DEFAULT true NOT NULL,
    confidence real,
    source text NOT NULL,
    status text DEFAULT 'sugerida'::text NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    explanation text,
    evidence text,
    manual_version text,
    model_provider text,
    model_name text,
    prompt_version text,
    version integer DEFAULT 1 NOT NULL,
    supersedes_id integer,
    created_by integer,
    approved_by integer,
    approved_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone
);


--
-- Name: pedagogical_classifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pedagogical_classifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pedagogical_classifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pedagogical_classifications_id_seq OWNED BY public.pedagogical_classifications.id;


--
-- Name: pedagogical_decision_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pedagogical_decision_log (
    id integer NOT NULL,
    entity_type text NOT NULL,
    entity_id integer NOT NULL,
    plan_id integer,
    action text NOT NULL,
    summary text NOT NULL,
    details jsonb,
    actor_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT pedagogical_decision_log_entity_type_check CHECK ((entity_type = ANY (ARRAY['plano'::text, 'versao'::text, 'intervencao'::text])))
);


--
-- Name: pedagogical_decision_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pedagogical_decision_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pedagogical_decision_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pedagogical_decision_log_id_seq OWNED BY public.pedagogical_decision_log.id;


--
-- Name: pedagogical_interventions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pedagogical_interventions (
    id integer NOT NULL,
    segment text NOT NULL,
    grade_year integer NOT NULL,
    subject text NOT NULL,
    academic_year integer,
    action text NOT NULL,
    owner_name text NOT NULL,
    due_date text,
    status text DEFAULT 'planejada'::text NOT NULL,
    created_by integer NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    skill_codes text[] DEFAULT '{}'::text[] NOT NULL,
    bimester smallint,
    CONSTRAINT pedagogical_interventions_bimester_check CHECK (((bimester IS NULL) OR ((bimester >= 1) AND (bimester <= 4))))
);


--
-- Name: pedagogical_interventions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pedagogical_interventions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pedagogical_interventions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pedagogical_interventions_id_seq OWNED BY public.pedagogical_interventions.id;


--
-- Name: pedagogical_taxonomies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pedagogical_taxonomies (
    id integer NOT NULL,
    code character varying(32) NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    manual_version text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone
);


--
-- Name: pedagogical_taxonomies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pedagogical_taxonomies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pedagogical_taxonomies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pedagogical_taxonomies_id_seq OWNED BY public.pedagogical_taxonomies.id;


--
-- Name: question_bank; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.question_bank (
    id integer NOT NULL,
    segment text NOT NULL,
    grade_year integer NOT NULL,
    subject text NOT NULL,
    bimester integer,
    type text NOT NULL,
    bloom_level text,
    bncc_codes text[],
    statement text NOT NULL,
    alternatives jsonb,
    correct_answer text,
    source text,
    source_year integer,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: question_bank_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.question_bank_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: question_bank_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.question_bank_id_seq OWNED BY public.question_bank.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    password_hash text,
    role text DEFAULT 'professor'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    last_login_at timestamp without time zone,
    google_id text
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: __drizzle_migrations id; Type: DEFAULT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations ALTER COLUMN id SET DEFAULT nextval('drizzle.__drizzle_migrations_id_seq'::regclass);


--
-- Name: activity_classroom_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_classroom_results ALTER COLUMN id SET DEFAULT nextval('public.activity_classroom_results_id_seq'::regclass);


--
-- Name: activity_classroom_syncs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_classroom_syncs ALTER COLUMN id SET DEFAULT nextval('public.activity_classroom_syncs_id_seq'::regclass);


--
-- Name: adapted_exams id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adapted_exams ALTER COLUMN id SET DEFAULT nextval('public.adapted_exams_id_seq'::regclass);


--
-- Name: administrative_audit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.administrative_audit ALTER COLUMN id SET DEFAULT nextval('public.administrative_audit_id_seq'::regclass);


--
-- Name: ai_budget_resets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_budget_resets ALTER COLUMN id SET DEFAULT nextval('public.ai_budget_resets_id_seq'::regclass);


--
-- Name: ai_model_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_model_profiles ALTER COLUMN id SET DEFAULT nextval('public.ai_model_profiles_id_seq'::regclass);


--
-- Name: ai_operations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_operations ALTER COLUMN id SET DEFAULT nextval('public.ai_operations_id_seq'::regclass);


--
-- Name: curriculum_enrichment id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_enrichment ALTER COLUMN id SET DEFAULT nextval('public.curriculum_enrichment_id_seq'::regclass);


--
-- Name: curriculum_plan_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plan_assignments ALTER COLUMN id SET DEFAULT nextval('public.curriculum_plan_assignments_id_seq'::regclass);


--
-- Name: curriculum_plan_skills id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plan_skills ALTER COLUMN id SET DEFAULT nextval('public.curriculum_plan_skills_id_seq'::regclass);


--
-- Name: curriculum_plan_status_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plan_status_history ALTER COLUMN id SET DEFAULT nextval('public.curriculum_plan_status_history_id_seq'::regclass);


--
-- Name: curriculum_plan_units id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plan_units ALTER COLUMN id SET DEFAULT nextval('public.curriculum_plan_units_id_seq'::regclass);


--
-- Name: curriculum_plan_versions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plan_versions ALTER COLUMN id SET DEFAULT nextval('public.curriculum_plan_versions_id_seq'::regclass);


--
-- Name: curriculum_plans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plans ALTER COLUMN id SET DEFAULT nextval('public.curriculum_plans_id_seq'::regclass);


--
-- Name: curriculum_tab_overrides id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_tab_overrides ALTER COLUMN id SET DEFAULT nextval('public.curriculum_tab_overrides_id_seq'::regclass);


--
-- Name: enem_areas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enem_areas ALTER COLUMN id SET DEFAULT nextval('public.enem_areas_id_seq'::regclass);


--
-- Name: enem_cognitive_axes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enem_cognitive_axes ALTER COLUMN id SET DEFAULT nextval('public.enem_cognitive_axes_id_seq'::regclass);


--
-- Name: enem_competencies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enem_competencies ALTER COLUMN id SET DEFAULT nextval('public.enem_competencies_id_seq'::regclass);


--
-- Name: enem_sae_imports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enem_sae_imports ALTER COLUMN id SET DEFAULT nextval('public.enem_sae_imports_id_seq'::regclass);


--
-- Name: enem_skills id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enem_skills ALTER COLUMN id SET DEFAULT nextval('public.enem_skills_id_seq'::regclass);


--
-- Name: exam_corrections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_corrections ALTER COLUMN id SET DEFAULT nextval('public.exam_corrections_id_seq'::regclass);


--
-- Name: exam_scan_audit_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_scan_audit_events ALTER COLUMN id SET DEFAULT nextval('public.exam_scan_audit_events_id_seq'::regclass);


--
-- Name: exam_scan_pages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_scan_pages ALTER COLUMN id SET DEFAULT nextval('public.exam_scan_pages_id_seq'::regclass);


--
-- Name: exam_scan_processing_attempts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_scan_processing_attempts ALTER COLUMN id SET DEFAULT nextval('public.exam_scan_processing_attempts_id_seq'::regclass);


--
-- Name: exam_scan_readings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_scan_readings ALTER COLUMN id SET DEFAULT nextval('public.exam_scan_readings_id_seq'::regclass);


--
-- Name: exam_scan_uploads id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_scan_uploads ALTER COLUMN id SET DEFAULT nextval('public.exam_scan_uploads_id_seq'::regclass);


--
-- Name: exam_sheet_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_sheet_assignments ALTER COLUMN id SET DEFAULT nextval('public.exam_sheet_assignments_id_seq'::regclass);


--
-- Name: exam_user_archives id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_user_archives ALTER COLUMN id SET DEFAULT nextval('public.exam_user_archives_id_seq'::regclass);


--
-- Name: generated_exams id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_exams ALTER COLUMN id SET DEFAULT nextval('public.generated_exams_id_seq'::regclass);


--
-- Name: generation_batches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_batches ALTER COLUMN id SET DEFAULT nextval('public.generation_batches_id_seq'::regclass);


--
-- Name: generation_job_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_job_items ALTER COLUMN id SET DEFAULT nextval('public.generation_job_items_id_seq'::regclass);


--
-- Name: generation_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_jobs ALTER COLUMN id SET DEFAULT nextval('public.generation_jobs_id_seq'::regclass);


--
-- Name: google_chat_installations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_chat_installations ALTER COLUMN id SET DEFAULT nextval('public.google_chat_installations_id_seq'::regclass);


--
-- Name: imported_question_classifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imported_question_classifications ALTER COLUMN id SET DEFAULT nextval('public.imported_question_classifications_id_seq'::regclass);


--
-- Name: imported_questions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imported_questions ALTER COLUMN id SET DEFAULT nextval('public.imported_questions_id_seq'::regclass);


--
-- Name: jev_decisions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jev_decisions ALTER COLUMN id SET DEFAULT nextval('public.jev_decisions_id_seq'::regclass);


--
-- Name: pedagogical_categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedagogical_categories ALTER COLUMN id SET DEFAULT nextval('public.pedagogical_categories_id_seq'::regclass);


--
-- Name: pedagogical_classification_audit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedagogical_classification_audit ALTER COLUMN id SET DEFAULT nextval('public.pedagogical_classification_audit_id_seq'::regclass);


--
-- Name: pedagogical_classifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedagogical_classifications ALTER COLUMN id SET DEFAULT nextval('public.pedagogical_classifications_id_seq'::regclass);


--
-- Name: pedagogical_decision_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedagogical_decision_log ALTER COLUMN id SET DEFAULT nextval('public.pedagogical_decision_log_id_seq'::regclass);


--
-- Name: pedagogical_interventions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedagogical_interventions ALTER COLUMN id SET DEFAULT nextval('public.pedagogical_interventions_id_seq'::regclass);


--
-- Name: pedagogical_taxonomies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedagogical_taxonomies ALTER COLUMN id SET DEFAULT nextval('public.pedagogical_taxonomies_id_seq'::regclass);


--
-- Name: question_bank id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_bank ALTER COLUMN id SET DEFAULT nextval('public.question_bank_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: __drizzle_migrations __drizzle_migrations_pkey; Type: CONSTRAINT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);


--
-- Name: activity_classroom_results activity_classroom_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_classroom_results
    ADD CONSTRAINT activity_classroom_results_pkey PRIMARY KEY (id);


--
-- Name: activity_classroom_syncs activity_classroom_syncs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_classroom_syncs
    ADD CONSTRAINT activity_classroom_syncs_pkey PRIMARY KEY (id);


--
-- Name: adapted_exams adapted_exams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adapted_exams
    ADD CONSTRAINT adapted_exams_pkey PRIMARY KEY (id);


--
-- Name: administrative_audit administrative_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.administrative_audit
    ADD CONSTRAINT administrative_audit_pkey PRIMARY KEY (id);


--
-- Name: ai_budget_controls ai_budget_controls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_budget_controls
    ADD CONSTRAINT ai_budget_controls_pkey PRIMARY KEY (purpose);


--
-- Name: ai_budget_resets ai_budget_resets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_budget_resets
    ADD CONSTRAINT ai_budget_resets_pkey PRIMARY KEY (id);


--
-- Name: ai_model_profiles ai_model_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_model_profiles
    ADD CONSTRAINT ai_model_profiles_pkey PRIMARY KEY (id);


--
-- Name: ai_operations ai_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_operations
    ADD CONSTRAINT ai_operations_pkey PRIMARY KEY (id);


--
-- Name: application_settings application_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_settings
    ADD CONSTRAINT application_settings_pkey PRIMARY KEY (key);


--
-- Name: curriculum_enrichment curriculum_enrichment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_enrichment
    ADD CONSTRAINT curriculum_enrichment_pkey PRIMARY KEY (id);


--
-- Name: curriculum_enrichment curriculum_enrichment_segment_grade_year_subject_chapter_ti_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_enrichment
    ADD CONSTRAINT curriculum_enrichment_segment_grade_year_subject_chapter_ti_key UNIQUE (segment, grade_year, subject, chapter_title);


--
-- Name: curriculum_plan_assignments curriculum_plan_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plan_assignments
    ADD CONSTRAINT curriculum_plan_assignments_pkey PRIMARY KEY (id);


--
-- Name: curriculum_plan_skills curriculum_plan_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plan_skills
    ADD CONSTRAINT curriculum_plan_skills_pkey PRIMARY KEY (id);


--
-- Name: curriculum_plan_status_history curriculum_plan_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plan_status_history
    ADD CONSTRAINT curriculum_plan_status_history_pkey PRIMARY KEY (id);


--
-- Name: curriculum_plan_units curriculum_plan_units_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plan_units
    ADD CONSTRAINT curriculum_plan_units_pkey PRIMARY KEY (id);


--
-- Name: curriculum_plan_versions curriculum_plan_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plan_versions
    ADD CONSTRAINT curriculum_plan_versions_pkey PRIMARY KEY (id);


--
-- Name: curriculum_plans curriculum_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plans
    ADD CONSTRAINT curriculum_plans_pkey PRIMARY KEY (id);


--
-- Name: curriculum_tab_overrides curriculum_tab_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_tab_overrides
    ADD CONSTRAINT curriculum_tab_overrides_pkey PRIMARY KEY (id);


--
-- Name: enem_areas enem_areas_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enem_areas
    ADD CONSTRAINT enem_areas_code_unique UNIQUE (code);


--
-- Name: enem_areas enem_areas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enem_areas
    ADD CONSTRAINT enem_areas_pkey PRIMARY KEY (id);


--
-- Name: enem_cognitive_axes enem_cognitive_axes_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enem_cognitive_axes
    ADD CONSTRAINT enem_cognitive_axes_code_unique UNIQUE (code);


--
-- Name: enem_cognitive_axes enem_cognitive_axes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enem_cognitive_axes
    ADD CONSTRAINT enem_cognitive_axes_pkey PRIMARY KEY (id);


--
-- Name: enem_competencies enem_competencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enem_competencies
    ADD CONSTRAINT enem_competencies_pkey PRIMARY KEY (id);


--
-- Name: enem_sae_imports enem_sae_imports_period_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enem_sae_imports
    ADD CONSTRAINT enem_sae_imports_period_unique UNIQUE (academic_year, grade_year, bimester);


--
-- Name: enem_sae_imports enem_sae_imports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enem_sae_imports
    ADD CONSTRAINT enem_sae_imports_pkey PRIMARY KEY (id);


--
-- Name: enem_skills enem_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enem_skills
    ADD CONSTRAINT enem_skills_pkey PRIMARY KEY (id);


--
-- Name: exam_corrections exam_corrections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_corrections
    ADD CONSTRAINT exam_corrections_pkey PRIMARY KEY (id);


--
-- Name: exam_scan_audit_events exam_scan_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_scan_audit_events
    ADD CONSTRAINT exam_scan_audit_events_pkey PRIMARY KEY (id);


--
-- Name: exam_scan_pages exam_scan_pages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_scan_pages
    ADD CONSTRAINT exam_scan_pages_pkey PRIMARY KEY (id);


--
-- Name: exam_scan_processing_attempts exam_scan_processing_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_scan_processing_attempts
    ADD CONSTRAINT exam_scan_processing_attempts_pkey PRIMARY KEY (id);


--
-- Name: exam_scan_readings exam_scan_readings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_scan_readings
    ADD CONSTRAINT exam_scan_readings_pkey PRIMARY KEY (id);


--
-- Name: exam_scan_uploads exam_scan_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_scan_uploads
    ADD CONSTRAINT exam_scan_uploads_pkey PRIMARY KEY (id);


--
-- Name: exam_sheet_assignments exam_sheet_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_sheet_assignments
    ADD CONSTRAINT exam_sheet_assignments_pkey PRIMARY KEY (id);


--
-- Name: exam_user_archives exam_user_archives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_user_archives
    ADD CONSTRAINT exam_user_archives_pkey PRIMARY KEY (id);


--
-- Name: generated_exams generated_exams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_exams
    ADD CONSTRAINT generated_exams_pkey PRIMARY KEY (id);


--
-- Name: generation_batches generation_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_batches
    ADD CONSTRAINT generation_batches_pkey PRIMARY KEY (id);


--
-- Name: generation_job_items generation_job_items_job_id_slot_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_job_items
    ADD CONSTRAINT generation_job_items_job_id_slot_number_key UNIQUE (job_id, slot_number);


--
-- Name: generation_job_items generation_job_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_job_items
    ADD CONSTRAINT generation_job_items_pkey PRIMARY KEY (id);


--
-- Name: generation_jobs generation_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_jobs
    ADD CONSTRAINT generation_jobs_pkey PRIMARY KEY (id);


--
-- Name: google_chat_installations google_chat_installations_chat_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_chat_installations
    ADD CONSTRAINT google_chat_installations_chat_user_id_key UNIQUE (chat_user_id);


--
-- Name: google_chat_installations google_chat_installations_connect_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_chat_installations
    ADD CONSTRAINT google_chat_installations_connect_token_hash_key UNIQUE (connect_token_hash);


--
-- Name: google_chat_installations google_chat_installations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_chat_installations
    ADD CONSTRAINT google_chat_installations_pkey PRIMARY KEY (id);


--
-- Name: google_chat_installations google_chat_installations_space_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_chat_installations
    ADD CONSTRAINT google_chat_installations_space_name_key UNIQUE (space_name);


--
-- Name: imported_question_classifications imported_question_classifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imported_question_classifications
    ADD CONSTRAINT imported_question_classifications_pkey PRIMARY KEY (id);


--
-- Name: imported_questions imported_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imported_questions
    ADD CONSTRAINT imported_questions_pkey PRIMARY KEY (id);


--
-- Name: jev_decisions jev_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jev_decisions
    ADD CONSTRAINT jev_decisions_pkey PRIMARY KEY (id);


--
-- Name: pedagogical_categories pedagogical_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedagogical_categories
    ADD CONSTRAINT pedagogical_categories_pkey PRIMARY KEY (id);


--
-- Name: pedagogical_classification_audit pedagogical_classification_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedagogical_classification_audit
    ADD CONSTRAINT pedagogical_classification_audit_pkey PRIMARY KEY (id);


--
-- Name: pedagogical_classifications pedagogical_classifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedagogical_classifications
    ADD CONSTRAINT pedagogical_classifications_pkey PRIMARY KEY (id);


--
-- Name: pedagogical_decision_log pedagogical_decision_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedagogical_decision_log
    ADD CONSTRAINT pedagogical_decision_log_pkey PRIMARY KEY (id);


--
-- Name: pedagogical_interventions pedagogical_interventions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedagogical_interventions
    ADD CONSTRAINT pedagogical_interventions_pkey PRIMARY KEY (id);


--
-- Name: pedagogical_taxonomies pedagogical_taxonomies_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedagogical_taxonomies
    ADD CONSTRAINT pedagogical_taxonomies_code_unique UNIQUE (code);


--
-- Name: pedagogical_taxonomies pedagogical_taxonomies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedagogical_taxonomies
    ADD CONSTRAINT pedagogical_taxonomies_pkey PRIMARY KEY (id);


--
-- Name: question_bank question_bank_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_bank
    ADD CONSTRAINT question_bank_pkey PRIMARY KEY (id);


--
-- Name: imported_question_classifications uq_classification; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imported_question_classifications
    ADD CONSTRAINT uq_classification UNIQUE (question_id, source);


--
-- Name: imported_questions uq_question; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imported_questions
    ADD CONSTRAINT uq_question UNIQUE (source, year, question_index, language);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_google_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_google_id_unique UNIQUE (google_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: activity_classroom_results_exam_imported_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activity_classroom_results_exam_imported_idx ON public.activity_classroom_results USING btree (exam_id, imported_at);


--
-- Name: activity_classroom_results_exam_student_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX activity_classroom_results_exam_student_unique ON public.activity_classroom_results USING btree (exam_id, classroom_student_id);


--
-- Name: activity_classroom_syncs_coursework_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX activity_classroom_syncs_coursework_unique ON public.activity_classroom_syncs USING btree (course_id, coursework_id);


--
-- Name: activity_classroom_syncs_exam_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX activity_classroom_syncs_exam_unique ON public.activity_classroom_syncs USING btree (exam_id);


--
-- Name: adapted_exams_exam_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX adapted_exams_exam_idx ON public.adapted_exams USING btree (exam_id);


--
-- Name: administrative_audit_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX administrative_audit_created_at_idx ON public.administrative_audit USING btree (created_at);


--
-- Name: administrative_audit_target_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX administrative_audit_target_user_idx ON public.administrative_audit USING btree (target_user_id);


--
-- Name: ai_budget_resets_purpose_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_budget_resets_purpose_created_at_idx ON public.ai_budget_resets USING btree (purpose, created_at);


--
-- Name: ai_model_profiles_purpose_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_model_profiles_purpose_enabled_idx ON public.ai_model_profiles USING btree (purpose, enabled);


--
-- Name: ai_operations_operation_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_operations_operation_created_at_idx ON public.ai_operations USING btree (operation, created_at);


--
-- Name: ai_operations_status_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_operations_status_created_at_idx ON public.ai_operations USING btree (status, created_at);


--
-- Name: curriculum_plan_assignments_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX curriculum_plan_assignments_user_idx ON public.curriculum_plan_assignments USING btree (user_id);


--
-- Name: curriculum_plan_assignments_user_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX curriculum_plan_assignments_user_unique ON public.curriculum_plan_assignments USING btree (plan_id, user_id);


--
-- Name: curriculum_plan_skills_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX curriculum_plan_skills_code_idx ON public.curriculum_plan_skills USING btree (code);


--
-- Name: curriculum_plan_skills_code_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX curriculum_plan_skills_code_unique ON public.curriculum_plan_skills USING btree (unit_id, code);


--
-- Name: curriculum_plan_status_history_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX curriculum_plan_status_history_version_idx ON public.curriculum_plan_status_history USING btree (version_id, created_at);


--
-- Name: curriculum_plan_units_position_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX curriculum_plan_units_position_unique ON public.curriculum_plan_units USING btree (version_id, "position");


--
-- Name: curriculum_plan_versions_number_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX curriculum_plan_versions_number_unique ON public.curriculum_plan_versions USING btree (plan_id, version_number);


--
-- Name: curriculum_plan_versions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX curriculum_plan_versions_status_idx ON public.curriculum_plan_versions USING btree (status, updated_at);


--
-- Name: curriculum_plans_scope_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX curriculum_plans_scope_unique ON public.curriculum_plans USING btree (academic_year, segment, grade_year, subject, bimester);


--
-- Name: curriculum_plans_year_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX curriculum_plans_year_idx ON public.curriculum_plans USING btree (academic_year, bimester);


--
-- Name: enem_sae_imports_academic_year_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX enem_sae_imports_academic_year_idx ON public.enem_sae_imports USING btree (academic_year);


--
-- Name: enem_sae_imports_imported_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX enem_sae_imports_imported_by_idx ON public.enem_sae_imports USING btree (imported_by);


--
-- Name: exam_corrections_exam_attendance_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX exam_corrections_exam_attendance_idx ON public.exam_corrections USING btree (exam_id, attendance_status);


--
-- Name: exam_scan_audit_events_exam_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX exam_scan_audit_events_exam_created_at_idx ON public.exam_scan_audit_events USING btree (exam_id, created_at);


--
-- Name: exam_scan_audit_events_upload_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX exam_scan_audit_events_upload_created_at_idx ON public.exam_scan_audit_events USING btree (upload_id, created_at);


--
-- Name: exam_scan_pages_assignment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX exam_scan_pages_assignment_idx ON public.exam_scan_pages USING btree (sheet_assignment_id);


--
-- Name: exam_scan_pages_canonical_drive_file_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX exam_scan_pages_canonical_drive_file_unique ON public.exam_scan_pages USING btree (canonical_drive_file_id);


--
-- Name: exam_scan_pages_detected_assignment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX exam_scan_pages_detected_assignment_idx ON public.exam_scan_pages USING btree (detected_sheet_assignment_id);


--
-- Name: exam_scan_pages_upload_page_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX exam_scan_pages_upload_page_unique ON public.exam_scan_pages USING btree (upload_id, page_index);


--
-- Name: exam_scan_pages_upload_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX exam_scan_pages_upload_status_idx ON public.exam_scan_pages USING btree (upload_id, status);


--
-- Name: exam_scan_processing_attempts_upload_attempt_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX exam_scan_processing_attempts_upload_attempt_unique ON public.exam_scan_processing_attempts USING btree (upload_id, attempt_number);


--
-- Name: exam_scan_processing_attempts_upload_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX exam_scan_processing_attempts_upload_status_idx ON public.exam_scan_processing_attempts USING btree (upload_id, status);


--
-- Name: exam_scan_readings_crop_drive_file_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX exam_scan_readings_crop_drive_file_unique ON public.exam_scan_readings USING btree (crop_drive_file_id);


--
-- Name: exam_scan_readings_page_question_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX exam_scan_readings_page_question_unique ON public.exam_scan_readings USING btree (page_id, question_number);


--
-- Name: exam_scan_readings_page_review_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX exam_scan_readings_page_review_idx ON public.exam_scan_readings USING btree (page_id, review_status);


--
-- Name: exam_scan_readings_reviewed_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX exam_scan_readings_reviewed_by_idx ON public.exam_scan_readings USING btree (reviewed_by, reviewed_at);


--
-- Name: exam_scan_uploads_drive_file_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX exam_scan_uploads_drive_file_unique ON public.exam_scan_uploads USING btree (drive_file_id);


--
-- Name: exam_scan_uploads_exam_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX exam_scan_uploads_exam_status_idx ON public.exam_scan_uploads USING btree (exam_id, status);


--
-- Name: exam_scan_uploads_sha256_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX exam_scan_uploads_sha256_idx ON public.exam_scan_uploads USING btree (sha256);


--
-- Name: exam_sheet_assignments_active_student_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX exam_sheet_assignments_active_student_unique ON public.exam_sheet_assignments USING btree (exam_id, classroom_student_id) WHERE (status = ANY (ARRAY['pronta'::text, 'emitida'::text]));


--
-- Name: exam_sheet_assignments_correction_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX exam_sheet_assignments_correction_idx ON public.exam_sheet_assignments USING btree (exam_correction_id);


--
-- Name: exam_sheet_assignments_exam_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX exam_sheet_assignments_exam_status_idx ON public.exam_sheet_assignments USING btree (exam_id, status);


--
-- Name: exam_sheet_assignments_public_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX exam_sheet_assignments_public_id_unique ON public.exam_sheet_assignments USING btree (public_id);


--
-- Name: exam_sheet_assignments_token_digest_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX exam_sheet_assignments_token_digest_unique ON public.exam_sheet_assignments USING btree (token_digest);


--
-- Name: exam_user_archives_user_archived_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX exam_user_archives_user_archived_at_idx ON public.exam_user_archives USING btree (user_id, archived_at);


--
-- Name: exam_user_archives_user_exam_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX exam_user_archives_user_exam_unique ON public.exam_user_archives USING btree (user_id, exam_id);


--
-- Name: generated_exams_archived_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generated_exams_archived_at_idx ON public.generated_exams USING btree (archived_at);


--
-- Name: generation_job_items_job_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generation_job_items_job_status_idx ON public.generation_job_items USING btree (job_id, status);


--
-- Name: generation_jobs_available_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generation_jobs_available_at_idx ON public.generation_jobs USING btree (status, available_at, priority, id) WHERE (status = 'pendente'::text);


--
-- Name: generation_jobs_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generation_jobs_batch_idx ON public.generation_jobs USING btree (batch_id);


--
-- Name: generation_jobs_one_active_question_addition_per_exam_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX generation_jobs_one_active_question_addition_per_exam_idx ON public.generation_jobs USING btree (((payload ->> 'examId'::text))) WHERE ((job_type = 'adicionar_questao'::text) AND (status = ANY (ARRAY['pendente'::text, 'gerando'::text])));


--
-- Name: generation_jobs_poll_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generation_jobs_poll_idx ON public.generation_jobs USING btree (status, priority, id) WHERE (status = 'pendente'::text);


--
-- Name: generation_jobs_requester_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generation_jobs_requester_idx ON public.generation_jobs USING btree (requested_by, created_at DESC);


--
-- Name: generation_jobs_scan_transcription_active_page_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX generation_jobs_scan_transcription_active_page_unique ON public.generation_jobs USING btree (((payload ->> 'examId'::text)), ((payload ->> 'pageId'::text))) WHERE ((job_type = 'transcrever_scan'::text) AND (status = ANY (ARRAY['pendente'::text, 'gerando'::text])));


--
-- Name: generation_jobs_scan_transcription_page_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generation_jobs_scan_transcription_page_status_idx ON public.generation_jobs USING btree (((payload ->> 'pageId'::text)), status, id) WHERE (job_type = 'transcrever_scan'::text);


--
-- Name: google_chat_installations_active_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX google_chat_installations_active_user_idx ON public.google_chat_installations USING btree (user_id, active);


--
-- Name: google_chat_installations_user_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX google_chat_installations_user_id_unique ON public.google_chat_installations USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: idx_classifications_bloom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_classifications_bloom ON public.imported_question_classifications USING btree (bloom_level);


--
-- Name: idx_classifications_enem_area; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_classifications_enem_area ON public.imported_question_classifications USING btree (enem_area_id);


--
-- Name: idx_classifications_enem_skill; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_classifications_enem_skill ON public.imported_question_classifications USING btree (enem_skill_id);


--
-- Name: idx_classifications_question; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_classifications_question ON public.imported_question_classifications USING btree (question_id);


--
-- Name: idx_pedagogical_audit_classification; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pedagogical_audit_classification ON public.pedagogical_classification_audit USING btree (classification_id);


--
-- Name: idx_pedagogical_classifications_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pedagogical_classifications_lookup ON public.pedagogical_classifications USING btree (classifiable_type, classifiable_id, classifiable_sub_id, taxonomy_id, is_current);


--
-- Name: idx_questions_discipline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_questions_discipline ON public.imported_questions USING btree (discipline);


--
-- Name: idx_questions_language; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_questions_language ON public.imported_questions USING btree (language);


--
-- Name: idx_questions_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_questions_year ON public.imported_questions USING btree (year);


--
-- Name: jev_decisions_cache_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jev_decisions_cache_idx ON public.jev_decisions USING btree (cache_key, status, cache_expires_at);


--
-- Name: jev_decisions_operation_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jev_decisions_operation_created_at_idx ON public.jev_decisions USING btree (operation, created_at);


--
-- Name: jev_decisions_route_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jev_decisions_route_created_at_idx ON public.jev_decisions USING btree (route, created_at);


--
-- Name: pedagogical_categories_taxonomy_code_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pedagogical_categories_taxonomy_code_unique ON public.pedagogical_categories USING btree (taxonomy_id, code);


--
-- Name: pedagogical_decision_log_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pedagogical_decision_log_created_idx ON public.pedagogical_decision_log USING btree (created_at);


--
-- Name: pedagogical_decision_log_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pedagogical_decision_log_entity_idx ON public.pedagogical_decision_log USING btree (entity_type, entity_id, created_at);


--
-- Name: pedagogical_decision_log_plan_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pedagogical_decision_log_plan_idx ON public.pedagogical_decision_log USING btree (plan_id, created_at);


--
-- Name: pedagogical_interventions_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pedagogical_interventions_scope_idx ON public.pedagogical_interventions USING btree (academic_year, segment, grade_year, subject);


--
-- Name: pedagogical_interventions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pedagogical_interventions_status_idx ON public.pedagogical_interventions USING btree (status, due_date);


--
-- Name: uq_pedagogical_current_classification; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pedagogical_current_classification ON public.pedagogical_classifications USING btree (classifiable_type, classifiable_id, classifiable_sub_id, taxonomy_id) NULLS NOT DISTINCT WHERE (is_current = true);


--
-- Name: exam_scan_pages exam_scan_pages_assignment_exam_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER exam_scan_pages_assignment_exam_guard AFTER INSERT OR UPDATE OF upload_id, sheet_assignment_id ON public.exam_scan_pages DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_exam_scan_page_assignment_exam();


--
-- Name: activity_classroom_results activity_classroom_results_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_classroom_results
    ADD CONSTRAINT activity_classroom_results_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.generated_exams(id) ON DELETE CASCADE;


--
-- Name: activity_classroom_syncs activity_classroom_syncs_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_classroom_syncs
    ADD CONSTRAINT activity_classroom_syncs_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.generated_exams(id) ON DELETE CASCADE;


--
-- Name: adapted_exams adapted_exams_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adapted_exams
    ADD CONSTRAINT adapted_exams_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: adapted_exams adapted_exams_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adapted_exams
    ADD CONSTRAINT adapted_exams_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: adapted_exams adapted_exams_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adapted_exams
    ADD CONSTRAINT adapted_exams_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.generated_exams(id);


--
-- Name: administrative_audit administrative_audit_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.administrative_audit
    ADD CONSTRAINT administrative_audit_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: administrative_audit administrative_audit_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.administrative_audit
    ADD CONSTRAINT administrative_audit_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ai_budget_controls ai_budget_controls_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_budget_controls
    ADD CONSTRAINT ai_budget_controls_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: ai_budget_resets ai_budget_resets_reset_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_budget_resets
    ADD CONSTRAINT ai_budget_resets_reset_by_fkey FOREIGN KEY (reset_by) REFERENCES public.users(id);


--
-- Name: application_settings application_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_settings
    ADD CONSTRAINT application_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: curriculum_plan_assignments curriculum_plan_assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plan_assignments
    ADD CONSTRAINT curriculum_plan_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: curriculum_plan_assignments curriculum_plan_assignments_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plan_assignments
    ADD CONSTRAINT curriculum_plan_assignments_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.curriculum_plans(id) ON DELETE CASCADE;


--
-- Name: curriculum_plan_assignments curriculum_plan_assignments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plan_assignments
    ADD CONSTRAINT curriculum_plan_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: curriculum_plan_skills curriculum_plan_skills_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plan_skills
    ADD CONSTRAINT curriculum_plan_skills_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.curriculum_plan_units(id) ON DELETE CASCADE;


--
-- Name: curriculum_plan_status_history curriculum_plan_status_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plan_status_history
    ADD CONSTRAINT curriculum_plan_status_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id);


--
-- Name: curriculum_plan_status_history curriculum_plan_status_history_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plan_status_history
    ADD CONSTRAINT curriculum_plan_status_history_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.curriculum_plan_versions(id) ON DELETE CASCADE;


--
-- Name: curriculum_plan_units curriculum_plan_units_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plan_units
    ADD CONSTRAINT curriculum_plan_units_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.curriculum_plan_versions(id) ON DELETE CASCADE;


--
-- Name: curriculum_plan_versions curriculum_plan_versions_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plan_versions
    ADD CONSTRAINT curriculum_plan_versions_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: curriculum_plan_versions curriculum_plan_versions_copied_from_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plan_versions
    ADD CONSTRAINT curriculum_plan_versions_copied_from_version_id_fkey FOREIGN KEY (copied_from_version_id) REFERENCES public.curriculum_plan_versions(id);


--
-- Name: curriculum_plan_versions curriculum_plan_versions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plan_versions
    ADD CONSTRAINT curriculum_plan_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: curriculum_plan_versions curriculum_plan_versions_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plan_versions
    ADD CONSTRAINT curriculum_plan_versions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.curriculum_plans(id) ON DELETE CASCADE;


--
-- Name: curriculum_plan_versions curriculum_plan_versions_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plan_versions
    ADD CONSTRAINT curriculum_plan_versions_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: curriculum_plans curriculum_plans_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plans
    ADD CONSTRAINT curriculum_plans_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: curriculum_tab_overrides curriculum_tab_overrides_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_tab_overrides
    ADD CONSTRAINT curriculum_tab_overrides_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: enem_competencies enem_competencies_area_id_enem_areas_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enem_competencies
    ADD CONSTRAINT enem_competencies_area_id_enem_areas_id_fk FOREIGN KEY (area_id) REFERENCES public.enem_areas(id);


--
-- Name: enem_sae_imports enem_sae_imports_imported_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enem_sae_imports
    ADD CONSTRAINT enem_sae_imports_imported_by_users_id_fk FOREIGN KEY (imported_by) REFERENCES public.users(id);


--
-- Name: enem_skills enem_skills_competency_id_enem_competencies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enem_skills
    ADD CONSTRAINT enem_skills_competency_id_enem_competencies_id_fk FOREIGN KEY (competency_id) REFERENCES public.enem_competencies(id);


--
-- Name: exam_corrections exam_corrections_absence_marked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_corrections
    ADD CONSTRAINT exam_corrections_absence_marked_by_fkey FOREIGN KEY (absence_marked_by) REFERENCES public.users(id);


--
-- Name: exam_corrections exam_corrections_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_corrections
    ADD CONSTRAINT exam_corrections_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: exam_corrections exam_corrections_exam_id_generated_exams_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_corrections
    ADD CONSTRAINT exam_corrections_exam_id_generated_exams_id_fk FOREIGN KEY (exam_id) REFERENCES public.generated_exams(id);


--
-- Name: exam_scan_audit_events exam_scan_audit_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_scan_audit_events
    ADD CONSTRAINT exam_scan_audit_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: exam_scan_audit_events exam_scan_audit_events_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_scan_audit_events
    ADD CONSTRAINT exam_scan_audit_events_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.generated_exams(id);


--
-- Name: exam_scan_audit_events exam_scan_audit_events_upload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_scan_audit_events
    ADD CONSTRAINT exam_scan_audit_events_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES public.exam_scan_uploads(id);


--
-- Name: exam_scan_pages exam_scan_pages_detected_sheet_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_scan_pages
    ADD CONSTRAINT exam_scan_pages_detected_sheet_assignment_id_fkey FOREIGN KEY (detected_sheet_assignment_id) REFERENCES public.exam_sheet_assignments(id);


--
-- Name: exam_scan_pages exam_scan_pages_sheet_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_scan_pages
    ADD CONSTRAINT exam_scan_pages_sheet_assignment_id_fkey FOREIGN KEY (sheet_assignment_id) REFERENCES public.exam_sheet_assignments(id);


--
-- Name: exam_scan_pages exam_scan_pages_upload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_scan_pages
    ADD CONSTRAINT exam_scan_pages_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES public.exam_scan_uploads(id);


--
-- Name: exam_scan_processing_attempts exam_scan_processing_attempts_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_scan_processing_attempts
    ADD CONSTRAINT exam_scan_processing_attempts_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id);


--
-- Name: exam_scan_processing_attempts exam_scan_processing_attempts_upload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_scan_processing_attempts
    ADD CONSTRAINT exam_scan_processing_attempts_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES public.exam_scan_uploads(id);


--
-- Name: exam_scan_readings exam_scan_readings_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_scan_readings
    ADD CONSTRAINT exam_scan_readings_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.exam_scan_pages(id);


--
-- Name: exam_scan_readings exam_scan_readings_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_scan_readings
    ADD CONSTRAINT exam_scan_readings_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: exam_scan_uploads exam_scan_uploads_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_scan_uploads
    ADD CONSTRAINT exam_scan_uploads_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: exam_scan_uploads exam_scan_uploads_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_scan_uploads
    ADD CONSTRAINT exam_scan_uploads_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.generated_exams(id);


--
-- Name: exam_sheet_assignments exam_sheet_assignments_emitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_sheet_assignments
    ADD CONSTRAINT exam_sheet_assignments_emitted_by_fkey FOREIGN KEY (emitted_by) REFERENCES public.users(id);


--
-- Name: exam_sheet_assignments exam_sheet_assignments_exam_correction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_sheet_assignments
    ADD CONSTRAINT exam_sheet_assignments_exam_correction_id_fkey FOREIGN KEY (exam_correction_id) REFERENCES public.exam_corrections(id);


--
-- Name: exam_sheet_assignments exam_sheet_assignments_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_sheet_assignments
    ADD CONSTRAINT exam_sheet_assignments_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.generated_exams(id);


--
-- Name: exam_sheet_assignments exam_sheet_assignments_issued_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_sheet_assignments
    ADD CONSTRAINT exam_sheet_assignments_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES public.users(id);


--
-- Name: exam_sheet_assignments exam_sheet_assignments_reprint_of_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_sheet_assignments
    ADD CONSTRAINT exam_sheet_assignments_reprint_of_id_fkey FOREIGN KEY (reprint_of_id) REFERENCES public.exam_sheet_assignments(id);


--
-- Name: exam_sheet_assignments exam_sheet_assignments_voided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_sheet_assignments
    ADD CONSTRAINT exam_sheet_assignments_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES public.users(id);


--
-- Name: exam_user_archives exam_user_archives_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_user_archives
    ADD CONSTRAINT exam_user_archives_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.generated_exams(id) ON DELETE CASCADE;


--
-- Name: exam_user_archives exam_user_archives_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_user_archives
    ADD CONSTRAINT exam_user_archives_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: generated_exams generated_exams_assigned_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_exams
    ADD CONSTRAINT generated_exams_assigned_by_users_id_fk FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: generated_exams generated_exams_assigned_to_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_exams
    ADD CONSTRAINT generated_exams_assigned_to_users_id_fk FOREIGN KEY (assigned_to) REFERENCES public.users(id);


--
-- Name: generated_exams generated_exams_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_exams
    ADD CONSTRAINT generated_exams_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: generation_batches generation_batches_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_batches
    ADD CONSTRAINT generation_batches_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id);


--
-- Name: generation_job_items generation_job_items_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_job_items
    ADD CONSTRAINT generation_job_items_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.generation_jobs(id) ON DELETE CASCADE;


--
-- Name: generation_jobs generation_jobs_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_jobs
    ADD CONSTRAINT generation_jobs_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.generation_batches(id);


--
-- Name: generation_jobs generation_jobs_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_jobs
    ADD CONSTRAINT generation_jobs_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id);


--
-- Name: generation_jobs generation_jobs_result_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_jobs
    ADD CONSTRAINT generation_jobs_result_exam_id_fkey FOREIGN KEY (result_exam_id) REFERENCES public.generated_exams(id);


--
-- Name: google_chat_installations google_chat_installations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_chat_installations
    ADD CONSTRAINT google_chat_installations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: imported_question_classifications imported_question_classifications_classified_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imported_question_classifications
    ADD CONSTRAINT imported_question_classifications_classified_by_users_id_fk FOREIGN KEY (classified_by) REFERENCES public.users(id);


--
-- Name: imported_question_classifications imported_question_classifications_enem_area_id_enem_areas_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imported_question_classifications
    ADD CONSTRAINT imported_question_classifications_enem_area_id_enem_areas_id_fk FOREIGN KEY (enem_area_id) REFERENCES public.enem_areas(id);


--
-- Name: imported_question_classifications imported_question_classifications_enem_cognitive_axis_id_enem_c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imported_question_classifications
    ADD CONSTRAINT imported_question_classifications_enem_cognitive_axis_id_enem_c FOREIGN KEY (enem_cognitive_axis_id) REFERENCES public.enem_cognitive_axes(id);


--
-- Name: imported_question_classifications imported_question_classifications_enem_competency_id_enem_compe; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imported_question_classifications
    ADD CONSTRAINT imported_question_classifications_enem_competency_id_enem_compe FOREIGN KEY (enem_competency_id) REFERENCES public.enem_competencies(id);


--
-- Name: imported_question_classifications imported_question_classifications_enem_skill_id_enem_skills_id_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imported_question_classifications
    ADD CONSTRAINT imported_question_classifications_enem_skill_id_enem_skills_id_ FOREIGN KEY (enem_skill_id) REFERENCES public.enem_skills(id);


--
-- Name: pedagogical_categories pedagogical_categories_taxonomy_id_pedagogical_taxonomies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedagogical_categories
    ADD CONSTRAINT pedagogical_categories_taxonomy_id_pedagogical_taxonomies_id_fk FOREIGN KEY (taxonomy_id) REFERENCES public.pedagogical_taxonomies(id);


--
-- Name: pedagogical_classification_audit pedagogical_classification_audit_classification_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedagogical_classification_audit
    ADD CONSTRAINT pedagogical_classification_audit_classification_id_fk FOREIGN KEY (classification_id) REFERENCES public.pedagogical_classifications(id);


--
-- Name: pedagogical_classification_audit pedagogical_classification_audit_performed_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedagogical_classification_audit
    ADD CONSTRAINT pedagogical_classification_audit_performed_by_fk FOREIGN KEY (performed_by) REFERENCES public.users(id);


--
-- Name: pedagogical_classifications pedagogical_classifications_approved_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedagogical_classifications
    ADD CONSTRAINT pedagogical_classifications_approved_by_fk FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: pedagogical_classifications pedagogical_classifications_category_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedagogical_classifications
    ADD CONSTRAINT pedagogical_classifications_category_id_fk FOREIGN KEY (category_id) REFERENCES public.pedagogical_categories(id);


--
-- Name: pedagogical_classifications pedagogical_classifications_created_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedagogical_classifications
    ADD CONSTRAINT pedagogical_classifications_created_by_fk FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: pedagogical_classifications pedagogical_classifications_supersedes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedagogical_classifications
    ADD CONSTRAINT pedagogical_classifications_supersedes_id_fk FOREIGN KEY (supersedes_id) REFERENCES public.pedagogical_classifications(id);


--
-- Name: pedagogical_classifications pedagogical_classifications_taxonomy_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedagogical_classifications
    ADD CONSTRAINT pedagogical_classifications_taxonomy_id_fk FOREIGN KEY (taxonomy_id) REFERENCES public.pedagogical_taxonomies(id);


--
-- Name: pedagogical_decision_log pedagogical_decision_log_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedagogical_decision_log
    ADD CONSTRAINT pedagogical_decision_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: pedagogical_decision_log pedagogical_decision_log_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedagogical_decision_log
    ADD CONSTRAINT pedagogical_decision_log_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.curriculum_plans(id) ON DELETE SET NULL;


--
-- Name: pedagogical_interventions pedagogical_interventions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedagogical_interventions
    ADD CONSTRAINT pedagogical_interventions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--
