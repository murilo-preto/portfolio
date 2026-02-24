import Section from "./Section";

function LanguageItem({
  name,
  level,
  detail,
}: {
  name: string;
  level: string;
  detail?: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border px-4 py-2 text-sm">
      <div>
        <p className="font-medium">{name}</p>
        {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      </div>

      <span className="text-xs rounded-md border px-2 py-1 text-muted-foreground">
        {level}
      </span>
    </div>
  );
}

export default function Languages() {
  return (
    <Section title="Languages">
      <div className="space-y-3">
        <LanguageItem name="Portuguese" level="Native" />

        <LanguageItem name="English" level="Fluent" detail="TOEFL iBT — C1" />

        <LanguageItem name="Spanish" level="Intermediate" />
      </div>
    </Section>
  );
}
