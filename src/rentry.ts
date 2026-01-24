// see https://github.com/microsoft/TypeScript/issues/45167 for Error.cause

import { requestUrl } from 'obsidian';
import ky from 'ky';
import { source } from 'common-tags';
import { parse as parseCookie } from 'cookie';
import { utf8CharacterCount } from './utf8CharacterCount.js';
import { abortablePromise } from './util.js';

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

const getBaseUrl = (useDotOrg?: boolean) =>
  useDotOrg ? 'https://rentry.org' : 'https://rentry.co';

// https://rentry.co/what: 200000 character limit for text field.

function checkTextCharacterLimit(s: string, commandVerb: string) {
  const textCharacterLimit = 200_000;
  const length = utf8CharacterCount(s);
  const numFmt = new Intl.NumberFormat().format;

  if (length > textCharacterLimit) {
    throw new Error(
      `Unable to ${commandVerb} paste. Text length exceeds current limit of ${numFmt(
        textCharacterLimit,
      )} characters (${numFmt(length)} characters).`,
    );
  }
}

export async function create({
  id,
  text,
  signal,
  useRentryDotOrg = false,
}: {
  id?: string;
  text: string;
  signal?: AbortSignal;
  useRentryDotOrg?: boolean;
}) {
  const commandVerb = 'create';

  checkTextCharacterLimit(text, commandVerb);

  const res = await executeRequest<CreateRes>({
    payload: {
      text,
      edit_code: '',
      url: '',
      metadata: source`
        OPTION_DISABLE_SEARCH_ENGINE=true
        OPTION_DISABLE_VIEWS=true
      `,
    },
    endpoint: 'api/new',
    signal,
    commandVerb,
    baseUrl: getBaseUrl(useRentryDotOrg),
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
  useRentryDotOrg = false,
}: {
  id: string;
  editCode: string;
  signal?: AbortSignal;
  useRentryDotOrg?: boolean;
}) {
  await executeRequest<OkRes>({
    payload: {
      edit_code: editCode,
    },
    endpoint: `/api/delete/${id}`,
    signal,
    commandVerb: 'remove',
    baseUrl: getBaseUrl(useRentryDotOrg),
  });
}

export async function update({
  id,
  editCode,
  text,
  signal,
  useRentryDotOrg = false,
}: {
  id: string;
  editCode: string;
  text: string;
  useRentryDotOrg?: boolean;
  signal?: AbortSignal;
}) {
  const commandVerb = 'update';

  checkTextCharacterLimit(text, commandVerb);

  // TODO use metadata in payload when appropriate
  await executeRequest<OkRes>({
    payload: {
      text,
      edit_code: editCode,
    },
    baseUrl: getBaseUrl(useRentryDotOrg),
    endpoint: `api/edit/${id}`,
    signal,
    commandVerb,
  });
}

async function fetchCsrfMiddlewareToken({
  signal,
  baseUrl = getBaseUrl(),
}: {
  signal?: AbortSignal;
  baseUrl?: string;
}) {
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
  baseUrl = getBaseUrl(),
}: {
  payload: Record<string, string>;
  endpoint: string;
  signal?: AbortSignal;
  commandVerb?: string;
  baseUrl?: string;
}) {
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  try {
    const csrfmiddlewaretoken = await fetchCsrfMiddlewareToken({
      signal,
      baseUrl,
    });
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
