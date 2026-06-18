export function GET() {
  return new Response(
    `User-agent: *
Allow: /
Sitemap: /sitemap.xml
`,
    { headers: { "Content-Type": "text/plain" } },
  );
}
