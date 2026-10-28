import { durationMs, durations, easings } from '@sv/tokens';
import { useId, type CSSProperties, type ReactNode } from 'react';
import { HeroRouteController } from './hero-route-controller';

// Coordinates trace the roads already painted into the 1672 x 941 hero artwork.
// These are illustration coordinates, not a calculated customer journey.
const routes = [
  {
    key: 'highlands',
    delay: 0,
    duration: durationMs.reveal * 5,
    path: 'M950 484 C946 455 959 433 980 410 C989 381 1000 355 1015 335 C1031 323 1052 315 1066 302 C1075 295 1084 289 1087 281 C1085 265 1071 250 1056 241 C1039 230 1014 228 998 221 C982 215 974 207 965 201 C957 196 954 190 951 184',
  },
  {
    key: 'edinburgh',
    delay: durationMs.reveal,
    duration: durationMs.reveal * 4,
    path: 'M980 410 C990 424 1012 434 1030 437 C1051 441 1068 447 1087 473',
  },
  {
    key: 'dundee',
    delay: durationMs.reveal,
    duration: durationMs.reveal * 4,
    path: 'M980 410 C1002 404 1008 397 1029 388 C1048 384 1068 380 1087 385',
  },
  {
    key: 'aberdeen',
    delay: durationMs.reveal * 2,
    duration: durationMs.reveal * 3,
    path: 'M1087 281 C1105 276 1120 274 1137 266 C1148 258 1154 249 1158 241',
  },
  {
    key: 'fort-william',
    delay: durationMs.reveal * 2,
    duration: durationMs.reveal * 3,
    path: 'M980 410 C956 405 950 387 940 383 C924 377 916 355 909 340 C902 328 891 325 881 322',
  },
] as const;

const junctions = [
  [950, 484],
  [980, 410],
  [951, 184],
  [1087, 473],
  [1087, 385],
  [1158, 241],
  [881, 322],
] as const;

// One compound path makes the six pin cut-outs geometric rather than an alpha mask.
const pinClipPath = [
  'M0 0H1672V941H0Z',
  ...junctions
    .filter(([, y]) => y !== 410)
    .map(([x, y]) => `M${String(x - 25)} ${String(y - 22)}a25 25 0 1 0 50 0a25 25 0 1 0-50 0Z`),
].join(' ');

type RouteStyle = CSSProperties & Record<`--route-${string}`, string>;

const motionStyle: RouteStyle = {
  '--route-reveal-duration': durations.reveal,
  '--route-ease': easings.standard,
};

export function HeroRouteAnimation(): ReactNode {
  const pinClipId = useId();

  return (
    <HeroRouteController style={motionStyle}>
      <svg className="hero-route-art" focusable="false" preserveAspectRatio="none" viewBox="0 0 1672 941">
        <defs>
          <clipPath clipPathUnits="userSpaceOnUse" id={pinClipId}>
            <path clipRule="evenodd" d={pinClipPath} fill="black" fillRule="evenodd" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${pinClipId})`}>
          {routes.map((route) => (
            <g
              key={route.key}
              style={
                {
                  '--route-delay': `${String(route.delay)}ms`,
                  '--route-travel-duration': `${String(route.duration)}ms`,
                } as RouteStyle
              }
            >
              <path className="hero-route-halo" d={route.path} />
              <path className="hero-route-line" d={route.path} pathLength={1} />
              <path
                className="hero-route-comet"
                d={route.path}
                data-route-primary={route.key === 'highlands' ? 'true' : undefined}
                pathLength={1}
              />
            </g>
          ))}
        </g>
        {junctions.map(([x, y]) => (
          <g className="hero-route-junction" key={`${String(x)}-${String(y)}`}>
            <circle className="hero-route-junction-halo" cx={x} cy={y} r={8} />
            <circle className="hero-route-junction-core" cx={x} cy={y} r={2.5} />
          </g>
        ))}
      </svg>
    </HeroRouteController>
  );
}
