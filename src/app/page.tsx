import { auth, hasAuthSecret, signOut } from "@/auth";
import Link from "next/link";
import GameWrapper from "./GameWrapper";

export default async function HomePage() {
  const session = hasAuthSecret ? await auth().catch(() => null) : null;

  return (
    <main className="cabinet-stage">
      <div className="cabinet">
        <div className="cabinet-marquee arcade-text">Dungeon Crawler</div>

        {/* Game canvas */}
        <div className="cabinet-bezel">
          <GameWrapper />
        </div>

        {/* Sign-in bar */}
        <div className="cabinet-bar arcade-text">
          {session?.user ? (
            <>
              <span>
                Signed in as <span className="text-[#f4f0f8]">{session.user.name}</span>
              </span>
              <form
                action={async () => {
                  "use server";
                  await signOut();
                }}
              >
                <button type="submit" className="arcade-btn">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <span>Playing as guest - progress saves on this device</span>
              <Link href="/login" className="arcade-link">
                Sign in / Register
              </Link>
            </>
          )}
        </div>

        <p className="cabinet-hint arcade-text">Controls: press H on the title screen</p>
      </div>
    </main>
  );
}
