This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

<!-- demo branch: deployment trigger -->

## Demo branch notes

This branch is the public-facing demo deployment. Differences from `main`:

- **`vercel.json` `crons` is empty** so no automated daily emails fire from
  the demo. Do NOT re-enable the cron here without first stripping the
  demo's `USER_EMAIL` env var — otherwise a real email would go out.
  Use the in-app **"Preview Today's Digest"** button on the home page to
  demonstrate what the cron would produce; it renders the email body
  inline without sending anything.
- **`USER_FIRST_NAME` is `'Demo User'`** in `src/app/page.tsx`
  (production reads `'Sammy'`).
- **All contact data is anonymized** — names from a curated multicultural
  pool, emails redirected to `@example.com`, notes rewritten to strip
  identifying biographical detail. Tags and watchlist companies remain
  unchanged because they're needed for live news intelligence.
- **The demo Supabase project (`In the Loop Demo`) is fully isolated**
  from production. Different project ref, different keys.
