import { auth, signOut } from "@/auth";
import GameWrapper from "./GameWrapper";

export default async function HomePage() {
  const session = await auth();

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-4">
      {/* Auth bar */}
      <div className="flex items-center gap-4 text-sm font-mono">
        {session?.user ? (
          <>
            <span className="text-gray-400">
              Signed in as{" "}
              <span className="text-white">{session.user.name}</span>
            </span>
            <form
              action={async () => {
                "use server";
                await signOut();
              }}
            >
              <button
                type="submit"
                className="text-gray-500 hover:text-white underline transition-colors"
              >
                Sign out
              </button>
            </form>
          </>
        ) : (
          <>
            <span className="text-gray-600">Sign in to save your progress</span>
            <a
              href="/api/auth/signin/github"
              className="text-blue-400 hover:text-white underline transition-colors"
            >
              Sign in with GitHub
            </a>
          </>
        )}
      </div>

      {/* Game canvas */}
      <GameWrapper />

      {/* Controls hint */}
      <p className="text-xs text-gray-600 font-mono">
        WASD / Arrows — Move &nbsp;|&nbsp; Space / Click — Attack &nbsp;|&nbsp; Step on ▲ — Next Floor
      </p>
    </main>
  );
}
