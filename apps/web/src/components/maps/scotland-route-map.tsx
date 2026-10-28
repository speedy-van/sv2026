import type { CSSProperties, ReactNode } from 'react';

const cityDots = [
  { label: 'Inverness', primary: false, x: 286, y: 116 },
  { label: 'Aberdeen', primary: false, x: 360, y: 180 },
  { label: 'Dundee', primary: false, x: 326, y: 242 },
  { label: 'Perth', primary: false, x: 292, y: 256 },
  { label: 'Stirling', primary: false, x: 262, y: 286 },
  { label: 'Glasgow', primary: true, x: 218, y: 318 },
  { label: 'Edinburgh', primary: true, x: 350, y: 306 },
] as const;

type CityStyle = CSSProperties & {
  '--city-index': number;
};

function cityStyle(index: number): CityStyle {
  return { '--city-index': index };
}

export function ScotlandRouteMap(): ReactNode {
  return (
    <figure aria-hidden="true" className="route-map hero-route-map">
      <svg role="presentation" viewBox="0 0 520 440">
        <defs>
          <linearGradient id="heroRouteGradient" x1="210" x2="352" y1="318" y2="306" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#FFC93C" />
            <stop offset="0.52" stopColor="#BB9DFB" />
            <stop offset="1" stopColor="#34C28C" />
          </linearGradient>
        </defs>
        <path className="hero-map-road" d="M96 371 C 176 318, 229 291, 304 246 S 418 162, 463 92" />
        <path
          className="map-coast hero-map-coast"
          d="M190 386c-20-19-24-46-10-70 10-18 14-42 5-63-12-31-2-54 29-69 28-14 37-34 27-62-8-22 0-40 25-54 24-14 44-16 60-5 17 12 21 31 10 58-11 28-4 48 21 61 26 14 35 34 26 61-8 25-2 45 18 61 22 18 26 42 11 70-18 34-53 46-104 35-17-4-32-1-45 8-28 18-52 8-73-31Z"
        />
        <path className="map-coast hero-map-coast hero-map-island" d="M169 250c-32 2-53-10-64-36 20-17 43-16 70 4" />
        <path className="map-coast hero-map-coast hero-map-island" d="M348 109c27 0 48 13 63 40-15 15-33 19-54 12" />
        <path className="hero-map-route-glow" d="M218 318 C 260 274, 304 274, 350 306" />
        <path className="hero-map-route" d="M218 318 C 260 274, 304 274, 350 306" />
        {cityDots.map((city, index) => (
          <g className="hero-map-city" key={city.label} style={cityStyle(index)}>
            <circle className={city.primary ? 'map-dot map-dot-primary' : 'map-dot'} cx={city.x} cy={city.y} r={city.primary ? 7 : 5} />
            <text x={city.x + 12} y={city.y + 5}>
              {city.label}
            </text>
          </g>
        ))}
        <g className="hero-map-van">
          <rect className="hero-map-van-box" height="13" rx="3" width="24" x="-14" y="-10" />
          <path className="hero-map-van-cab" d="M10-8h9l6 7v4H10z" />
          <circle className="hero-map-van-wheel" cx="-8" cy="6" r="3" />
          <circle className="hero-map-van-wheel" cx="16" cy="6" r="3" />
        </g>
      </svg>
    </figure>
  );
}
