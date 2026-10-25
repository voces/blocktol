// The parts of the JSR std modules the server imports, for `tsc`: JSR packages
// live in Deno's cache, not node_modules, so tsc can't resolve them. Signatures
// copied from @std/http and @std/path at the versions deno.lock pins.

declare module "@std/http/file-server" {
  export interface ServeFileOptions {
    etagAlgorithm?: AlgorithmIdentifier;
    fileInfo?: Deno.FileInfo;
  }
  export function serveFile(
    req: Request,
    filePath: string,
    options?: ServeFileOptions,
  ): Promise<Response>;
}

declare module "@std/path/posix" {
  export function join(...paths: string[]): string;
  export function normalize(path: string): string;
}
