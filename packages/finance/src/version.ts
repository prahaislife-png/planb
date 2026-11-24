/**
 * Semantic version of the calculation engine.
 *
 * Bump rules:
 *  - MAJOR: any change that alters numbers for an unchanged input, or changes the input/output shape incompatibly.
 *  - MINOR: new optional inputs or new output fields; existing numbers unchanged.
 *  - PATCH: documentation / internal refactors with byte-identical outputs.
 *
 * Stored results should always be keyed by (engineVersion, inputHash).
 */
export const ENGINE_VERSION = '1.0.0';

export const ENGINE_NAME = '@planb/finance';
