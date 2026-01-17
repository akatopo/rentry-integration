import { object, string, record, type infer as Infer } from 'zod';
import {
  tryJsonParse,
  takeN,
  lazyMapAsync,
  consumeSerialAsync,
  promiseSettled,
  isRecord,
} from './util';
import { upload, deleteByAssetId } from './cloudinary.js';

import type { EmbedCache, TFile, App } from 'obsidian';

export type ResolvedEmbed = EmbedCache & { fullPath?: string };

// https://github.com/gavvvr/obsidian-imgur-plugin/blob/main/src/imgur/constants.ts
const supportedExtensions = new Set([
  'jpeg',
  'jpg',
  'png',
  'gif',
  'apng',
  'tiff',
  'webp',
  'avif',
  'heic',
  'mp4',
  'mpeg',
  'avi',
  'webm',
  'mov',
  'mkv',
]);

export const rentryEmbedCacheSchema = object({
  pathMap: record(
    string(),
    object({
      id: string(),
      url: string(),
      type: string(), // TODO limit to known types
    }),
  ),
  folder: string().optional(),
});

export type RentryEmbedCache = Infer<typeof rentryEmbedCacheSchema>;
export type PathMapRecordValue =
  RentryEmbedCache['pathMap'][keyof RentryEmbedCache['pathMap']];

export function getEmbedInfo(file: TFile, app: App) {
  const { metadataCache } = app;
  const resolvedLinks = metadataCache.resolvedLinks[file.path];
  const fileCache = metadataCache.getFileCache(file);
  const { embeds } = fileCache ?? {};
  const resolvedEmbeds: ResolvedEmbed[] = (embeds ?? [])
    .map((embed) => ({
      ...embed,
      fullPath: metadataCache.getFirstLinkpathDest(embed.link, file.path)?.path,
    }))
    .filter(
      ({ fullPath, link }) =>
        fullPath &&
        Object.hasOwn(resolvedLinks, fullPath) &&
        supportedExtensions.has((/\.([a-zA-Z]+)$/.exec(link) ?? [])[1]),
    );
  const uniqueFullPaths = new Set(
    resolvedEmbeds
      .map((embed) => embed.fullPath)
      .filter((path) => path !== undefined),
  );

  return [resolvedEmbeds, uniqueFullPaths] as const;
}

export function getStaleEmbedsAndUploadPaths(
  uniqueFullPaths: Set<string>,
  pathMap: RentryEmbedCache['pathMap'],
) {
  const staleEmbeds = Object.keys(pathMap ?? {})
    .filter((path) => !uniqueFullPaths.has(path))
    .map((path) => ({ ...pathMap[path], path }));

  const uploadPaths = [...uniqueFullPaths].filter(
    (path) => path && !Object.hasOwn(pathMap ?? {}, path),
  );

  return [staleEmbeds, uploadPaths] as const;
}

export function tryParseEmbedCache(s: string) {
  const jsonParsed = tryJsonParse(s);
  if (jsonParsed === undefined || !isRecord(jsonParsed)) {
    return undefined;
  }

  try {
    return rentryEmbedCacheSchema.parse(jsonParsed);
  } catch (error) {
    return undefined;
  }
}

export async function removeStaleEmbeds({
  cloudinaryApiKey: apiKey,
  cloudinaryApiSecret: apiSecret,
  cloudinaryCloudName: cloudName,
  staleEmbeds,
}: {
  cloudinaryApiKey: string;
  cloudinaryApiSecret: string;
  cloudinaryCloudName: string;
  staleEmbeds: (PathMapRecordValue & { path: string })[];
}) {
  // https://cloudinary.com/documentation/admin_api#delete_resources_by_asset_id
  // Delete all assets with the specified asset IDs (array of up to 100 asset_ids).
  const maxIds = 100;

  const fulfilled: typeof staleEmbeds = [];
  const rejected: typeof staleEmbeds = [];

  for (const embeds of takeN(maxIds, staleEmbeds)) {
    const ids = embeds.map((embed) => embed.id);

    const res = await promiseSettled(
      deleteByAssetId({
        cloudName,
        apiKey,
        apiSecret,
        assetIds: ids,
      }),
    );

    if (res.status === 'fulfilled') {
      // Check for partial deletion
      for (const embed of embeds) {
        (res.value.deleted[embed.id] ? fulfilled : rejected).push(embed);
      }
    } else {
      rejected.push(...embeds);
    }
  }

  return [fulfilled, rejected];
}

export async function purgeEmbeds(
  {
    cloudinaryApiKey,
    cloudinaryApiSecret,
    cloudinaryCloudName,
    rentryEmbedCache,
  }: {
    cloudinaryApiKey: string;
    cloudinaryApiSecret: string;
    cloudinaryCloudName: string;
    rentryEmbedCache?: RentryEmbedCache;
  },
  file: TFile,
  app: App,
) {
  const pathMap = rentryEmbedCache?.pathMap ?? {};
  // We're not going to be using the folder name so no init
  const folder = rentryEmbedCache?.folder ?? undefined;
  const staleEmbeds = Object.entries(pathMap).map(([path, value]) => ({
    ...value,
    path,
  }));

  const [, rejectedRemovals] = await removeStaleEmbeds({
    staleEmbeds,
    cloudinaryApiKey,
    cloudinaryApiSecret,
    cloudinaryCloudName,
  });

  const newRentryEmbedCache = rejectedRemovals.reduce(
    (prev, current) => {
      const { path } = current;
      prev.pathMap[path] = pathMap[path];
      return prev;
    },
    { pathMap: {}, folder } as RentryEmbedCache,
  );

  // ideally we're getting an empty path map here, { pathMap:{}, folder }
  const safeToRemoveCache =
    Object.entries(newRentryEmbedCache.pathMap).length === 0;

  return [safeToRemoveCache, newRentryEmbedCache] as const;
}

export async function syncEmbeds(
  {
    rentryEmbedCache,
    cloudinaryApiKey,
    cloudinaryApiSecret,
    cloudinaryCloudName,
  }: {
    rentryEmbedCache?: RentryEmbedCache;
    cloudinaryApiKey: string;
    cloudinaryApiSecret: string;
    cloudinaryCloudName: string;
  },
  file: TFile,
  app: App,
) {
  const pathMap = rentryEmbedCache?.pathMap ?? {};
  const assetFolder = rentryEmbedCache?.folder ?? self.crypto.randomUUID();
  const [resolvedEmbeds, uniqueFullPaths] = getEmbedInfo(file, app);

  // deleted stale assets and upload new assets

  const [staleEmbeds, uploadPaths] = getStaleEmbedsAndUploadPaths(
    uniqueFullPaths,
    pathMap,
  );

  const [, rejectedRemovals] = await removeStaleEmbeds({
    staleEmbeds,
    cloudinaryApiKey,
    cloudinaryApiSecret,
    cloudinaryCloudName,
  });

  const [fulfilledUploads, rejectedUploads] = await uploadEmbeds(
    {
      uploadPaths,
      assetFolder,
      cloudinaryApiKey,
      cloudinaryApiSecret,
      cloudinaryCloudName,
    },
    app,
  );

  // create new embed data

  // new paths from fulfilled uploaded
  let newRentryEmbedCache = fulfilledUploads.reduce(
    (prev, current) => {
      const [path, allSettledRes] = current;

      const { value } = allSettledRes;

      const { asset_id: id, secure_url: url, resource_type: type } = value;
      prev.pathMap[path] = { id, url, type };
      return prev;
    },
    { pathMap: {}, folder: assetFolder } as RentryEmbedCache,
  );

  // rejected stale paths also end up in the pathMap again
  newRentryEmbedCache = rejectedRemovals.reduce((prev, current) => {
    const { path } = current;
    prev.pathMap[path] = pathMap[path];
    return prev;
  }, newRentryEmbedCache);

  // cached paths from old embed data path map
  [...uniqueFullPaths].forEach((path) => {
    if (!path) {
      return;
    }
    const data = pathMap[path];
    if (data) {
      newRentryEmbedCache.pathMap[path] = data;
    }
  });

  const rejectedUploadsOrRemovalsExist = !!(
    rejectedUploads.length || rejectedRemovals.length
  );

  return [
    newRentryEmbedCache,
    resolvedEmbeds,
    rejectedUploadsOrRemovalsExist,
  ] as const;
}

export async function uploadEmbeds(
  {
    cloudinaryApiKey: apiKey,
    cloudinaryApiSecret: apiSecret,
    cloudinaryCloudName: cloudName,
    uploadPaths,
    assetFolder,
  }: {
    cloudinaryApiKey: string;
    cloudinaryApiSecret: string;
    cloudinaryCloudName: string;
    uploadPaths: string[];
    assetFolder: string;
  },
  app: App,
) {
  const fulfilled: [
    string,
    PromiseFulfilledResult<Awaited<ReturnType<typeof upload>>>,
  ][] = [];
  const rejected: [string, PromiseRejectedResult][] = [];

  const lz = lazyMapAsync(uploadPaths, async (uploadPath) => {
    if (!uploadPath) {
      return;
    }
    const file = app.vault.getFileByPath(uploadPath);
    if (!file) {
      return;
    }
    const fileBuffer = await app.vault.readBinary(file);

    try {
      const res = await promiseSettled(
        upload({
          cloudName,
          assetFolder,
          apiKey,
          apiSecret,
          file: new Blob([fileBuffer]),
        }),
      );
      return [uploadPath, res] as const;
    } catch (error) {
      return [
        uploadPath,
        { status: 'rejected' } as PromiseRejectedResult,
      ] as const;
    }
  });
  const results = (await consumeSerialAsync(lz)).filter((x) => !!x);

  results.forEach(([path, allSettledRes]) => {
    (allSettledRes.status === 'fulfilled' ? fulfilled : rejected).push([
      path,
      // @ts-expect-error
      allSettledRes,
    ]);
  });

  return [fulfilled, rejected] as const;
}
