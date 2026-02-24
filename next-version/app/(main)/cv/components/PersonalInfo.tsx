import Section from "./Section";
import { Mail, Globe, Linkedin, Github, MapPin } from "lucide-react";

export default function PersonalInfo() {
  return (
    <Section title="Personal Information">
      <div className="space-y-4">
        {/* Location */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPin className="h-4 w-4" />
          <span>São Bernardo do Campo, SP</span>
        </div>

        {/* Links */}
        <ul className="flex flex-wrap gap-3">
          <li>
            <a
              href="mailto:murilopreto2003@outlook.com"
              className="group inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm 
                         text-muted-foreground hover:text-foreground 
                         hover:border-foreground/40 transition-all"
            >
              <Mail className="h-4 w-4 transition-transform group-hover:scale-110" />
              murilopreto2003@outlook.com
            </a>
          </li>

          <li>
            <a
              href="https://murilo-preto.github.io"
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm 
                         text-muted-foreground hover:text-foreground 
                         hover:border-foreground/40 transition-all"
            >
              <Globe className="h-4 w-4 transition-transform group-hover:scale-110" />
              Blog
            </a>
          </li>

          <li>
            <a
              href="https://linkedin.com/in/murilo-preto"
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm 
                         text-muted-foreground hover:text-foreground 
                         hover:border-foreground/40 transition-all"
            >
              <Linkedin className="h-4 w-4 transition-transform group-hover:scale-110" />
              LinkedIn
            </a>
          </li>

          <li>
            <a
              href="https://github.com/murilo-preto"
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm 
                         text-muted-foreground hover:text-foreground 
                         hover:border-foreground/40 transition-all"
            >
              <Github className="h-4 w-4 transition-transform group-hover:scale-110" />
              GitHub
            </a>
          </li>
        </ul>
      </div>
    </Section>
  );
}
