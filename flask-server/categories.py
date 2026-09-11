"""Category names: the defaults every account starts with, and the normalizing
the finance routes put shouted ones through.

Statement PDFs shout their categories ("ALIMENTAÇÃO"), and so did every
category created from one. Normalizing on the way in keeps the stored names
readable no matter which path created them.
"""

# The categories a new account starts with. These are seeded per user at
# registration, and migrations 004 and 006 gave every pre-existing account the
# same set when the lookup tables stopped being global.
#
# They are the lists mysql/schema.sql seeds installation-wide at :26 and :111.
# That baseline is frozen and its rows are unowned, so the migrations delete
# them -- but the two lists have to keep saying the same thing, and a test
# asserts they do. Change one, change the other.
#
# Finance and tags get no defaults: schema.sql seeds neither, finance names come
# from whatever a statement PDF happens to contain, and an unattached tag has no
# meaning until something is tagged with it.
DEFAULT_TIME_CATEGORIES = ("Reading", "Work", "Study", "Exercise")
DEFAULT_TODO_CATEGORIES = ("Personal", "Work", "Study", "Shopping")

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
