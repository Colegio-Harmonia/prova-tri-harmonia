CREATE UNIQUE INDEX IF NOT EXISTS "uq_classification" ON "imported_question_classifications" ("question_id", "source");
