import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy - Dungeon Crawler",
  description: "What Dungeon Crawler collects (in the app: nothing).",
};

// The privacy policy both app stores link to. Keep it true to the code: the iOS and Android apps make no network
// calls, and the website only stores what a player chooses to save to an account.
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 leading-relaxed">
      <h1 className="arcade-text text-[#f4c42c] text-xl mb-6">Dungeon Crawler: privacy</h1>

      <h2 className="text-lg text-[#fff08c] mt-6 mb-2">The iPhone, iPad and Android apps</h2>
      <p>
        The apps collect no data. They have no accounts, no ads, no analytics and no tracking, and they make no network
        requests. Your characters and settings are saved only on your device and are removed when you delete the app.
        The narrator uses your device&apos;s built-in text-to-speech; nothing you do in the game leaves the device.
      </p>

      <h2 className="text-lg text-[#fff08c] mt-6 mb-2">The website (dungeon.civops.io)</h2>
      <p>
        You can play as a guest, in which case progress is saved in your browser only. If you choose to register, we
        store the email address and name you give, a one-way hash of your password, and your saved games, so you can
        continue on another device. We do not sell or share this data, use it for advertising, or track you across
        other sites. To have your account and saves deleted, write to the address below.
      </p>

      <h2 className="text-lg text-[#fff08c] mt-6 mb-2">Children</h2>
      <p>The apps collect nothing from anyone, including children.</p>

      <h2 className="text-lg text-[#fff08c] mt-6 mb-2">Contact</h2>
      <p>
        Questions or deletion requests: <a className="underline" href="mailto:privacy@civops.io">privacy@civops.io</a>
      </p>

      <p className="mt-8 text-sm text-[#7d7890]">Last updated 16 November 2026.</p>
      <p className="mt-4">
        <Link href="/" className="arcade-link">
          Back to the game
        </Link>
      </p>
    </main>
  );
}
