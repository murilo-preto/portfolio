import ImageCarousel from "@/components/ImageCarousel";

export default function Home() {
  return (
    <main className="flex-1 p-6 space-y-6">
      <h1 className="text-2xl antialiased text-semibold text-left text-shadow-2xs">
        CV: Pictures, Projects, Information
      </h1>
      <ImageCarousel />
      <div>
        <h2>Personal Information</h2>
        <p>Text</p>
      </div>
    </main>
  );
}
