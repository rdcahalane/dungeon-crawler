"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (mode === "register") {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); setLoading(false); return; }
    }

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid email or password.");
      setLoading(false);
    } else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl bg-[#141420] p-8 border border-gray-800">
        <div>
          <h1 className="text-xl font-bold text-white font-mono">Dungeon Crawler</h1>
          <p className="text-sm text-gray-500 mt-1 font-mono">
            {mode === "login" ? "Sign in to save your progress" : "Create an account"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "register" && (
            <div>
              <label className="block text-xs font-mono text-gray-400 mb-1">Username</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="dungeon_knight"
                className="w-full rounded bg-[#0a0a0f] border border-gray-700 px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-yellow-500"
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-mono text-gray-400 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded bg-[#0a0a0f] border border-gray-700 px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-yellow-500"
            />
          </div>
          <div>
            <label className="block text-xs font-mono text-gray-400 mb-1">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded bg-[#0a0a0f] border border-gray-700 px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-yellow-500"
            />
          </div>
          {error && <p className="text-xs text-red-400 font-mono">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-yellow-600 hover:bg-yellow-500 px-4 py-2 text-sm font-bold text-black font-mono disabled:opacity-50"
          >
            {loading ? "..." : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="text-xs text-center text-gray-600 font-mono">
          {mode === "login" ? (
            <>No account? <button onClick={() => setMode("register")} className="text-yellow-500 hover:underline">Register</button></>
          ) : (
            <>Have an account? <button onClick={() => setMode("login")} className="text-yellow-500 hover:underline">Sign in</button></>
          )}
        </p>
      </div>
    </div>
  );
}
