import Section from "./Section";

const SkillGroup = ({ title, items }: { title: string; items: string[] }) => (
  <div>
    <h3 className="text-xs font-semibold tracking-wide uppercase text-muted-foreground mb-3">
      {title}
    </h3>

    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-md border px-2.5 py-1 text-xs 
                     text-muted-foreground 
                     hover:text-foreground 
                     hover:border-foreground/40 
                     transition-all"
        >
          {item}
        </span>
      ))}
    </div>
  </div>
);

export default function Skills() {
  return (
    <Section title="Technical Skills">
      <div className="space-y-6 text-sm">
        <SkillGroup
          title="AI / ML Deployment"
          items={[
            "QNN",
            "SNPE",
            "QAIC",
            "ONNX",
            "TFLite",
            "vLLM",
            "Llama.cpp",
            "Transformers",
            "HuggingFace",
            "YOLO",
            "CNNs",
            "Autoencoders",
            "RAG Systems",
          ]}
        />

        <SkillGroup
          title="Programming"
          items={[
            "Python",
            "C",
            "C++",
            "Rust",
            "Java",
            "HTML",
            "CSS",
            "JavaScript",
          ]}
        />

        <SkillGroup
          title="Systems & Tooling"
          items={["Linux", "Windows", "Docker", "Git", "PostgreSQL", "MySQL"]}
        />
      </div>
    </Section>
  );
}
