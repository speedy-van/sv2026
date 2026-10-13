const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0B1F33"/><path d="M13 28h7M10 34h10M15 40h7" stroke="#6D3BD7" stroke-width="4" stroke-linecap="round"/><rect x="22" y="23" width="23" height="17" rx="4" fill="#FFC93C"/><rect x="42" y="27" width="10" height="13" rx="3" fill="#FFC93C"/><rect x="45" y="30" width="4" height="4" rx="1" fill="#6D3BD7"/><circle cx="29" cy="44" r="4" fill="#fff"/><circle cx="47" cy="44" r="4" fill="#fff"/><circle cx="29" cy="44" r="2" fill="#0B1F33"/><circle cx="47" cy="44" r="2" fill="#0B1F33"/></svg>`;

export function GET(): Response {
  return new Response(faviconSvg, {
    headers: {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Type': 'image/svg+xml',
    },
  });
}
