#!/usr/bin/env python3
"""Extrai questões textuais dos cadernos oficiais do ENEM.

Este auxiliar é chamado por ``import-enem-official-pdfs.ts``. Ele não grava no
banco: devolve JSON para o importador TypeScript, que aplica as regras de
unicidade e a transação de banco. Questões que dependem de imagem, gráfico,
mapa ou tira ficam de fora deliberadamente; elas não podem entrar no banco sem
um arquivo visual individual e verificável.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any

import pdfplumber

QUESTION_RE = re.compile(r"^QUEST[ÃA]O\s+(\d{1,3})\s*$", re.MULTILINE | re.IGNORECASE)
NEXT_QUESTION_RE = re.compile(r"^QUEST[ÃA]O\s+\d{1,3}\s*$", re.IGNORECASE)
ALT_RE = re.compile(r"^([A-E])\s+(.+)$", re.MULTILINE)
ANSWER_RE = re.compile(r"(\d{1,3})\s+(Anulado|[A-E])\b")

# Marcas gráficas que o PDF do caderno repete no rodapé. O pdfminer pode
# devolvê-las como texto, inclusive na mesma região física da última
# alternativa da coluna. Elas nunca fazem parte de um item ENEM.
REPEATED_ENEM_FOOTER_RE = re.compile(r"(?:\d{0,4}ENEM\d{4}){2,}", re.IGNORECASE)
PAGE_HEADER_RE = re.compile(
    r"(?:[•·]\s*)?(?:LINGUAGENS(?:,\s*C[ÓO]DIGOS\s+E\s+SUAS\s+TECNOLOGIAS(?:\s+E\s+REDA[ÇC][ÃA]O)?)?|"
    r"CI[ÊE]NCIAS\s+HUMANAS\s+E\s+SUAS\s+TECNOLOGIAS|"
    r"CI[ÊE]NCIAS\s+DA\s+NATUREZA\s+E\s+SUAS\s+TECNOLOGIAS|"
    r"MATEM[ÁA]TICA\s+E\s+SUAS\s+TECNOLOGIAS)\b.*$",
    re.IGNORECASE,
)
LAYOUT_ARTIFACT_RE = re.compile(r"(?:\*?\d{6,}[A-Z_]+(?:\.[A-Z_]+)*\*?|(?:\d{2}[/\\]){2}\d{4}\s+\d{2}:\d{2}:\d{2})", re.IGNORECASE)
SHARED_TEXT_RE = re.compile(r"Texto\s+para\s+as\s+Quest[õo]es\s+de\s+(\d{1,3})\s+a\s+(\d{1,3})\.?\s*", re.IGNORECASE)
LINE_NUMBER_RE = re.compile(r"^\s*\d+\s+")


def discipline(question_index: int) -> str:
    if question_index <= 45:
        return "linguagens"
    if question_index <= 90:
        return "ciencias-humanas"
    if question_index <= 135:
        return "ciencias-natureza"
    return "matematica"


def clean_text(text: str) -> str:
    lines: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        # Rodapés dos cadernos podem ser extraídos como uma única sequência
        # enorme (por exemplo, ``ENEM2025ENEM2025...``) ou com o ano antes de
        # cada ocorrência. Eles não fazem parte da questão e, se mantidos,
        # acabam no texto da alternativa E.
        # Em vez de descartar a linha inteira, preserva a alternativa quando
        # o rodapé aparece colado ao seu fim (caso comum da alternativa E).
        line = REPEATED_ENEM_FOOTER_RE.split(line, maxsplit=1)[0].strip()
        line = PAGE_HEADER_RE.split(line, maxsplit=1)[0].strip()
        line = LAYOUT_ARTIFACT_RE.split(line, maxsplit=1)[0].strip()
        if not line:
            continue
        # O último bloco de uma coluna às vezes alcança apenas o cabeçalho da
        # próxima questão. Tudo depois dele pertence a outro item.
        if NEXT_QUESTION_RE.fullmatch(line):
            # O recorte começa no cabeçalho da questão atual; só um cabeçalho
            # posterior representa vazamento para o próximo item.
            if lines:
                break
            continue
        if re.fullmatch(r"(?:\d{4}MENE)+", line):
            continue
        if re.fullmatch(r"[0-9A-Z*.]+", line) and ("AZ" in line or "MENE" in line):
            continue
        if re.match(r"^\d+\s+(?:LINGUAGENS|CIÊNCIAS|MATEMÁTICA)", line):
            continue
        if re.match(r"^\d{6,}[A-Z.]+$", line):
            continue
        if "CADERNO" in line and ("|" in line or "•" in line):
            continue
        lines.append(line)
    return "\n".join(lines)


def contains_page_chrome(text: str) -> bool:
    """Indica resto de rodapé/cabeçalho que invalida a transcrição textual."""
    return bool(
        REPEATED_ENEM_FOOTER_RE.search(text)
        or PAGE_HEADER_RE.search(text)
        or LAYOUT_ARTIFACT_RE.search(text)
    )


def answer_key(path: Path) -> dict[int, str]:
    with pdfplumber.open(path) as pdf:
        text = "\n".join(page.extract_text() or "" for page in pdf.pages)
    return {
        int(number): answer
        for number, answer in ANSWER_RE.findall(text)
        if answer in {"A", "B", "C", "D", "E"}
    }


def question_positions(page: pdfplumber.page.Page) -> list[tuple[int, float, float]]:
    """Posição vertical do cabeçalho de cada questão no caderno em duas colunas."""
    words = page.extract_words(use_text_flow=True, keep_blank_chars=False)
    positions: list[tuple[int, float, float]] = []
    for index, word in enumerate(words[:-1]):
        normalized = unicodedata.normalize("NFD", word["text"]).encode("ascii", "ignore").decode().upper()
        if normalized != "QUESTAO":
            continue
        next_word = words[index + 1]
        if next_word["text"].isdigit() and abs(next_word["top"] - word["top"]) < 5:
            positions.append((int(next_word["text"]), word["x0"], word["top"]))
    return positions


def has_visual(page: pdfplumber.page.Page, left: float, right: float, top: float, bottom: float) -> bool:
    # O arquivo também tem uma estreita faixa de decoração na margem. Só
    # considera imagens reais de conteúdo dentro da área útil da página.
    for image in page.images:
        if image.get("imagemask") or image["width"] < 30 or image["height"] < 30:
            continue
        if image["x1"] < left or image["x0"] > right:
            continue
        if image["bottom"] >= top and image["top"] <= bottom:
            return True
    return False


def extract_shared_support_texts(path: Path) -> dict[int, str]:
    """Lê textos de apoio que antecedem um grupo de questões em outra página.

    Esses blocos não pertencem fisicamente a uma questão específica e, por
    isso, não aparecem nos recortes iniciados por QUESTÃO n. O cabeçalho
    oficial informa o intervalo de destino, então o mesmo texto é associado
    a cada item do grupo.
    """
    supports: dict[int, str] = {}
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            raw = page.crop((20, 80, page.width - 20, page.height - 40)).extract_text() or ""
            match = SHARED_TEXT_RE.search(raw)
            if not match:
                continue
            content = "\n".join(LINE_NUMBER_RE.sub("", line) for line in raw[match.end():].splitlines())
            content = clean_text(content)
            if len(content) < 80:
                continue
            start, end = int(match.group(1)), int(match.group(2))
            for number in range(start, end + 1):
                supports[number] = content
    return supports


def extract_booklet(path: Path) -> tuple[dict[int, str], dict[int, bool], dict[int, int]]:
    found: dict[int, str] = {}
    visual_by_question: dict[int, bool] = {}
    page_by_question: dict[int, int] = {}

    with pdfplumber.open(path) as pdf:
        for page_number, page in enumerate(pdf.pages[1:], start=2):
            positions = question_positions(page)
            midpoint = page.width / 2
            left_positions = [item for item in positions if item[1] < midpoint]
            right_positions = [item for item in positions if item[1] >= midpoint]

            # Alguns cadernos intercalam páginas em duas colunas com páginas
            # cujas questões ocupam a largura inteira. Na segunda forma, os
            # cabeçalhos continuam alinhados à esquerda, mas nenhum aparece
            # na coluna direita. Cortar essas páginas ao meio destrói o fim
            # das linhas, como em títulos, textos de apoio e alternativas.
            # Cada questão precisa ser lida no bloco horizontal completo.
            if left_positions and not right_positions:
                ordered = sorted(left_positions, key=lambda item: item[2])
                for idx, (number, _x0, top) in enumerate(ordered):
                    if number in page_by_question:
                        continue
                    bottom = ordered[idx + 1][2] if idx + 1 < len(ordered) else page.height - 35
                    region = page.crop((8, top, page.width - 8, bottom))
                    text = clean_text(region.extract_text() or "")
                    text = re.sub(r"^QUEST[ÃA]O\s+\d{1,3}\s*", "", text, flags=re.IGNORECASE)
                    if text:
                        found[number] = text.strip()
                    visual_by_question[number] = has_visual(page, 20, page.width - 20, top, bottom)
                    page_by_question[number] = page_number
                continue

            for left, right, in_column in [
                (0, midpoint, left_positions),
                (midpoint, page.width, right_positions),
            ]:
                ordered = sorted(in_column, key=lambda item: item[2])
                for idx, (number, _x0, top) in enumerate(ordered):
                    if number in page_by_question:
                        continue  # inglês vem antes do espanhol para as questões 1-5
                    bottom = ordered[idx + 1][2] if idx + 1 < len(ordered) else page.height - 35
                    # Extrair o bloco físico da questão é essencial: usar a
                    # coluna inteira e então cortar por ``QUESTÃO n`` fazia a
                    # alternativa E absorver rodapés e o início de outra
                    # questão quando o texto do PDF não preservava o cabeçalho.
                    # O texto de algumas questões começa quase exatamente
                    # na linha divisória ou termina no limite da coluna.
                    # A margem fixa de 8 pt cortava letras iniciais/finais
                    # (por exemplo, “verdadeiras” virava “erdadeiras”).
                    # Mantemos somente 1 pt para não absorver a coluna vizinha.
                    region = page.crop((left + 1, top, right - 1, bottom))
                    text = clean_text(region.extract_text() or "")
                    text = re.sub(r"^QUEST[ÃA]O\s+\d{1,3}\s*", "", text, flags=re.IGNORECASE)
                    if text:
                        found[number] = text.strip()
                    visual_by_question[number] = has_visual(page, left + 20, right - 20, top, bottom)
                    page_by_question[number] = page_number
    return found, visual_by_question, page_by_question


def to_question(year: int, number: int, text: str, answer: str, visual: bool, page: int, pdf_name: str, include_visual: bool = False) -> dict[str, Any] | None:
    if visual and not include_visual:
        return None
    candidates = list(ALT_RE.finditer(text))
    sequences = [
        candidates[start:start + 5]
        for start in range(len(candidates) - 4)
        if [match.group(1) for match in candidates[start:start + 5]] == ["A", "B", "C", "D", "E"]
    ]
    if not sequences:
        return None
    # A letra inicial de um enunciado ("A relação...", por exemplo) pode
    # parecer uma alternativa na extração textual. As opções reais são a
    # última sequência A-E completa do bloco.
    alternatives = sequences[-1]
    statement = text[:alternatives[0].start()].strip()
    if len(statement) < 20:
        return None
    extracted_alternatives = []
    for index, match in enumerate(alternatives):
        end = alternatives[index + 1].start() if index + 1 < len(alternatives) else len(text)
        alternative_text = text[match.start(2):end].strip()
        if index == len(alternatives) - 1:
            # Alguns PDFs deixam isolado só o número da questão seguinte no
            # rodapé da última coluna. Opções numéricas reais têm pontuação ou
            # expressão; este resíduo é uma linha inteira sem contexto.
            alternative_text = re.sub(r"(?:\n\d{1,3})+\s*$", "", alternative_text).strip()
            # Em páginas de duas colunas, o início isolado do cabeçalho
            # seguinte pode sobreviver como uma única letra no rodapé,
            # depois de uma alternativa terminada em ponto. Não é parte da
            # opção e não deve chegar ao banco.
            alternative_text = re.sub(r"(?<=\.)\nM\s*$", "", alternative_text).strip()
        extracted_alternatives.append({
            "letter": match.group(1),
            "text": alternative_text,
            "file": None,
            "isCorrect": match.group(1) == answer,
        })
    if any(not alt["text"] for alt in extracted_alternatives):
        return None
    # Nunca publica uma transcrição parcialmente corrompida: se uma nova
    # variação de layout escapar da limpeza, o item fica fora do lote até que
    # o parser seja corrigido e coberto por teste.
    if contains_page_chrome(statement) or any(contains_page_chrome(alt["text"]) for alt in extracted_alternatives):
        return None

    official_url = f"https://download.inep.gov.br/enem/provas_e_gabaritos/{pdf_name}"
    return {
        "year": year,
        "questionIndex": number,
        "discipline": discipline(number),
        "language": "",
        "title": f"Questão {number} - ENEM {year}",
        "context": None,
        "files": [],
        "correctAlternative": answer,
        "alternativesIntroduction": statement,
        "alternatives": extracted_alternatives,
        "rawJson": {
            "source": "inep_provas_gabaritos",
            "year": year,
            "index": number,
            "officialPdf": official_url,
            "page": page,
            "extraction": "text_only_pdf_v2",
            "visualDetected": visual,
        },
    }


def to_visual_fallback_question(year: int, number: int, text: str, answer: str, page: int, pdf_name: str) -> dict[str, Any] | None:
    """Cria um item respondível quando as cinco opções existem apenas como desenho.

    O enunciado extraído continua disponível para busca e acessibilidade. O
    recorte integral do PDF, associado pelo importador, é a fonte oficial das
    alternativas; não inventamos uma transcrição para gráficos, esquemas ou
    circuitos vetoriais.
    """
    statement = text.strip()
    if len(statement) < 20:
        return None
    official_url = f"https://download.inep.gov.br/enem/provas_e_gabaritos/{pdf_name}"
    return {
        "year": year,
        "questionIndex": number,
        "discipline": discipline(number),
        "language": "",
        "title": f"Questão {number} - ENEM {year}",
        "context": None,
        "files": [],
        "correctAlternative": answer,
        "alternativesIntroduction": statement,
        "alternatives": [
            {
                "letter": letter,
                "text": "Alternativa apresentada na imagem oficial da questão.",
                "file": None,
                "isCorrect": letter == answer,
            }
            for letter in "ABCDE"
        ],
        "rawJson": {
            "source": "inep_provas_gabaritos",
            "year": year,
            "index": number,
            "officialPdf": official_url,
            "page": page,
            "extraction": "visual_question_pdf_v1",
            "visualDetected": True,
            "visualAlternatives": True,
        },
    }


def extract_year(root: Path, year: int, include_visual: bool = False) -> dict[str, Any]:
    proofs = root / str(year) / "provas-gabaritos-regular"
    day1_pdf = proofs / f"{year}_PV_impresso_D1_CD1.pdf"
    day2_pdf = proofs / f"{year}_PV_impresso_D2_CD5.pdf"
    day1_key = proofs / f"{year}_GB_impresso_D1_CD1.pdf"
    day2_key = proofs / f"{year}_GB_impresso_D2_CD5.pdf"
    required = [day1_pdf, day2_pdf, day1_key, day2_key]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise FileNotFoundError("Arquivos oficiais ausentes: " + ", ".join(missing))

    answers = answer_key(day1_key) | answer_key(day2_key)
    supports = extract_shared_support_texts(day1_pdf) | extract_shared_support_texts(day2_pdf)
    texts1, visuals1, pages1 = extract_booklet(day1_pdf)
    texts2, visuals2, pages2 = extract_booklet(day2_pdf)
    texts = texts1 | texts2
    visuals = visuals1 | visuals2
    pages = pages1 | pages2
    questions = []
    incomplete_visual_questions = []
    for number in sorted(texts):
        answer = answers.get(number)
        if not answer:
            continue
        pdf_name = day1_pdf.name if number <= 90 else day2_pdf.name
        question = to_question(year, number, texts[number], answer, visuals.get(number, True), pages.get(number, 0), pdf_name, include_visual)
        if question is not None:
            question["context"] = supports.get(number)
            questions.append(question)
            continue
        # Alguns itens oficiais têm alternativas compostas exclusivamente por
        # imagens vetoriais. Eles precisam do recorte completo, não de OCR.
        if include_visual and visuals.get(number, False):
            fallback = to_visual_fallback_question(year, number, texts[number], answer, pages.get(number, 0), pdf_name)
            if fallback is not None:
                incomplete_visual_questions.append(fallback)
    expected = set(range(1, 181)) - {number for number in range(1, 181) if number not in answers}
    return {
        "year": year,
        "answerCount": len(answers),
        "textCount": len(texts),
        "visualExcluded": sum(1 for number in expected if visuals.get(number, True)),
        "questions": questions,
        "incompleteVisualQuestions": incomplete_visual_questions,
        "missingQuestionNumbers": sorted(expected - set(texts)),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--years", required=True)
    parser.add_argument("--include-visual", action="store_true", help="Inclui texto das questões visuais; o chamador deve associar o recorte oficial.")
    args = parser.parse_args()
    years = [int(value.strip()) for value in args.years.split(",") if value.strip()]
    print(json.dumps({"years": [extract_year(args.root, year, args.include_visual) for year in years]}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Erro ao extrair PDFs oficiais: {error}", file=sys.stderr)
        raise
