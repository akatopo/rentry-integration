import { Plugin, MarkdownView, App, TFile } from 'obsidian';
import { source } from 'common-tags';
// @ts-ignore
import TurndownService from 'turndown';
import * as rentryApi from './rentry.js';

import type RentryIntegrationPlugin from './main.js';

export const rentryPropNames = [
  'rentryId',
  'rentryUrl',
  'rentryEditCode',
] as const;

export const updateRentry = (plugin: RentryIntegrationPlugin) => ({
  id: 'update-rentry',
  name: 'Update rentry',
  checkCallback: (checking: boolean) =>
    editRentryCheckCallback(checking, plugin, (props) => {
      if (!props) {
        return;
      }

      const { rentryEditCode, rentryId, file } = props;
      const { app } = plugin;

      getTextForRentry(file, app, plugin.settings.includeFrontmatter)
        .then((rentryText) => {
          return rentryApi.update({
            id: rentryId,
            editCode: rentryEditCode,
            text: rentryText,
          });
        })
        .catch();
    }),
});

export const deleteRentry = (plugin: RentryIntegrationPlugin) => ({
  id: 'delete-rentry',
  name: 'Delete rentry',
  checkCallback: (checking: boolean) =>
    editRentryCheckCallback(checking, plugin, (props) => {
      if (!props) {
        return;
      }

      const { app } = plugin;
      const { rentryEditCode, rentryId, file } = props;

      rentryApi
        .remove({ id: rentryId, editCode: rentryEditCode })
        .then(async () => {
          try {
            await app.fileManager.processFrontMatter(file, (frontmatter) => {
              removeRentryPropsFromFrontmatterObject(frontmatter);
            });
          } catch (error) {
            // TODO ignored for now, an error message about frontmatter editing failing might be helpful
          }
        });
    }),
});

export const createRentry = (plugin: RentryIntegrationPlugin) => ({
  id: 'create-rentry',
  name: 'Create rentry',
  checkCallback: (checking: boolean) =>
    createRentryCheckCallback(checking, plugin, ({ file }) => {
      if (!file) {
        return;
      }
      const { app } = plugin;
      getTextForRentry(file, app, plugin.settings.includeFrontmatter).then(
        (rentryText) =>
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
              } catch (error) {
                // TODO ignored for now, an error message about frontmatter editing failing might be helpful
              }
            }),
      );
    }),
});

function editRentryCheckCallback(
  checking: boolean,
  plugin: Plugin,
  fn: (props: ReturnType<typeof hasRentryFrontmatterProps>[1]) => undefined,
) {
  const { app } = plugin;
  const markdownView = app.workspace.getActiveViewOfType(MarkdownView);
  const [shouldDisplayCommand, props] = hasRentryFrontmatterProps(
    markdownView,
    app,
  );

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
  fn: ({ file }: { file?: TFile }) => undefined,
) {
  const { app } = plugin;
  const markdownView = app.workspace.getActiveViewOfType(MarkdownView);
  const [hasProps] = hasRentryFrontmatterProps(markdownView, app);

  if (checking && !hasProps) {
    return true;
  }
  if (hasProps) {
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
  const { rentryId, rentryEditCode } = frontmatter ?? {};

  if (rentryId && rentryEditCode) {
    return [
      true,
      {
        rentryEditCode: String(rentryEditCode),
        rentryId: String(rentryId),
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

async function tryRenderFrontmatterText(file: TFile, app: App) {
  const { escape: escapeMd } = TurndownService();
  const { fileManager } = app;
  let frontmatterCopy = {};
  try {
    await fileManager.processFrontMatter(file, (frontmatter) => {
      const deepCopy = JSON.parse(JSON.stringify(frontmatter));
      removeRentryPropsFromFrontmatterObject(deepCopy);
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
      return x.map((s) => escapeMd(String(s))).join(' \\n ');
    }
    return String(x);
  };
  const frontmatterEntries = [...Object.entries(frontmatterCopy)].map(
    ([property, value]) => [escapeMd(property), toEscapedString(value)],
  );

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
) {
  return Promise.all([
    includeFrontmatter
      ? tryRenderFrontmatterText(file, app)
      : Promise.resolve(''),
    getNoteTextWithoutFrontmatter(file, app),
  ]).then(([frontmatterText, textWithoutFrontmatter]) => {
    return [frontmatterText, textWithoutFrontmatter].join('\n');
  });
}

function removeRentryPropsFromFrontmatterObject(frontmatter: unknown) {
  if (!frontmatter || typeof frontmatter !== 'object') {
    return;
  }

  rentryPropNames.forEach((key) => {
    if (Object.hasOwn(frontmatter, key)) {
      // see https://github.com/microsoft/TypeScript/issues/44253
      // @ts-ignore
      delete frontmatter[key];
    }
  });
}

function getGraphemeCount(s: string) {
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  return [...segmenter.segment(s)].length;
}
