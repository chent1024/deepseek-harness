/** Explicit public certificate selection; no password is passed to build subprocesses. */
export interface LocalMacOSSigning { identity: string; keychain: string }
/** Validate the certificate fingerprint and keychain path, or return undefined for ad-hoc builds. */
export function resolveLocalMacOSSigning(environment?: NodeJS.ProcessEnv): LocalMacOSSigning | undefined
/** Read only the selection from the existing personal signing record. */
export function configuredLocalMacOSSigning(environment?: NodeJS.ProcessEnv, record?: string): NodeJS.ProcessEnv
/** Apply the selected certificate to the enclosing application and verify its complete signature. */
export function signLocalMacOSApplication(application: string, environment: NodeJS.ProcessEnv, entitlements: string): void
