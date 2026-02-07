import Section from "./Section";

export default function PersonalInfo() {
  return (
    <Section title="Personal Information">
      <p className="text-sm text-muted-foreground">
        São Bernardo do Campo, SP ·{" "}
        <a
          href="mailto:murilopreto2003@outlook.com"
          className="underline underline-offset-2 hover:text-foreground transition"
        >
          murilopreto2003@outlook.com
        </a>
      </p>

      <ul className="flex flex-wrap gap-4 text-sm">
        <li>
          <a
            href="https://murilo-preto.github.io"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground transition"
          >
            Blog
          </a>
        </li>

        <li>
          <a
            href="https://linkedin.com/in/murilo-preto"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground transition"
          >
            LinkedIn
          </a>
        </li>

        <li>
          <a
            href="https://github.com/murilo-preto"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground transition"
          >
            GitHub
          </a>
        </li>
      </ul>
    </Section>
  );
}
