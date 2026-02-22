import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    jwt({ token, account, profile }) {
      // Persist the GitHub user ID into the token on first sign-in
      if (account && profile) {
        token.id = String((profile as { id?: number }).id ?? token.sub);
        token.login = (profile as { login?: string }).login ?? "";
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      session.user.name = (token.login as string) || session.user.name;
      return session;
    },
  },
});
