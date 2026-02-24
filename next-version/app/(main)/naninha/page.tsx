import ImageCarousel from "@/components/ImageCarousel";

const images = [
  "/images/naninha/nana_e_muri_1.jpg",
  "/images/naninha/nana_e_muri_2.jpg",
  "/images/naninha/nana_e_muri_3.jpg",
  "/images/naninha/nana_e_muri_4.jpg",
  "/images/naninha/nana_e_muri_5.jpg",
  "/images/naninha/nana_e_muri_6.jpg",
  "/images/naninha/nana_e_muri_7.jpg",
];

export default function CVPage() {
  return (
    <main
      className="
        flex-1 p-6 space-y-12 max-w-5xl mx-auto
        bg-transparent
        text-gray-900
        dark:text-gray-100
      "
    >
      <h1
        className="
          text-3xl font-bold text-center
          p-4 m-4 rounded-2xl
          bg-gray-100
          dark:bg-gray-800
        "
      >
        Muri e Nana ♥
      </h1>

      <ImageCarousel images={images} />

      <p
        className="
          text-3xl font-bold text-center
          p-4 m-4 rounded-2xl
          bg-gray-100
          dark:bg-gray-800
        "
      >
        Te amo, Naninha 🤏
      </p>
    </main>
  );
}
