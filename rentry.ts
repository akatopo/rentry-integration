// see https://github.com/microsoft/TypeScript/issues/45167 for Error.cause

import { requestUrl } from 'obsidian';
import ky from 'ky';
import { parse as parseCookie } from 'cookie';

type CreateRes = {
  status: string;
  content: 'OK';
  url: string;
  url_short: string;
  edit_code: string;
};

type ErrorRes = {
  status: string;
  content: string;
  errors?: string;
};

type OkRes = { status: '200'; content: 'OK' };

const baseUrl = 'https://rentry.co';

export async function create({
  id,
  text,
  signal,
}: {
  id?: string;
  text: string;
  signal?: AbortSignal;
}) {
  const res = await executeRequest<CreateRes>({
    payload: {
      text,
      edit_code: '',
      url: '',
    },
    endpoint: 'api/new',
    signal,
    commandVerb: 'create',
  });

  return {
    id: String(res.url_short),
    url: String(res.url),
    editCode: String(res.edit_code),
  };
}

export async function remove({
  id,
  editCode,
  signal,
}: {
  id: string;
  editCode: string;
  signal?: AbortSignal;
}) {
  await executeRequest<OkRes>({
    payload: {
      edit_code: editCode,
    },
    endpoint: `/api/delete/${id}`,
    signal,
    commandVerb: 'remove',
  });
}

export async function update({
  id,
  editCode,
  text,
  signal,
}: {
  id: string;
  editCode: string;
  text: string;
  signal?: AbortSignal;
}) {
  await executeRequest<OkRes>({
    payload: {
      text,
      edit_code: editCode,
    },
    endpoint: `api/edit/${id}`,
    signal,
    commandVerb: 'update',
  });
}

function abortablePromise<T>(
  p: Promise<T>,
  { signal }: { signal?: AbortSignal },
) {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
    }

    signal?.addEventListener('abort', () => {
      reject(signal.reason);
    });

    try {
      p.then((res) => resolve(res)).catch((reason) => reject(reason));
    } catch (error) {
      reject(error);
    }
  });
}

async function fetchCsrfMiddlewareToken({ signal }: { signal?: AbortSignal }) {
  try {
    // need to use requestUrl due to CORS
    const res = await abortablePromise(requestUrl(baseUrl), { signal });

    const setCookie = res.headers['set-cookie'][0];
    const cookies = parseCookie(setCookie);
    const { csrftoken: csrfToken } = cookies;
    if (!csrfToken) {
      throw new Error('Could not set CSRF token');
    }

    return csrfToken;
  } catch (cause) {
    throw new Error('Failed to fetch base cookies', { cause });
  }
}

async function executeRequest<T extends Record<string, unknown>>({
  payload,
  endpoint,
  signal,
  commandVerb,
}: {
  payload: Record<string, string>;
  endpoint: string;
  signal?: AbortSignal;
  commandVerb?: string;
}) {
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  try {
    const csrfmiddlewaretoken = await fetchCsrfMiddlewareToken({ signal });
    const body = String(
      new URLSearchParams({ csrfmiddlewaretoken, ...payload }),
    );
    const res = await ky
      .post<T | ErrorRes>(`${baseUrl}/${endpoint}`, {
        headers,
        body,
        signal,
      })
      .json();
    if (Object.hasOwn(res, 'errors') || res.content !== 'OK') {
      throw new Error((res as ErrorRes).content);
    }
    return res as T;
  } catch (cause) {
    throw new Error(
      `Failed to ${
        commandVerb ? `${commandVerb} paste` : `execute POST ${endpoint}`
      }`,
      {
        cause,
      },
    );
  }
}
