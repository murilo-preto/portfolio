import Link from "next/link";

export default function Home() {
  const projects = [
    {
      title: "Namu",
      description: "A time tracking app to help you understand how you spend your time. Track activities, view analytics, and improve your productivity.",
      href: "/namu",
      icon: (
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      title: "CV",
      description: "My professional resume and work experience. A curated collection of my skills, projects, and career journey.",
      href: "/cv",
      icon: (
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
    },
  ];

  return (
    <main className="flex-1 px-4 py-12 md:px-8 md:py-20 max-w-4xl mx-auto">
      <section className="text-center mb-16">
        <h1 className="text-4xl md:text-5xl font-bold mb-4 text-gray-900 dark:text-gray-100">
          Welcome
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400 max-w-lg mx-auto">
          Explore my portfolio showcasing my work and projects.
        </p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {projects.map((project) => (
          <Link
            key={project.href}
            href={project.href}
            className="block p-8 rounded-2xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:border-gray-400 dark:hover:border-neutral-500 transition-all hover:shadow-lg group"
          >
            <div className="text-gray-500 dark:text-gray-400 mb-4 group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors">
              {project.icon}
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              {project.title}
            </h2>
            <p className="text-gray-500 dark:text-gray-400">
              {project.description}
            </p>
          </Link>
        ))}
      </section>

      <section className="mt-16 text-center">
        <p className="text-gray-500 dark:text-gray-400">
          More projects coming soon...
        </p>
      </section>
    </main>
  );
}
