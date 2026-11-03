/** Google's local queue bootstrap only: no network request, destination, or consent grant. */
export const GOOGLE_TAG_BOOTSTRAP = `
window.dataLayer = window.dataLayer || [];
window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
`;
