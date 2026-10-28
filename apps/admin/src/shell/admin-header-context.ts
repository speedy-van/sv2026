import { createContext } from 'react';

/** The persistent authenticated header already consumes the top safe-area inset. */
export const AdminHeaderInsetContext = createContext(false);

/** Measured header height, including the top safe area, for keyboard avoidance below it. */
export const AdminHeaderHeightContext = createContext(0);
