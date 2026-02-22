import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

// NextAuth v5 auto-reads AUTH_GITHUB_ID and AUTH_GITHUB_SECRET from env
export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [GitHub],
  session: { strategy: "jwt" },
  callbacks: {
    jwt({ token, account, profile }) {
      if (account && profile) {
        token.id = String((profile as { id?: number }).id ?? token.sub);
        token.login = (profile as { login?: string }).login ?? "";
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      if (token.login) session.user.name = token.login as string;
      return session;
    },
  },
});
