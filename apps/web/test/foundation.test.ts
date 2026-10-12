import { describe, expect, it } from 'vitest';
import { cookieInventory } from '../src/content/cookies';
import { services } from '../src/content/navigation';

describe('@sv/web foundation content', () => {
  it('defines the documented service navigation', () => {
    expect(services).toHaveLength(10);
    expect(services.map((service) => service.label)).toContain('Rubbish removal');
  });

  it('keeps the cookie inventory aligned with the consent categories', () => {
    expect(cookieInventory.some((item) => item.name === 'sv_consent' && item.category === 'necessary')).toBe(true);
    expect(cookieInventory.some((item) => item.category === 'analytics')).toBe(true);
    expect(cookieInventory.some((item) => item.category === 'advertising')).toBe(true);
  });
});
