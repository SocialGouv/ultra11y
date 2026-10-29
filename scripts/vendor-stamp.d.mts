export declare const sameButForTheDate: (a: unknown, b: unknown) => boolean;
export declare function withPreviousStamp<T extends Record<string, unknown>>(
  path: string,
  next: T,
  opts?: { stamp?: string; sameStamp?: (prev: unknown, next: unknown) => boolean },
): T;
