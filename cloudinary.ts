// see https://github.com/microsoft/TypeScript/issues/45167 for Error.cause

import { requestUrl } from 'obsidian';
import ky from 'ky';
import toHex from 'es-arraybuffer-base64/Uint8Array.prototype.toHex';
import {
  object,
  string,
  record,
  boolean,
  number,
  // type infer as Infer,
} from 'zod';

import { abortablePromise } from './util.js';

const baseUrl = `https://api.cloudinary.com/v1_1`;

const deleteByAssetIdResponseSchema = object({
  deleted: record(string(), string()),
  deleted_counts: record(
    string(),
    object({
      original: number(),
      derived: number(),
    }),
  ),
  partial: boolean(),
});

// https://cloudinary.com/documentation/upload_images#basic_uploading

export async function upload({
  cloudName,
  apiKey,
  apiSecret,
  assetFolder,
  file,
  signal,
}: {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  assetFolder: string;
  file: Blob;
  signal?: AbortSignal;
}) {
  const commandVerb = 'upload';
  const format = 'webp';
  const formData = new FormData();

  const timestamp = String(Date.now());

  const digestBytes = await self.crypto.subtle.digest(
    'SHA-1',
    new TextEncoder().encode(
      `asset_folder=${assetFolder}&format=${format}&timestamp=${timestamp}${apiSecret}`,
    ),
  );

  // TODO: use Uint8Array.toHex() once available
  // see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array/toHex#browser_compatibility
  const signature = toHex(new Uint8Array(digestBytes));

  formData.append('asset_folder', assetFolder);
  formData.append('format', format);
  formData.append('timestamp', timestamp);
  formData.append('signature', signature);
  formData.append('api_key', apiKey);
  formData.append('file', file);

  console.log(formData);

  const res = await executeRequest({
    body: formData,
    endpoint: `${cloudName}/image/upload`,
    signal,
    commandVerb,
  });

  // TODO validate response
  return res;
}

// https://cloudinary.com/documentation/admin_api#delete_resources_by_asset_id

export async function deleteByAssetId({
  cloudName,
  apiKey,
  apiSecret,
  assetIds,
  signal,
}: {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  assetIds: string[];
  signal?: AbortSignal;
}) {
  const commandVerb = 'delete';
  const searchParams = new URLSearchParams();

  assetIds.forEach((id) => {
    searchParams.append('asset_ids[]', id);
  });

  const res = await executeRequest({
    body: String(searchParams),
    endpoint: `${cloudName}/resources`,
    method: 'delete',
    basicAuthCredentials: {
      apiKey,
      apiSecret,
    },
    signal,
    commandVerb,
    bypassCors: true,
  });

  try {
    const parsed = deleteByAssetIdResponseSchema.parse(res);
    return parsed;
  } catch (cause) {
    throw new Error('Invalid response from cloudinary', { cause });
  }
}

async function executeRequest({
  // payload,
  body,
  endpoint,
  signal,
  commandVerb,
  method = 'post',
  basicAuthCredentials,
  bypassCors = false,
}: {
  // payload: Record<string, string>;
  body: FormData | string;
  endpoint: string;
  signal?: AbortSignal;
  commandVerb?: string;
  method?: 'post' | 'delete';
  basicAuthCredentials?: { apiKey: string; apiSecret: string };
  bypassCors?: boolean;
}) {
  const headers = {
    ...(typeof body === 'string'
      ? {
          'Content-Type': 'application/x-www-form-urlencoded',
        }
      : {}),
    ...(basicAuthCredentials
      ? {
          Authorization: `Basic ${btoa(
            `${basicAuthCredentials.apiKey}:${basicAuthCredentials.apiSecret}`,
          )}`,
        }
      : {}),
  };

  try {
    const res = bypassCors
      ? (
          await abortablePromise(
            requestUrl({
              headers,
              method,
              body: body as string, // no need to bother with FormData
              url: `${baseUrl}/${endpoint}`,
            }),
            { signal },
          )
        ).json
      : await ky[method](`${baseUrl}/${endpoint}`, {
          headers,
          body,
          signal,
        }).json();

    return res;
  } catch (cause) {
    throw new Error(
      `Failed to ${
        commandVerb
          ? `${commandVerb} paste`
          : `execute ${method.toUpperCase()} ${endpoint}`
      }`,
      {
        cause,
      },
    );
  }
}
