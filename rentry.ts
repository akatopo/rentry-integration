// see https://github.com/microsoft/TypeScript/issues/45167 for Error.cause

import { requestUrl } from 'obsidian';
import { parse as parseCookie } from 'cookie';
// @ts-ignore
import FormData from 'form-data/lib/form_data.js';

type FormData = import('form-data');

const baseUrl = 'https://rentry.co';

export async function create({ id, text }: { id?: string; text: string }) {
  const res = (
    await executeRequest({
      payload: {
        text,
        edit_code: '',
        url: '',
      },
      endpoint: 'api/new',
    })
  ).json;

  return {
    id: getIdFromUrl(res.url),
    url: String(res.url),
    editCode: String(res.edit_code),
  };
}

export async function remove({
  id,
  editCode,
}: {
  id: string;
  editCode: string;
}) {
  return executeRequest({
    payload: {
      edit_code: editCode,
    },
    endpoint: `/api/delete/${id}`,
  });
}

// content:  "OK"
// status:  "200"
// in res object
export async function update({
  id,
  editCode,
  text,
}: {
  id: string;
  editCode: string;
  text: string;
}) {
  return executeRequest({
    payload: {
      text,
      edit_code: editCode,
    },
    endpoint: `api/edit/${id}`,
    useFormUrlEncoded: true,
  });
}

async function base() {
  try {
    const res = await requestUrl(baseUrl);
    const setCookie = res.headers['set-cookie'][0];
    const cookies = parseCookie(setCookie);
    const { csrftoken: csrfToken } = cookies;
    const headers = {
      Referer: baseUrl,
      Cookie: setCookie,
    };

    return { csrfToken, headers };
  } catch (cause) {
    throw new Error('Failed to fetch base cookies', { cause });
  }
}

async function executeRequest({
  payload,
  endpoint,
  method = 'POST',
  useFormUrlEncoded = true, // TODO change this to true and check all endpoints
}: {
  payload: Record<string, string>;
  endpoint: string;
  method?: 'POST' | 'GET';
  useFormUrlEncoded?: boolean;
}) {
  const { headers: baseHeaders, csrfToken: csrfmiddlewaretoken } = await base();
  const form = createForm({
    csrfmiddlewaretoken,
    ...payload,
  });

  const headers = {
    ...baseHeaders,
    ...(useFormUrlEncoded
      ? { 'Content-Type': 'application/x-www-form-urlencoded' }
      : form.getHeaders()),
  };

  const body = useFormUrlEncoded
    ? String(new URLSearchParams({ csrfmiddlewaretoken, ...payload }))
    : form.getBuffer().toString();

  try {
    const res = await requestUrl({
      url: `${baseUrl}/${endpoint}`,
      headers,
      method,
      body,
    });
    return res;
  } catch (cause) {
    throw new Error(`Failed to execute ${method} ${endpoint}`, { cause });
  }
}

function createForm(data: Record<string, string>) {
  const form: FormData = new FormData();

  Object.entries(data).forEach(([name, value]) => {
    form.append(name, value);
  });

  return form;
}

function getIdFromUrl(url: string) {
  return new URL(url).pathname.replaceAll('/', '');
}
