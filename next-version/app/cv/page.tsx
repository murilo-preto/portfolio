import ImageCarousel from "@/components/ImageCarousel";

import PersonalInfo from "./components/PersonalInfo";
import Summary from "./components/Summary";
import Skills from "./components/Skills";
import Experience from "./components/Experience";
import Languages from "./components/Languages";

export default function CVPage() {
  return (
    <main className="flex-1 p-6 space-y-12 max-w-5xl mx-auto">
      <ImageCarousel />

      <PersonalInfo />
      <Summary />
      <Skills />
      <Experience />
      <Languages />
    </main>
  );
}
