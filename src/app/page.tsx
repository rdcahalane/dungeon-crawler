import { auth, hasAuthSecret, signOut } from "@/auth";
import Link from "next/link";
import GameWrapper from "./GameWrapper";
import FullscreenButton from "./FullscreenButton";

export default async function HomePage() {
  const session = hasAuthSecret ? await auth().catch(() => null) : null;

  const account = session?.user ? (
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
      <span className="account-note">Playing as guest - progress saves on this device</span>
      <Link href="/login" className="arcade-link">
        Sign in / Register
      </Link>
    </>
  );

  return (
    <main className="cabinet-stage">
      <div className="cabinet">
        <div className="cabinet-marquee arcade-text">Dungeon Crawler</div>

        {/* Game canvas */}
        <div className="cabinet-bezel">
          <GameWrapper />
        </div>

        {/* Sign-in bar (desktop cabinet) */}
        <div className="cabinet-bar arcade-text">{account}</div>

        <p className="cabinet-hint arcade-text">Controls: press H on the title screen</p>
      </div>

      {/* Compact screens (phones, short windows): the cabinet chrome is hidden, these sit in the page corners. */}
      <div className="corner corner-bl arcade-text">{account}</div>
      <div className="corner corner-tr">
        <FullscreenButton />
      </div>

      {/* Portrait phones: cover everything until the device is turned. */}
      <div className="rotate-overlay" role="alert">
        <svg className="rotate-icon" viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="miter">
          <rect x="22" y="6" width="20" height="36" />
          <path d="M30 36h4" />
          <path d="M50 14a18 18 0 0 1 8 20M58 34l-6-2M58 34l2-6" />
        </svg>
        <p className="rotate-title arcade-text">Turn your phone sideways to play</p>
      </div>
    </main>
  );
}
