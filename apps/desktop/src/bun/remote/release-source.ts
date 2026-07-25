/**
 * Build-time release overrides for packaged artifacts.
 *
 * CI beta releases may rewrite this file before the Electrobun build so the
 * packaged app downloads SSH server packages from the same fork release that
 * produced the DMG. Keep committed defaults production-safe.
 */
export const SERVER_PACKAGE_BASE_URL: string | null = null;
