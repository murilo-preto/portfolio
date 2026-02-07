"use client";

import { motion } from "framer-motion";

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

export default function Section({ title, children }: SectionProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="space-y-4"
    >
      <h2
        className="
          text-xl font-semibold
          m-2 p-2 rounded-md
          bg-gray-100
          dark:bg-gray-800
          text-gray-900
          dark:text-gray-100
        "
      >
        {title}
      </h2>

      <div
        className="
          m-4 pb-4 rounded-md
          bg-white
          dark:bg-gray-900
          text-gray-900
          dark:text-gray-100
        "
      >
        {children}
      </div>
    </motion.section>
  );
}
