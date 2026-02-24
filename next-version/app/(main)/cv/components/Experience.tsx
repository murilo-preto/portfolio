import Section from "./Section";

export default function Experience() {
  return (
    <Section title="Experience">
      <div className="relative space-y-8 text-sm border-l pl-6">
        {/* Qualcomm */}
        <div className="relative">
          <span className="rounded-full bg-foreground" />

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <p className="font-semibold tracking-tight">
              Qualcomm
              <span className="font-normal text-muted-foreground">
                {" "}
                — Software Engineer Intern
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              São Paulo · 02/2025 – Present
            </p>
          </div>

          <ul className="mt-3 space-y-1.5 text-muted-foreground marker:text-foreground list-disc list-inside">
            <li>AI model deployment using QNN, SNPE and QAIC</li>
            <li>Integration across Windows, Ubuntu and Yocto Linux</li>
            <li>Enterprise customer support for AI solutions</li>
          </ul>
        </div>

        {/* UFABC */}
        <div className="relative">
          <span className="rounded-full bg-foreground" />

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <p className="font-semibold tracking-tight">
              UFABC
              <span className="font-normal text-muted-foreground">
                {" "}
                — Research Fellow
              </span>
            </p>
            <p className="text-xs text-muted-foreground">2021 – 2024</p>
          </div>

          <ul className="mt-3 space-y-1.5 text-muted-foreground marker:text-foreground list-disc list-inside">
            <li>Publications in SVR, SIBGRAPI, CBIS and SICT</li>
            <li>Award-winning projects in computer vision</li>
          </ul>
        </div>
      </div>
    </Section>
  );
}
