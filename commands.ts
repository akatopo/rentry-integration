import { Plugin, MarkdownView, App, TFile } from 'obsidian';
import { source } from 'common-tags';
import TurndownService from 'turndown';
import * as rentryApi from './rentry.js';
import {
  Buttons as DeleteModalButtons,
  Content as DeleteModalContent,
} from './DeletePasteModalSlots.js';

import type RentryIntegrationPlugin from './main.js';

export const rentryPropNames = [
  'rentryId',
  'rentryUrl',
  'rentryEditCode',
] as const;

export const updateRentry = (plugin: RentryIntegrationPlugin) => ({
  id: 'update-rentry',
  name: 'Update paste',
  checkCallback: (checking: boolean) =>
    editRentryCheckCallback(checking, plugin, (props) => {
      if (!props) {
        return;
      }

      const { rentryEditCode, rentryId, rentryUrl, file } = props;
      const { app } = plugin;

      const clearSpinner = plugin.renderStatusBarSpinner('Updating paste');
      getTextForRentry(
        file,
        app,
        plugin.settings.includeFrontmatter,
        plugin.settings.skipEmptyFrontmatterValues,
      )
        .then((rentryText) => {
          return rentryApi.update({
            id: rentryId,
            editCode: rentryEditCode,
            text: rentryText,
          });
        })
        .then(() => {
          plugin.notice('Paste updated', rentryUrl);
        })
        .catch((reason) => tryNoticeError(plugin, reason))
        .finally(() => {
          clearSpinner();
        });
    }),
});

export const deleteRentry = (plugin: RentryIntegrationPlugin) => ({
  id: 'delete-rentry',
  name: 'Delete paste',
  checkCallback: (checking: boolean) =>
    editRentryCheckCallback(checking, plugin, (props) => {
      if (!props) {
        return;
      }

      const { app } = plugin;
      const { rentryEditCode, rentryId, file } = props;

      plugin
        .confirmationModal({
          title: 'Delete paste',
          content: () => DeleteModalContent({ filename: file.name }),
          buttons: DeleteModalButtons,
        })
        .then((res) => {
          if (res !== 'confirm') {
            return;
          }

          const clearSpinner = plugin.renderStatusBarSpinner('Deleting paste');
          return rentryApi
            .remove({ id: rentryId, editCode: rentryEditCode })
            .then(async () => {
              try {
                await app.fileManager.processFrontMatter(
                  file,
                  (frontmatter) => {
                    removeRentryPropsFromFrontmatterObject(frontmatter);
                  },
                );
              } catch (error) {
                // TODO ignored for now, an error message about frontmatter editing failing might be helpful
              }
            })
            .then(() => {
              plugin.notice('Paste deleted');
            })
            .catch((reason) => tryNoticeError(plugin, reason))
            .finally(() => {
              clearSpinner();
            });
        });
    }),
});

export const createRentry = (plugin: RentryIntegrationPlugin) => ({
  id: 'create-rentry',
  name: 'Create paste',
  checkCallback: (checking: boolean) =>
    createRentryCheckCallback(checking, plugin, ({ file }) => {
      if (!file) {
        return;
      }
      const { app } = plugin;

      const clearSpinner = plugin.renderStatusBarSpinner('Creating paste');
      getTextForRentry(
        file,
        app,
        plugin.settings.includeFrontmatter,
        plugin.settings.skipEmptyFrontmatterValues,
      )
        .then((rentryText) =>
          rentryApi
            .create({ text: rentryText })
            .then(async ({ id, url, editCode }) => {
              try {
                await app.fileManager.processFrontMatter(
                  file,
                  (frontmatter) => {
                    frontmatter.rentryId = id;
                    frontmatter.rentryUrl = url;
                    frontmatter.rentryEditCode = editCode;
                  },
                );

                return { id, url, editCode };
              } catch (error) {
                // TODO ignored for now, an error message about frontmatter editing failing might be helpful
              }
            }),
        )
        .then((res) => {
          plugin.notice('Paste created', res?.url);
        })
        .catch((reason) => tryNoticeError(plugin, reason))
        .finally(() => {
          clearSpinner();
        });
    }),
});

function tryNoticeError(plugin: RentryIntegrationPlugin, reason: unknown) {
  if (!Error.isError(reason)) {
    return;
  }

  const message = String(reason?.message);
  const cause = Error.isError(reason?.cause)
    ? String(reason.cause.message)
    : '';
  plugin.noticeError(`${message}${cause ? `: ${cause}` : ''}`);
}

function editRentryCheckCallback(
  checking: boolean,
  plugin: Plugin,
  fn: (props: ReturnType<typeof hasRentryFrontmatterProps>[1]) => void,
) {
  const { app } = plugin;
  const markdownView = app.workspace.getActiveViewOfType(MarkdownView);
  const [hasProps, props] = hasRentryFrontmatterProps(markdownView, app);
  const shouldDisplayCommand = !!markdownView && hasProps;

  if (checking && shouldDisplayCommand) {
    return true;
  }
  if (!shouldDisplayCommand) {
    return;
  }
  return fn(props);
}

function createRentryCheckCallback(
  checking: boolean,
  plugin: Plugin,
  fn: ({ file }: { file?: TFile }) => void,
) {
  const { app } = plugin;
  const markdownView = app.workspace.getActiveViewOfType(MarkdownView);
  const [hasProps] = hasRentryFrontmatterProps(markdownView, app);
  const shouldDisplayCommand = !!markdownView && !hasProps;

  if (checking && shouldDisplayCommand) {
    return true;
  }
  if (!shouldDisplayCommand) {
    return;
  }
  return fn({ file: markdownView?.file ?? undefined });
}

function hasRentryFrontmatterProps(
  markdownView: MarkdownView | null,
  app: App,
) {
  const checkFailed = [false, undefined] as const;
  if (!markdownView) {
    return checkFailed;
  }
  const { file } = markdownView;
  if (!file) {
    return checkFailed;
  }

  const { frontmatter } = app.metadataCache.getFileCache(file) ?? {};
  const { rentryId, rentryEditCode, rentryUrl } = frontmatter ?? {};

  if (rentryId && rentryEditCode) {
    return [
      true,
      {
        rentryEditCode: String(rentryEditCode),
        rentryId: String(rentryId),
        rentryUrl: String(rentryUrl),
        file,
      },
    ] as const;
  }
  return checkFailed;
}

async function getNoteTextWithoutFrontmatter(file: TFile, app: App) {
  const { metadataCache } = app;
  const fileContents = await file.vault.cachedRead(file);
  const offset =
    metadataCache.getFileCache(file)?.frontmatterPosition?.end.offset ?? 0;
  const textWithoutFrontmatter = offset
    ? fileContents.slice(offset + 1)
    : fileContents;
  return textWithoutFrontmatter;
}

async function tryRenderFrontmatterText(
  file: TFile,
  app: App,
  skipEmptyFrontmatterValues: boolean,
) {
  const { escape: escapeMd } = new TurndownService();
  const { fileManager } = app;
  let frontmatterCopy = {};
  try {
    await fileManager.processFrontMatter(file, (frontmatter) => {
      const deepCopy = JSON.parse(JSON.stringify(frontmatter));
      removeRentryPropsFromFrontmatterObject(deepCopy);
      if (skipEmptyFrontmatterValues) {
        removeEmptyPropsFromFrontmatterObject(deepCopy);
      }
      frontmatterCopy = deepCopy;
    });
  } catch (error) {
    // TODO ignored for now, an error message about frontmatter editing failing might be helpful
  }

  // TODO Could look into better handling of "wide" characters like emoji for calculating col length, see how prettier does it

  const propColLabel = 'Property';
  const valueColLabel = 'Value';
  const toEscapedString = (x: unknown) => {
    if (x === null) {
      return '';
    }
    if (Array.isArray(x)) {
      // https://rentry.co/how: Adding \n triggers a newline within cells and headers
      return x
        .map((s) => escapeMd(x.length > 1 ? `- ${s}` : String(s)))
        .join(' \\n ');
    }
    return String(x);
  };
  const frontmatterEntries = [...Object.entries(frontmatterCopy)].map(
    ([property, value]) => [escapeMd(property), toEscapedString(value)],
  );

  if (frontmatterEntries.length === 0) {
    return '';
  }

  const maxColLength = [
    ...frontmatterEntries,
    [propColLabel, valueColLabel],
  ].reduce(
    (prev, [property, value]) => [
      Math.max(prev[0], getGraphemeCount(property)),
      Math.max(prev[1], getGraphemeCount(value)),
    ],
    [0, 0],
  );

  const padLabelWithSpaces = (label: string, max: number) =>
    `${label}${Array(Math.max(0, max - getGraphemeCount(label)))
      .fill(' ')
      .join('')}`;
  const fillWithDashes = (headingLabel: string, max: number) =>
    Array(Math.max(getGraphemeCount(headingLabel), max))
      .fill('-')
      .join('');
  const rows = frontmatterEntries.map(
    ([property, value]) =>
      `| ${padLabelWithSpaces(
        property,
        maxColLength[0],
      )} | ${padLabelWithSpaces(value, maxColLength[1])} |`,
  );

  return source`
    | ${padLabelWithSpaces(
      propColLabel,
      maxColLength[0],
    )} | ${padLabelWithSpaces(valueColLabel, maxColLength[1])} |
    | ${fillWithDashes(propColLabel, maxColLength[0])} | ${fillWithDashes(
    valueColLabel,
    maxColLength[1],
  )} |
    ${rows}
  `;
}

async function getTextForRentry(
  file: TFile,
  app: App,
  includeFrontmatter: boolean,
  skipEmptyFrontmatterValues: boolean,
) {
  const [frontmatterText, textWithoutFrontmatter] = await Promise.all([
    includeFrontmatter
      ? tryRenderFrontmatterText(file, app, skipEmptyFrontmatterValues)
      : Promise.resolve(''),
    getNoteTextWithoutFrontmatter(file, app),
  ]);

  return source`
    ${frontmatterText}

    ${textWithoutFrontmatter}
  `;
}

function removeRentryPropsFromFrontmatterObject(frontmatter: unknown) {
  if (!frontmatter || typeof frontmatter !== 'object') {
    return;
  }

  rentryPropNames.forEach((key) => {
    if (Object.hasOwn(frontmatter, key)) {
      // see https://github.com/microsoft/TypeScript/issues/44253
      // @ts-expect-error
      delete frontmatter[key];
    }
  });
}

function removeEmptyPropsFromFrontmatterObject(frontmatter: unknown) {
  if (!frontmatter || typeof frontmatter !== 'object') {
    return;
  }

  Object.entries(frontmatter).forEach(([key, value]) => {
    if (
      value === null ||
      value === '' ||
      value === undefined ||
      (Array.isArray(value) && value.length === 0)
    ) {
      // @ts-expect-error
      delete frontmatter[key];
    }
  });
}

function getGraphemeCount(s: string) {
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  return [...segmenter.segment(s)].length;
}
