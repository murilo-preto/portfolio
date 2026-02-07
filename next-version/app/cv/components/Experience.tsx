import Section from "./Section";

export default function Experience() {
  return (
    <Section title="Experience">
      <div className="space-y-6 text-sm">
        <div>
          <p className="font-medium">Qualcomm — Software Engineer Intern</p>
          <p className="text-muted-foreground">São Paulo · 02/2025 – Present</p>
          <ul className="list-disc list-inside mt-2">
            <li>AI model deployment using QNN, SNPE and QAIC</li>
            <li>Integration across Windows, Ubuntu and Yocto Linux</li>
            <li>Enterprise customer support for AI solutions</li>
          </ul>
        </div>

        <div>
          <p className="font-medium">UFABC — Research Fellow</p>
          <p className="text-muted-foreground">2021 – 2024</p>
          <ul className="list-disc list-inside mt-2">
            <li>Publications in SVR, SIBGRAPI, CBIS and SICT</li>
            <li>Award-winning projects in computer vision</li>
          </ul>
        </div>
      </div>
    </Section>
  );
}
