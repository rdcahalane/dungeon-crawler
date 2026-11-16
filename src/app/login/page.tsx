"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
    <div className="cabinet-stage">
      <div className="arcade-panel arcade-text space-y-6">
        <div>
          <h1 className="text-[#f4c42c] text-base tracking-[0.25em]">Dungeon Crawler</h1>
          <p className="text-[#7d7890] mt-2">
            {mode === "login" ? "Sign in to save your progress" : "Create an account"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "register" && (
            <div>
              <label className="block text-[#b8b4c8] mb-1">Username</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="dungeon_knight"
                className="arcade-input"
              />
            </div>
          )}
          <div>
            <label className="block text-[#b8b4c8] mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="arcade-input"
            />
          </div>
          <div>
            <label className="block text-[#b8b4c8] mb-1">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="arcade-input"
            />
          </div>
          {error && <p className="text-[#d8382c]">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="arcade-btn arcade-btn-primary w-full py-2"
          >
            {loading ? "..." : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="text-center text-[#7d7890]">
          {mode === "login" ? (
            <>No account? <button onClick={() => setMode("register")} className="arcade-link">Register</button></>
          ) : (
            <>Have an account? <button onClick={() => setMode("login")} className="arcade-link">Sign in</button></>
          )}
        </p>
        <p className="text-center">
          <Link href="/" className="arcade-link">Back to the game (guest)</Link>
        </p>
      </div>
    </div>
  );
}
