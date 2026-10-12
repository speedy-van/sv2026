import type { ReactNode } from 'react';

export function ScotlandRouteMap(): ReactNode {
  return (
    <div aria-hidden="true" className="route-map">
      <svg role="img" viewBox="0 0 520 420">
        <path
          className="map-coast"
          d="M190 372c-20-19-24-46-10-70 10-18 14-42 5-63-12-31-2-54 29-69 28-14 37-34 27-62-8-22 0-40 25-54 24-14 44-16 60-5 17 12 21 31 10 58-11 28-4 48 21 61 26 14 35 34 26 61-8 25-2 45 18 61 22 18 26 42 11 70-18 34-53 46-104 35-17-4-32-1-45 8-28 18-52 8-73-31Z"
        />
        <path className="map-coast" d="M169 236c-32 2-53-10-64-36 20-17 43-16 70 4" />
        <path className="map-coast" d="M348 95c27 0 48 13 63 40-15 15-33 19-54 12" />
        <path className="map-route" d="M210 305 C 265 250, 285 245, 337 276" />
        <circle className="map-dot" cx="210" cy="305" r="6" />
        <circle className="map-dot" cx="337" cy="276" r="6" />
        <circle className="map-dot" cx="270" cy="245" r="5" />
        <circle className="map-dot" cx="302" cy="225" r="5" />
        <circle className="map-dot" cx="292" cy="132" r="5" />
        <circle className="map-dot" cx="246" cy="272" r="5" />
        <circle className="map-dot" cx="259" cy="295" r="5" />
        <circle className="map-dot" cx="326" cy="300" r="5" />
        <text className="map-city" x="185" y="330">
          Glasgow
        </text>
        <text className="map-city" x="348" y="280">
          Edinburgh
        </text>
      </svg>
    </div>
  );
}
