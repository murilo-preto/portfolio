"""Extract structured data from Itau credit card statement PDFs.

Public API:
    extract_statement(pdf_path)                  -> dict  # one statement, JSON-serializable
    extract_statement_from_bytes(data, filename) -> dict  # same, from an uploaded file
    statement_to_finance_entries(statement)      -> (entries, skipped)

Requires poppler's `pdftotext` binary to be available on PATH.
"""
import os
import re
import subprocess
import tempfile
from datetime import date

from categories import normalize_category_name

DATE_RE = re.compile(r"^(\d{2})/(\d{2})$")
AMOUNT_RE = re.compile(r"^-?[\d.]+,\d{2}$")
CARD_HEADER_RE = re.compile(r"^(.*?)\s*\(final\s+(\d{3,4})\)$")
EMISSAO_RE = re.compile(r"Emiss[aã]o:\s*(\d{2})/(\d{2})/(\d{4})")
VENCIMENTO_RE = re.compile(r"Vencimento:\s*(\d{2})/(\d{2})/(\d{4})")
CARD_SUBTOTAL_RE = re.compile(r"Lançamentos no cartão \(final (\d{3,4})\)\s+(-?[\d.]+,\d{2})")
GRAND_TOTAL_RE = re.compile(r"Total dos lançamentos atuais\s+([\d.]+,\d{2})")

STOP_MARKERS = (
    "Limites de crédito",
    "Encargos cobrados nesta fatura",
    "Total dos lançamentos atuais",
)
START_MARKER = "Lançamentos: compras e saques"

# Itau statements lay out two card tables side by side. In the `pdftotext
# -layout` output the left table's content always ends well before column 90
# and the right table's content always starts at column 95, so splitting each
# physical line at column 90 cleanly separates the two tables.
SPLIT_COL = 90

# Fallback category when a transaction has no category/city continuation line.
DEFAULT_CATEGORY = "Uncategorized"


class ItauPdfError(Exception):
    """Raised when a PDF cannot be read or is not an Itau statement."""


def brl_to_float(s):
    return round(float(s.replace(".", "").replace(",", ".")), 2)


def extract_pages(path):
    """Return a list of page texts using poppler's pdftotext -layout, which
    (unlike pdfplumber's word extraction) correctly spaces words even on
    statements whose embedded font has very tight inter-word kerning."""
    try:
        result = subprocess.run(
            ["pdftotext", "-layout", path, "-"],
            capture_output=True,
            text=True,
            check=True,
            timeout=30,
        )
    except FileNotFoundError:
        raise ItauPdfError("pdftotext is not installed on the server")
    except subprocess.TimeoutExpired:
        raise ItauPdfError("Timed out while reading the PDF")
    except subprocess.CalledProcessError:
        raise ItauPdfError("Could not read the PDF — is it a valid, unencrypted file?")
    return result.stdout.split("\f")


def ordered_lines_for_page(page_text):
    """Reading order: the left card-table column top-to-bottom, then the
    right card-table column top-to-bottom (matches how Itau flows the
    two-card table across the page)."""
    raw_lines = page_text.split("\n")
    left_lines = [ln[:SPLIT_COL].rstrip() for ln in raw_lines if ln[:SPLIT_COL].strip()]
    right_lines = [ln[SPLIT_COL:].rstrip() for ln in raw_lines if ln[SPLIT_COL:].strip()]
    return left_lines + right_lines


def guess_year(day, month, emissao):
    year = emissao.year
    candidate = date(year, month, day)
    if candidate > emissao:
        candidate = date(year - 1, month, day)
    return candidate


def _parse_transactions(pages, emissao):
    """Walk the statement's transaction table(s) and return
    (transactions, titulares) where titulares maps card_final -> holder name."""
    transactions = []
    titulares = {}
    current_card = None
    active = False
    pending = None  # last transaction dict, to attach a category/city line

    for page_text in pages:
        for line in ordered_lines_for_page(page_text):
            stripped = line.strip()
            if not stripped:
                continue

            if START_MARKER in stripped:
                active = True
                pending = None
                continue

            if any(marker in stripped for marker in STOP_MARKERS):
                active = False
                pending = None
                continue

            if not active:
                continue

            if stripped.startswith("Lançamentos no cartão"):
                pending = None
                continue

            header_match = CARD_HEADER_RE.match(stripped)
            if header_match and not AMOUNT_RE.match(stripped.split()[-1]):
                current_card = header_match.group(2)
                titulares[current_card] = header_match.group(1).strip()
                pending = None
                continue

            tokens = stripped.split()
            if len(tokens) < 2:
                continue

            date_match = DATE_RE.match(tokens[0])
            # Handle "- 12,34" (credit/refund) where the minus sign is split
            # off as its own token by the -layout column split.
            if date_match and AMOUNT_RE.match(tokens[-1]):
                amount_tokens = 2 if tokens[-2] == "-" else 1
                day, month = int(date_match.group(1)), int(date_match.group(2))
                tx_date = guess_year(day, month, emissao)
                description = " ".join(tokens[1:-amount_tokens])
                sign = -1 if amount_tokens == 2 else 1
                amount = sign * brl_to_float(tokens[-1])
                pending = {
                    "cartao_final": current_card or "",
                    "data": tx_date.isoformat(),
                    "estabelecimento": description,
                    "categoria_local": "",
                    "valor": amount,
                }
                transactions.append(pending)
                continue

            if tokens[0] in ("DATA", "Titular"):
                continue

            # Otherwise, if a transaction line came right before this one,
            # treat this as its category/city continuation line. Each
            # transaction has at most one such line, so consume "pending"
            # here to avoid later unrelated lines being appended to it.
            if pending is not None and not AMOUNT_RE.match(tokens[-1]):
                pending["categoria_local"] = stripped
                pending = None

    return transactions, titulares


def extract_statement(pdf_path):
    """Parse an Itau credit card statement PDF and return a JSON-serializable
    dict with its transactions and a reconciliation summary."""
    pages = extract_pages(pdf_path)
    full_text = "\n".join(pages)

    m = EMISSAO_RE.search(full_text)
    if not m:
        raise ItauPdfError(
            "Could not find an 'Emissão' date — this does not look like an Itaú statement"
        )
    emissao = date(int(m.group(3)), int(m.group(2)), int(m.group(1)))

    vm = VENCIMENTO_RE.search(full_text)
    vencimento = date(int(vm.group(3)), int(vm.group(2)), int(vm.group(1))) if vm else None

    transactions, titulares = _parse_transactions(pages, emissao)
    transactions.sort(key=lambda t: t["data"])

    computed_por_cartao = {}
    for t in transactions:
        computed_por_cartao[t["cartao_final"]] = round(
            computed_por_cartao.get(t["cartao_final"], 0.0) + t["valor"], 2
        )
    computed_total = round(sum(computed_por_cartao.values()), 2)

    declarado_por_cartao = {
        card: brl_to_float(val) for card, val in CARD_SUBTOTAL_RE.findall(full_text)
    }
    gm = GRAND_TOTAL_RE.search(full_text)
    declarado_total = brl_to_float(gm.group(1)) if gm else None

    conferido = (
        computed_por_cartao == declarado_por_cartao
        and (declarado_total is None or computed_total == declarado_total)
    )

    return {
        "arquivo": os.path.basename(pdf_path),
        "emissao": emissao.isoformat(),
        "vencimento": vencimento.isoformat() if vencimento else None,
        "titulares": titulares,
        "transacoes": transactions,
        "resumo": {
            "total_por_cartao": computed_por_cartao,
            "total_lancamentos": computed_total,
            "total_declarado_por_cartao": declarado_por_cartao,
            "total_declarado_lancamentos": declarado_total,
            "conferido": conferido,
        },
    }


def extract_statement_from_bytes(pdf_bytes, filename="statement.pdf"):
    """Same as extract_statement, but for an uploaded file held in memory.

    pdftotext needs a real path, so the bytes are written to a temp file that
    is always removed again.
    """
    if not pdf_bytes:
        raise ItauPdfError("The uploaded file is empty")
    if not pdf_bytes.startswith(b"%PDF"):
        raise ItauPdfError("The uploaded file is not a PDF")

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(pdf_bytes)
            tmp_path = tmp.name
        statement = extract_statement(tmp_path)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)

    statement["arquivo"] = os.path.basename(filename)
    return statement


def _category_from_transaction(transaction):
    """Itau prints "<CATEGORY> .<CITY>" beneath each transaction (the space
    before the dot is not always there). Everything before the first dot is
    the category."""
    categoria_local = transaction.get("categoria_local", "")
    category = categoria_local.split(".", 1)[0].strip()
    if not category:
        return DEFAULT_CATEGORY
    return normalize_category_name(category)


def statement_to_finance_entries(statement):
    """Map a parsed statement onto the finance-entry shape used by
    /finance/batch-import.

    Returns (entries, skipped). `purchase_date` is a bare "YYYY-MM-DD" — the
    statement carries no time of day, so the client turns it into a timestamp
    in the user's own timezone before importing.

    Credits and refunds (negative amounts) are reported separately in
    `skipped` because finance entries cannot hold a negative price.
    """
    entries = []
    skipped = []

    for transaction in statement["transacoes"]:
        row = {
            "category": _category_from_transaction(transaction),
            "product_name": transaction["estabelecimento"],
            "price": abs(transaction["valor"]),
            "purchase_date": transaction["data"],
            "status": "done",
            "card": transaction["cartao_final"],
        }
        if transaction["valor"] < 0:
            skipped.append({**row, "reason": "credit or refund (negative amount)"})
        else:
            entries.append(row)

    return entries, skipped
