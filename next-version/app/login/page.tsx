"use client";

import { useState } from "react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(e: React.SubmitEvent) {
    e.preventDefault();

    // placeholder para lógica de login
    console.log({ username, password });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-black">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-6 rounded-2xl bg-white p-8 shadow-lg dark:bg-gray-800"
      >
        <h1 className="text-3xl font-bold text-center text-gray-900 dark:text-gray-100">
          Login
        </h1>

        {/* Usuário */}
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Usuário
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
        </div>

        {/* Senha */}
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Senha
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
        </div>

        {/* Botão */}
        <button
          type="submit"
          className="w-full rounded-lg bg-blue-600 py-2 font-semibold text-white transition hover:bg-blue-700"
        >
          Entrar
        </button>
      </form>
    </main>
  );
}
