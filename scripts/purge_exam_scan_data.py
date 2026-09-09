#!/usr/bin/env python3
"""Remove dados de scan associados a uma prova no banco.

Uso:
    python3 scripts/purge_exam_scan_data.py ID_DA_PROVA
    python3 scripts/purge_exam_scan_data.py ID_DA_PROVA --dry-run
    python3 scripts/purge_exam_scan_data.py ID_DA_PROVA --reset-corrections

O script nao acessa nem remove arquivos no Google Drive.

Por padrão, vínculos de folha e correções são preservados. Use
--reset-corrections para zerar as respostas e avaliações, sem apagar os
vínculos/QRs já emitidos.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

import psycopg2
from psycopg2.extras import Json


ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env.local"


def load_local_env() -> None:
    """Carrega .env.local sem sobrescrever variaveis recebidas do ambiente."""
    if not ENV_FILE.exists():
        return
    for raw_line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'") )


def database_url() -> str:
    value = os.environ.get("DATABASE_URL")
    if not value:
        raise RuntimeError("DATABASE_URL nao foi configurada.")
    return value


def count_rows(connection: Any, exam_id: int) -> dict[str, int]:
    query = """
        SELECT 'uploads' AS name, count(*)::int FROM exam_scan_uploads WHERE exam_id = %s
        UNION ALL
        SELECT 'paginas', count(*)::int
          FROM exam_scan_pages p JOIN exam_scan_uploads u ON u.id = p.upload_id
         WHERE u.exam_id = %s
        UNION ALL
        SELECT 'leituras', count(*)::int
          FROM exam_scan_readings r
          JOIN exam_scan_pages p ON p.id = r.page_id
          JOIN exam_scan_uploads u ON u.id = p.upload_id
         WHERE u.exam_id = %s
        UNION ALL
        SELECT 'tentativas', count(*)::int
          FROM exam_scan_processing_attempts a JOIN exam_scan_uploads u ON u.id = a.upload_id
         WHERE u.exam_id = %s
        UNION ALL
        SELECT 'auditoria', count(*)::int FROM exam_scan_audit_events WHERE exam_id = %s
    """
    with connection.cursor() as cursor:
        cursor.execute(query, (exam_id,) * 5)
        return dict(cursor.fetchall())


def count_corrections(connection: Any, exam_id: int) -> int:
    with connection.cursor() as cursor:
        cursor.execute("SELECT count(*) FROM exam_corrections WHERE exam_id = %s", (exam_id,))
        return int(cursor.fetchone()[0])


def delete_database_data(connection: Any, exam_id: int) -> dict[str, int]:
    statements = {
        "leituras": """
            DELETE FROM exam_scan_readings r
            USING exam_scan_pages p, exam_scan_uploads u
            WHERE r.page_id = p.id AND p.upload_id = u.id AND u.exam_id = %s
        """,
        "auditoria": "DELETE FROM exam_scan_audit_events WHERE exam_id = %s",
        "tentativas": """
            DELETE FROM exam_scan_processing_attempts a
            USING exam_scan_uploads u
            WHERE a.upload_id = u.id AND u.exam_id = %s
        """,
        "paginas": """
            DELETE FROM exam_scan_pages p
            USING exam_scan_uploads u
            WHERE p.upload_id = u.id AND u.exam_id = %s
        """,
        "uploads": "DELETE FROM exam_scan_uploads WHERE exam_id = %s",
    }
    deleted: dict[str, int] = {}
    with connection.cursor() as cursor:
        for name, statement in statements.items():
            cursor.execute(statement, (exam_id,))
            deleted[name] = cursor.rowcount
    return deleted


def empty_answers(connection: Any, exam_id: int) -> list[dict[str, Any]]:
    """Recria a estrutura vazia usada pela aplicação para cada questão."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT generation_payload FROM generated_exams WHERE id = %s", (exam_id,))
        row = cursor.fetchone()
    if not row:
        raise RuntimeError(f"Prova {exam_id} não encontrada.")

    payload = row[0]
    questions = payload.get("questions", []) if isinstance(payload, dict) else []
    if not isinstance(questions, list):
        raise RuntimeError("O payload da prova não possui uma lista válida de questões.")

    return [{
        "questionNumber": question.get("number"),
        "type": question.get("type"),
        "transcribedAnswer": "",
        "correctLetter": question.get("correctLetter") if question.get("type") == "objetiva" else None,
        "isCorrect": None,
        "aiSuggestedGrade": None,
        "aiSuggestedFeedback": None,
        "finalGrade": None,
        "finalFeedback": None,
    } for question in questions]


def reset_corrections(connection: Any, exam_id: int) -> int:
    """Limpa avaliações sem remover correções ou atribuições de folha."""
    answers = empty_answers(connection, exam_id)
    with connection.cursor() as cursor:
        cursor.execute("""
            UPDATE exam_corrections
               SET answers = %s,
                   status = 'pendente',
                   score_result = NULL,
                   grade_returned_at = NULL,
                   updated_at = now()
             WHERE exam_id = %s
        """, (Json(answers), exam_id))
        return cursor.rowcount


def main() -> int:
    parser = argparse.ArgumentParser(description="Remove somente scans de uma prova no banco.")
    parser.add_argument("exam_id", type=int, help="ID da prova")
    parser.add_argument("--dry-run", action="store_true", help="Exibe o que seria removido, sem alterar dados")
    parser.add_argument("--reset-corrections", action="store_true", help="Zera respostas, notas e status das correções, preservando os vínculos de folha")
    args = parser.parse_args()
    if args.exam_id < 1:
        parser.error("ID da prova deve ser positivo.")

    load_local_env()
    try:
        with psycopg2.connect(database_url()) as connection:
            counts = count_rows(connection, args.exam_id)
            print(f"Prova {args.exam_id}: " + ", ".join(f"{name}={total}" for name, total in counts.items()))
            if args.reset_corrections:
                print(f"Correções a resetar={count_corrections(connection, args.exam_id)}")
            if args.dry_run:
                print("Dry run: nenhum dado foi alterado.")
                return 0

            deleted = delete_database_data(connection, args.exam_id)
            if args.reset_corrections:
                deleted["correções resetadas"] = reset_corrections(connection, args.exam_id)
    except Exception as error:
        print(f"Falha: {error}", file=sys.stderr)
        return 1

    print("Concluido: " + ", ".join(f"{name}={total}" for name, total in deleted.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
