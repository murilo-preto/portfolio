"""Category name handling shared across the finance routes.

Statement PDFs shout their categories ("ALIMENTAÇÃO"), and so did every
category created from one. Normalizing on the way in keeps the stored names
readable no matter which path created them.
"""

# Portuguese connectors stay lowercase inside a name ("Turismo e Entretenim"),
# unless they lead it.
LOWERCASE_WORDS = {
    "a", "as", "o", "os", "e", "em", "de", "da", "do", "das", "dos",
    "na", "no", "nas", "nos", "para", "por", "com",
}


def normalize_category_name(name):
    """Turn a shouted category name into a readable one:
    "ALIMENTAÇÃO" -> "Alimentação", "TURISMO E ENTRETENIM" -> "Turismo e
    Entretenim".

    Only all-caps words of three letters or more are re-cased, so deliberate
    spellings survive: "Bills" stays "Bills" and an acronym like "TV" is left
    alone rather than being mangled into "Tv".

    Mirrors normalizeCategoryName() in next-version/lib/categoryName.ts.
    """
    words = name.split()
    out = []

    for i, word in enumerate(words):
        lowered = word.lower()
        if i > 0 and lowered in LOWERCASE_WORDS:
            out.append(lowered)
        elif word.isupper() and len(word) >= 3:
            out.append(word.capitalize())
        else:
            out.append(word)

    return " ".join(out)
