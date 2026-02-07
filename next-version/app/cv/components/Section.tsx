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
      <h2 className="text-xl font-semibold bg-gray-100 m-2 p-2 rounded-md">
        {title}
      </h2>
      <div className="bg-white m-4 pb-4">{children}</div>
    </motion.section>
  );
}
