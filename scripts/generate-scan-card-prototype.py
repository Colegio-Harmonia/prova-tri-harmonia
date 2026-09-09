#!/usr/bin/env python3
"""Gera o PDF estático do protótipo de cartão-resposta do piloto OMR.

Este arquivo é deliberadamente um gerador de artefato de descoberta. Ele não
emite folhas reais, não consulta banco e usa somente dados fictícios. A
implementação de produção deverá trocar o token de exemplo por uma emissão
assinada e versionada no servidor.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


PAGE_WIDTH, PAGE_HEIGHT = A4
MARGIN = 12 * mm
MARKER_SIZE = 7 * mm
QR_SIZE = 27 * mm
GREEN = colors.HexColor('#008649')
LIGHT_GREEN = colors.HexColor('#E7F4EC')
LIGHT_GRAY = colors.HexColor('#F4F6F5')
TEXT = colors.HexColor('#202522')
MUTED = colors.HexColor('#59635C')
BRAND_ICON_PATH = Path(__file__).resolve().parents[1] / 'public' / 'brand' / 'harmonia-icon.png'


def draw_fiducials(pdf: canvas.Canvas) -> None:
    """Desenha marcadores de canto para alinhamento e checagem de corte."""
    positions = (
        (MARGIN, MARGIN),
        (PAGE_WIDTH - MARGIN - MARKER_SIZE, MARGIN),
        (MARGIN, PAGE_HEIGHT - MARGIN - MARKER_SIZE),
        (PAGE_WIDTH - MARGIN - MARKER_SIZE, PAGE_HEIGHT - MARGIN - MARKER_SIZE),
    )
    pdf.setFillColor(colors.black)
    for x, y in positions:
        pdf.rect(x, y, MARKER_SIZE, MARKER_SIZE, stroke=0, fill=1)


def draw_qr(pdf: canvas.Canvas, value: str) -> None:
    widget = qr.QrCodeWidget(value)
    bounds = widget.getBounds()
    width = bounds[2] - bounds[0]
    height = bounds[3] - bounds[1]
    drawing = Drawing(QR_SIZE, QR_SIZE, transform=[QR_SIZE / width, 0, 0, QR_SIZE / height, 0, 0])
    drawing.add(widget)
    renderPDF.draw(drawing, pdf, PAGE_WIDTH - MARGIN - QR_SIZE, PAGE_HEIGHT - 65 * mm)


def draw_header(pdf: canvas.Canvas, title: str, page_number: int, qr_value: str) -> None:
    draw_fiducials(pdf)
    pdf.setFillColor(GREEN)
    pdf.roundRect(MARGIN, PAGE_HEIGHT - 43 * mm, 116 * mm, 18 * mm, 3 * mm, stroke=0, fill=1)
    pdf.setFillColor(colors.white)
    pdf.roundRect(MARGIN + 5 * mm, PAGE_HEIGHT - 40.5 * mm, 13 * mm, 13 * mm, 2 * mm, stroke=0, fill=1)
    pdf.drawImage(
        ImageReader(str(BRAND_ICON_PATH)),
        MARGIN + 6.5 * mm,
        PAGE_HEIGHT - 39 * mm,
        10 * mm,
        10 * mm,
        preserveAspectRatio=True,
        anchor='c',
        mask='auto',
    )
    pdf.setFillColor(colors.white)
    pdf.setFont('Helvetica-Bold', 14)
    pdf.drawString(MARGIN + 22 * mm, PAGE_HEIGHT - 33 * mm, 'COLÉGIO HARMONIA')
    pdf.setFont('Helvetica', 8.5)
    pdf.drawString(MARGIN + 22 * mm, PAGE_HEIGHT - 38.5 * mm, title)

    draw_qr(pdf, qr_value)
    pdf.setFillColor(TEXT)
    pdf.setFont('Helvetica-Bold', 7.5)
    pdf.drawCentredString(PAGE_WIDTH - MARGIN - QR_SIZE / 2, PAGE_HEIGHT - 68.5 * mm, 'QR DE TESTE')
    pdf.setFont('Helvetica', 7)
    pdf.drawCentredString(PAGE_WIDTH - MARGIN - QR_SIZE / 2, PAGE_HEIGHT - 72.5 * mm, 'Não usar em produção')
    pdf.drawCentredString(PAGE_WIDTH - MARGIN - QR_SIZE / 2, PAGE_HEIGHT - 76.5 * mm, f'Página {page_number}/2 • Layout PTR1')

    pdf.setFillColor(MUTED)
    pdf.setFont('Helvetica', 7.5)
    pdf.drawString(MARGIN, 20 * mm, 'Protótipo de layout para piloto OMR/HTR • Dados fictícios • A4 em escala 100%')


def draw_info_box(pdf: canvas.Canvas) -> None:
    x = MARGIN
    y = PAGE_HEIGHT - 110 * mm
    width = PAGE_WIDTH - 2 * MARGIN
    height = 28 * mm
    pdf.setFillColor(LIGHT_GRAY)
    pdf.setStrokeColor(colors.HexColor('#CCD3CE'))
    pdf.roundRect(x, y, width, height, 2 * mm, stroke=1, fill=1)

    fields = (
        ('Aluno', 'Estudante de teste'),
        ('Turma', '2ª série - Piloto'),
        ('Prova', 'Avaliação demonstrativa'),
        ('Aplicação', '27/07/2026'),
    )
    column_width = width / 2
    for index, (label, value) in enumerate(fields):
        col = index % 2
        row = index // 2
        text_x = x + col * column_width + 5 * mm
        text_y = y + height - 8 * mm - row * 12 * mm
        pdf.setFillColor(MUTED)
        pdf.setFont('Helvetica-Bold', 7.5)
        pdf.drawString(text_x, text_y, label.upper())
        pdf.setFillColor(TEXT)
        pdf.setFont('Helvetica', 10)
        pdf.drawString(text_x, text_y - 4.7 * mm, value)


def draw_bubble(pdf: canvas.Canvas, x: float, y: float, letter: str) -> None:
    radius = 2.5 * mm
    pdf.setStrokeColor(colors.HexColor('#535C56'))
    pdf.setLineWidth(0.8)
    pdf.circle(x, y, radius, stroke=1, fill=0)
    pdf.setFillColor(TEXT)
    pdf.setFont('Helvetica-Bold', 8)
    width = stringWidth(letter, 'Helvetica-Bold', 8)
    pdf.drawString(x - width / 2, y - 2.8, letter)


def draw_answer_row(pdf: canvas.Canvas, x: float, y: float, question_number: int) -> None:
    row_width = 82 * mm
    row_height = 11 * mm
    pdf.setStrokeColor(colors.HexColor('#D5DBD7'))
    pdf.setFillColor(colors.white)
    pdf.roundRect(x, y - row_height / 2, row_width, row_height, 1.4 * mm, stroke=1, fill=1)
    pdf.setFillColor(TEXT)
    pdf.setFont('Helvetica-Bold', 10)
    pdf.drawCentredString(x + 8 * mm, y - 3.5, str(question_number))
    pdf.setFont('Helvetica', 7.5)
    pdf.setFillColor(MUTED)
    pdf.drawString(x + 14 * mm, y - 2.7, 'MARQUE UMA')

    first_bubble = x + 37 * mm
    for offset, letter in enumerate('ABCDE'):
        draw_bubble(pdf, first_bubble + offset * 8.5 * mm, y, letter)


def draw_answer_card(pdf: canvas.Canvas) -> None:
    qr_value = 'PTR1.TESTE-7F6A.P1.L1.ASSINATURA-DEMONSTRATIVA'
    draw_header(pdf, 'CARTÃO-RESPOSTA • PILOTO DE LEITURA', 1, qr_value)
    draw_info_box(pdf)

    pdf.setFillColor(TEXT)
    pdf.setFont('Helvetica-Bold', 10.5)
    pdf.drawString(MARGIN, PAGE_HEIGHT - 120 * mm, 'Respostas objetivas')
    pdf.setFont('Helvetica', 8)
    pdf.setFillColor(MUTED)
    pdf.drawString(MARGIN, PAGE_HEIGHT - 125 * mm, 'Preencha completamente apenas uma bolha por questão, com caneta escura.')

    row_start = PAGE_HEIGHT - 137 * mm
    for index, question_number in enumerate(range(1, 9)):
        draw_answer_row(pdf, MARGIN, row_start - index * 13 * mm, question_number)
    for index, question_number in enumerate(range(9, 16)):
        draw_answer_row(pdf, 108 * mm, row_start - index * 13 * mm, question_number)

    instruction_y = 43 * mm
    pdf.setFillColor(LIGHT_GREEN)
    pdf.setStrokeColor(colors.HexColor('#A7D7B8'))
    pdf.roundRect(MARGIN, instruction_y, PAGE_WIDTH - 2 * MARGIN, 14 * mm, 2 * mm, stroke=1, fill=1)
    pdf.setFillColor(TEXT)
    pdf.setFont('Helvetica-Bold', 8)
    pdf.drawString(MARGIN + 4 * mm, instruction_y + 8 * mm, 'CONFERÊNCIA')
    pdf.setFont('Helvetica', 7.5)
    pdf.drawString(MARGIN + 4 * mm, instruction_y + 4 * mm, 'Não dobre, não cubra o QR e não escreva sobre os marcadores pretos dos cantos.')
    pdf.showPage()


def draw_response_area(pdf: canvas.Canvas, x: float, y: float, width: float, height: float, question: int) -> None:
    pdf.setFillColor(colors.white)
    pdf.setStrokeColor(colors.HexColor('#B9C3BC'))
    pdf.roundRect(x, y, width, height, 2 * mm, stroke=1, fill=1)
    pdf.setFillColor(GREEN)
    pdf.setFont('Helvetica-Bold', 9.5)
    pdf.drawString(x + 4 * mm, y + height - 7 * mm, f'QUESTÃO {question}')
    pdf.setFillColor(MUTED)
    pdf.setFont('Helvetica', 7.5)
    pdf.drawString(x + 31 * mm, y + height - 6.8 * mm, 'Escreva somente dentro desta área.')
    pdf.setStrokeColor(colors.HexColor('#DFE5E0'))
    pdf.setLineWidth(0.5)
    line_y = y + height - 15 * mm
    while line_y > y + 7 * mm:
        pdf.line(x + 4 * mm, line_y, x + width - 4 * mm, line_y)
        line_y -= 6 * mm


def draw_discursive_sheet(pdf: canvas.Canvas) -> None:
    qr_value = 'PTR1.TESTE-7F6A.P2.L1.ASSINATURA-DEMONSTRATIVA'
    draw_header(pdf, 'FOLHA DISCURSIVA • PILOTO DE LEITURA', 2, qr_value)

    pdf.setFillColor(MUTED)
    pdf.setFont('Helvetica', 8)
    pdf.drawString(MARGIN, PAGE_HEIGHT - 84 * mm, 'A identificação desta página é independente. Mantenha QR e marcadores visíveis no scan.')

    x = MARGIN
    width = PAGE_WIDTH - 2 * MARGIN
    box_height = 42 * mm
    for index, question_number in enumerate((10, 11, 12)):
        draw_response_area(pdf, x, PAGE_HEIGHT - 132 * mm - index * 49 * mm, width, box_height, question_number)
    pdf.showPage()


def generate(output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(output_path), pagesize=A4, pageCompression=1)
    pdf.setTitle('Cartão-resposta - piloto de leitura')
    pdf.setAuthor('Colégio Harmonia - protótipo técnico')
    pdf.setSubject('Protótipo estático de cartão-resposta para validação física')
    draw_answer_card(pdf)
    draw_discursive_sheet(pdf)
    pdf.save()


def main() -> None:
    parser = argparse.ArgumentParser(description='Gera o PDF de teste do cartão-resposta.')
    parser.add_argument(
        '--output',
        type=Path,
        default=Path('output/pdf/cartao-resposta-piloto-omr-v2-logo.pdf'),
        help='Caminho do PDF de saída.',
    )
    args = parser.parse_args()
    generate(args.output)
    print(args.output)


if __name__ == '__main__':
    main()
