import type { TAbstractFile, App } from 'obsidian';
import { TFile } from 'obsidian';

export function isRecord(o: unknown): o is Record<string, unknown> {
  return (
    (Reflect.getPrototypeOf({})?.toString?.call(o) as string | undefined) ?? ''
  ).endsWith('Object]');
}

export function isMd(f: TAbstractFile): f is TFile {
  return f instanceof TFile && (f.extension == 'md' || f.name.endsWith('.md'));
}

export function tryGetFrontmatterCopy(
  file: TFile,
  app: App,
): Promise<Record<string, unknown>> {
  let frontmatterCopy = {};
  return tryProcessFrontmatter(
    (fm) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const deepCopy = JSON.parse(JSON.stringify(fm));
      if (isRecord(deepCopy)) {
        frontmatterCopy = deepCopy;
      }
    },
    file,
    app,
  ).then(() => frontmatterCopy);
}

export function tryProcessFrontmatter(
  mutationFn: (frontmatter: Record<string, unknown>) => void,
  file: TFile,
  app: App,
) {
  return app.fileManager
    .processFrontMatter(file, mutationFn)
    .catch(() => false);
}

export async function cachedRead(file: TFile, app: App) {
  return await app.vault.cachedRead(file);
}

export async function getNoteTextWithoutFrontmatter(file: TFile, app: App) {
  const fileContents = await file.vault.cachedRead(file);
  const offset = getFrontmatterEndOffset(file, app);
  const textWithoutFrontmatter = fileContents.slice(offset);

  return textWithoutFrontmatter;
}

export function tryJsonParse(s: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return JSON.parse(s);
  } catch (error) {
    return undefined;
  }
}

export async function promiseSettled<T>(p: Promise<T>) {
  return (await Promise.allSettled([p]))[0];
}

export function abortablePromise<T>(
  p: Promise<T>,
  { signal }: { signal?: AbortSignal },
) {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(String(signal.reason)));
    }

    signal?.addEventListener('abort', () => {
      reject(new Error(String(signal.reason)));
    });

    p.then((res) => resolve(res)).catch((reason) =>
      reject(new Error('Abortable had an exception', { cause: reason })),
    );
  });
}

export function getGraphemeCount(s: string) {
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  return [...segmenter.segment(s)].length;
}

export function getFrontmatterEndOffset(file: TFile, app: App) {
  const { metadataCache } = app;
  return metadataCache.getFileCache(file)?.frontmatterPosition?.end.offset ?? 0;
}

export function* takeN<T>(n: number, iterable: Iterable<T>) {
  if (!iterable[Symbol.iterator]) {
    return;
  }

  let index = 0;
  let array = new Array<T>(n);

  for (const value of iterable) {
    array[index] = value;
    if (index === n - 1) {
      // N-sized array
      yield array;
      array = new Array<T>(n);
      index = 0;
      continue;
    }
    ++index;
  }

  if (index === 0) {
    return;
  }
  array.length = index;
  yield array;
}

export function* lazyMap<T, U>(iterable: Iterable<T>, fn: (x?: T) => U) {
  if (!iterable[Symbol.iterator]) {
    return;
  }

  for (const value of iterable) {
    yield fn(value);
  }
}

export async function* lazyMapAsync<T, U>(
  iterable: Iterable<T>,
  fn: (x?: T) => PromiseLike<U>,
) {
  if (!iterable[Symbol.iterator]) {
    return;
  }

  for (const value of iterable) {
    yield await fn(value);
  }
}

export async function consumeSerialAsync<T>(iterable: AsyncIterable<T>) {
  if (!iterable[Symbol.asyncIterator]) {
    return [];
  }

  const array = [];

  for await (const res of iterable) {
    array.push(res);
  }
  return array;
}
