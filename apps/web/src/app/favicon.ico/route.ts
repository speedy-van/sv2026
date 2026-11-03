export function GET(): Response {
  return new Response(null, {
    status: 307,
    headers: {
      'Cache-Control': 'public, max-age=0, must-revalidate',
      Location: '/icon.png',
    },
  });
}
