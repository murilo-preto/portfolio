/** Portuguese connectors stay lowercase inside a name ("Turismo e Entretenim"),
 *  unless they lead it. */
const LOWERCASE_WORDS = new Set([
  "a", "as", "o", "os", "e", "em", "de", "da", "do", "das", "dos",
  "na", "no", "nas", "nos", "para", "por", "com",
]);

/**
 * Turn a shouted category name into a readable one:
 * "ALIMENTAÇÃO" -> "Alimentação", "TURISMO E ENTRETENIM" -> "Turismo e
 * Entretenim".
 *
 * Only all-caps words of three letters or more are re-cased, so deliberate
 * spellings survive: "Bills" stays "Bills" and an acronym like "TV" is left
 * alone rather than being mangled into "Tv".
 *
 * Mirrors normalize_category_name() in flask-server/itau_pdf.py.
 */
export function normalizeCategoryName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((word, i) => {
      const lowered = word.toLocaleLowerCase();
      if (i > 0 && LOWERCASE_WORDS.has(lowered)) return lowered;
      if (word === word.toLocaleUpperCase() && word.length >= 3) {
        return word.charAt(0) + lowered.slice(1);
      }
      return word;
    })
    .join(" ");
}
